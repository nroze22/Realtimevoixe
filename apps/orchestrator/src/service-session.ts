import { EventEmitter } from 'node:events';
import type { WebSocket as FastifyWS } from 'ws';
import {
  type CaptionFrame,
  type CostUpdate,
  type LanguageCode,
  type OrchestratorMessage,
  type ServiceConfig,
  type ServiceState,
  type UsageSnapshot,
  addUsage,
  emptyUsage,
  estimateCostUSD,
  estimatedBurnPerMinuteUSD,
} from '@rtv/shared';
import { TranslateSession } from './realtime-session.js';
import { env } from './env.js';
import { listenerCounts, broadcastData } from './livekit.js';
import { ServiceRecorder } from './recorder.js';
import { log } from './log.js';

/**
 * Orchestrates one church service: fans the input audio out into N parallel
 * OpenAI Realtime translate sessions (one per target language), tracks cost
 * usage, and emits messages back to the connected operator WebSocket.
 *
 * The operator browser is responsible for publishing the per-language audio
 * tracks back into LiveKit. The orchestrator simply ferries:
 *   - input PCM16 audio frames in
 *   - output PCM16 audio frames out (tagged with language)
 *   - source/target captions
 *   - cost updates and cap warnings
 */
export class ServiceSession extends EventEmitter {
  public state: ServiceState;
  private sessions = new Map<LanguageCode, TranslateSession>();
  private usageByLang = new Map<LanguageCode, UsageSnapshot>();
  private operatorSocket: FastifyWS | null = null;
  private startedAt = 0;
  private costInterval: NodeJS.Timeout | null = null;
  private listenerInterval: NodeJS.Timeout | null = null;
  private lastCaptionByLang = new Map<LanguageCode, string>();
  private warnedAt: number[] = [];
  /** Only the first opened session emits source-language captions. */
  private sourceCaptionsOwner: LanguageCode | null = null;
  private sourceBuffer = '';
  public readonly recorder: ServiceRecorder;

  /** ---- Reliability state ---- */
  /** Per-language restart attempt counters + scheduled timers. */
  private restartAttempts = new Map<LanguageCode, number>();
  private restartTimers = new Map<LanguageCode, NodeJS.Timeout>();
  /** Smart-silence gating: when true, we don't forward audio to OpenAI. */
  private silenceGated = false;
  /** Heartbeat tracking — operator must ping at least every 30s. */
  private lastPingAt = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private static OPERATOR_TIMEOUT_MS = 60_000;

  constructor(
    public readonly config: ServiceConfig,
    livekitRoomName: string,
    joinCode: string,
  ) {
    super();
    this.state = {
      config,
      status: 'idle',
      startedAt: null,
      endedAt: null,
      livekitRoomName,
      joinCode,
      costUSD: 0,
      capReached: false,
      listenersByLanguage: {},
      totalListeners: 0,
      errorMessage: null,
    };
    this.recorder = new ServiceRecorder(config.serviceId);
  }

  setListenerCounts(byLanguage: Record<string, number>, total: number): void {
    this.state.listenersByLanguage = byLanguage;
    this.state.totalListeners = total;
    this.sendToOperator({ type: 'listener.count', byLanguage, total });
  }

  attachOperator(socket: FastifyWS): void {
    this.operatorSocket = socket;
    this.sendToOperator({ type: 'state', state: this.state });
  }

  detachOperator(socket: FastifyWS): void {
    if (this.operatorSocket === socket) {
      this.operatorSocket = null;
    }
  }

  async start(): Promise<void> {
    if (this.state.status === 'live' || this.state.status === 'starting') return;
    this.transition('starting');
    this.startedAt = Date.now();
    this.state.startedAt = this.startedAt;

    for (const lang of this.config.targetLanguages as LanguageCode[]) {
      await this.openLanguage(lang);
    }

    this.costInterval = setInterval(() => this.publishCost(), 1000);
    this.listenerInterval = setInterval(() => void this.pollListeners(), 5000);
    this.lastPingAt = Date.now();
    this.heartbeatInterval = setInterval(() => this.checkHeartbeat(), 5000);
    void this.pollListeners();
    this.transition('live');
  }

  /** Operator's WS sent a ping; remember when. */
  notePing(): void {
    this.lastPingAt = Date.now();
  }

  /** Smart-silence gating from the operator browser. */
  setSilenceGated(silent: boolean): void {
    if (this.silenceGated === silent) return;
    this.silenceGated = silent;
    this.sendToOperator({ type: 'silence.gating', paused: silent });
    if (silent) {
      // Commit anything outstanding so we don't leave pending tokens dangling.
      for (const ts of this.sessions.values()) ts.flush();
    }
    log.debug({ silent, serviceId: this.config.serviceId }, 'silence gating changed');
  }

  private checkHeartbeat(): void {
    if (this.state.status !== 'live') return;
    const since = Date.now() - this.lastPingAt;
    if (since > ServiceSession.OPERATOR_TIMEOUT_MS) {
      log.warn({ serviceId: this.config.serviceId, since }, 'operator heartbeat lost, auto-stopping');
      this.sendToOperator({
        type: 'log',
        level: 'warn',
        message: 'Operator heartbeat lost — auto-stopping to protect cost.',
        tMs: this.now(),
      });
      void this.stop();
    } else if (since > 30_000) {
      this.sendToOperator({
        type: 'log',
        level: 'warn',
        message: `Operator unresponsive · ${Math.round(since / 1000)}s`,
        tMs: this.now(),
      });
    }
  }

  private async pollListeners(): Promise<void> {
    if (this.state.status === 'stopped' || this.state.status === 'stopping') return;
    const counts = await listenerCounts(this.state.livekitRoomName);
    this.setListenerCounts(counts.byLanguage, counts.total);
  }

  async openLanguage(lang: LanguageCode): Promise<void> {
    if (this.sessions.has(lang)) return;
    const ts = new TranslateSession({
      serviceId: this.config.serviceId,
      pastorId: this.config.pastorId,
      sourceLanguage: this.config.sourceLanguage as LanguageCode,
      targetLanguage: lang,
    });

    ts.on('audio', (pcm16) => {
      this.sendBinaryToOperator(lang, pcm16);
      this.recorder.appendAudio(lang, pcm16);
    });

    ts.on('text', (delta, isFinal) => {
      if (!delta && !isFinal) return;
      const prev = this.lastCaptionByLang.get(lang) ?? '';
      const text = isFinal ? prev : prev + delta;
      const tMs = Date.now() - this.startedAt;
      if (isFinal) {
        this.lastCaptionByLang.set(lang, '');
        this.recorder.appendCaption('target', lang, tMs, prev);
        // Broadcast only finalized lines to listeners; partials would just
        // thrash the screen on phones.
        if (prev.trim()) {
          void broadcastData(this.state.livekitRoomName, {
            t: 'caption',
            kind: 'target',
            lang,
            text: prev,
            tMs,
          });
        }
      } else {
        this.lastCaptionByLang.set(lang, text);
      }
      const frame: CaptionFrame = { kind: 'target', language: lang, text, isFinal, tMs };
      this.sendToOperator({ type: 'caption', frame });
    });

    ts.on('sourceText', (delta, isFinal) => {
      if (this.sourceCaptionsOwner !== lang) return;
      const tMs = this.now();
      const srcLang = this.config.sourceLanguage as LanguageCode;
      if (isFinal) {
        this.sourceBuffer = '';
        this.recorder.appendCaption('source', srcLang, tMs, delta);
        if (delta.trim()) {
          void broadcastData(this.state.livekitRoomName, {
            t: 'caption',
            kind: 'source',
            lang: srcLang,
            text: delta,
            tMs,
          });
        }
        const frame: CaptionFrame = { kind: 'source', language: srcLang, text: delta, isFinal: true, tMs };
        this.sendToOperator({ type: 'caption', frame });
        return;
      }
      this.sourceBuffer += delta;
      const frame: CaptionFrame = {
        kind: 'source',
        language: this.config.sourceLanguage as LanguageCode,
        text: this.sourceBuffer,
        isFinal: false,
        tMs: this.now(),
      };
      this.sendToOperator({ type: 'caption', frame });
    });

    ts.on('usage', (u) => {
      const snap = this.usageByLang.get(lang) ?? emptyUsage();
      const updated = addUsage(snap, {
        audioInputTokens: u.inputTokens,
        audioOutputTokens: u.outputTokens,
        cachedAudioInputTokens: u.cachedInputTokens,
      });
      this.usageByLang.set(lang, updated);
    });

    ts.on('error', (err) => {
      this.sendToOperator({ type: 'log', level: 'error', message: `[${lang}] ${err.message}`, tMs: this.now() });
    });

    ts.on('closed', () => {
      this.sessions.delete(lang);
      // Auto-restart if the service is still live (not stopped intentionally).
      if (this.state.status === 'live' || this.state.status === 'paused') {
        this.recorder.markGap(lang, this.now(), 'reconnecting');
        this.scheduleLanguageRestart(lang);
      }
    });

    await ts.start();
    this.sessions.set(lang, ts);
    if (this.sourceCaptionsOwner === null) {
      this.sourceCaptionsOwner = lang;
    }
    this.sendToOperator({ type: 'log', level: 'info', message: `Translation session opened: ${lang}`, tMs: this.now() });
  }

  private scheduleLanguageRestart(lang: LanguageCode): void {
    // Cancel any prior pending restart for this language.
    const existing = this.restartTimers.get(lang);
    if (existing) clearTimeout(existing);

    const attempt = (this.restartAttempts.get(lang) ?? 0) + 1;
    this.restartAttempts.set(lang, attempt);
    if (attempt > 5) {
      log.error({ lang, serviceId: this.config.serviceId }, 'giving up restart');
      this.sendToOperator({
        type: 'log',
        level: 'error',
        message: `[${lang}] Translation session failed repeatedly — giving up. Pause + resume to retry.`,
        tMs: this.now(),
      });
      return;
    }

    // Exponential backoff: 2s, 4s, 8s, 16s, 30s.
    const delayMs = Math.min(30_000, 2_000 * Math.pow(2, attempt - 1));
    this.sendToOperator({ type: 'language.restart', language: lang, attempt, nextDelayMs: delayMs });
    log.warn({ lang, attempt, delayMs }, 'scheduling translate-session restart');

    const t = setTimeout(async () => {
      this.restartTimers.delete(lang);
      if (this.state.status !== 'live' && this.state.status !== 'paused') return;
      try {
        await this.openLanguage(lang);
        // Reset attempt counter after a successful open.
        this.restartAttempts.set(lang, 0);
        this.sendToOperator({
          type: 'log',
          level: 'info',
          message: `[${lang}] Translation session recovered.`,
          tMs: this.now(),
        });
      } catch (err) {
        log.error({ err, lang }, 'restart attempt failed');
        this.scheduleLanguageRestart(lang); // chain to next backoff
      }
    }, delayMs);
    this.restartTimers.set(lang, t);
  }

  appendInputAudio(pcm16: Buffer): void {
    if (this.state.status !== 'live' && this.state.status !== 'paused') return;
    if (this.state.status === 'paused') return;
    if (this.state.capReached) return;
    // Smart silence: when the operator says it's silent, don't burn API tokens.
    if (this.silenceGated) return;
    for (const ts of this.sessions.values()) {
      ts.appendAudio(pcm16);
    }
  }

  pause(): void {
    if (this.state.status === 'live') this.transition('paused');
  }
  resume(): void {
    if (this.state.status === 'paused') this.transition('live');
  }

  raiseCap(addUSD: number): void {
    if (!Number.isFinite(addUSD) || addUSD <= 0) return;
    const next = Math.min(2000, this.config.costCapUSD + addUSD);
    if (next === this.config.costCapUSD) return;
    (this.config as any).costCapUSD = next;
    // If we were over the cap, allow recovery so the service can resume.
    if (this.state.capReached && this.state.costUSD < next) {
      this.state.capReached = false;
    }
    this.warnedAt = this.warnedAt.filter((t) => this.state.costUSD / next >= t);
    this.sendToOperator({ type: 'log', level: 'info', message: `Cost cap raised to $${next.toFixed(0)}`, tMs: this.now() });
    this.transition(this.state.status);
  }

  async stop(): Promise<void> {
    if (this.state.status === 'stopped' || this.state.status === 'stopping') return;
    this.transition('stopping');
    if (this.costInterval) {
      clearInterval(this.costInterval);
      this.costInterval = null;
    }
    if (this.listenerInterval) {
      clearInterval(this.listenerInterval);
      this.listenerInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const t of this.restartTimers.values()) clearTimeout(t);
    this.restartTimers.clear();
    for (const ts of this.sessions.values()) ts.close();
    this.sessions.clear();
    // Finalize recordings so downloads work right after stop.
    await this.recorder.finalize();
    this.state.endedAt = Date.now();
    this.transition('stopped');
    this.emit('ended');
  }

  // ---- Cost & cap ----

  private publishCost(): void {
    const realtimeModel = env().OPENAI_REALTIME_MODEL as any;
    const transcribeModel = env().OPENAI_TRANSCRIBE_MODEL as any;
    let totalUsage = emptyUsage();
    const costByLanguage: Record<string, number> = {};
    for (const [lang, u] of this.usageByLang.entries()) {
      totalUsage = addUsage(totalUsage, u);
      costByLanguage[lang] = estimateCostUSD(u, realtimeModel, transcribeModel);
    }
    const costUSD = estimateCostUSD(totalUsage, realtimeModel, transcribeModel);
    this.state.costUSD = costUSD;

    const cap = this.config.costCapUSD;
    const capFraction = Math.min(1, costUSD / cap);
    const burnPerMinuteUSD = estimatedBurnPerMinuteUSD(
      realtimeModel,
      this.config.targetLanguages.length,
      transcribeModel,
    );

    const update: CostUpdate = { costUSD, capUSD: cap, capFraction, burnPerMinuteUSD, costByLanguage };
    this.sendToOperator({ type: 'cost', usage: update });

    for (const threshold of [0.5, 0.8, 0.95]) {
      if (capFraction >= threshold && !this.warnedAt.includes(threshold)) {
        this.warnedAt.push(threshold);
        this.sendToOperator({ type: 'cap.warning', capFraction });
      }
    }

    if (capFraction >= 1 && !this.state.capReached) {
      this.state.capReached = true;
      this.sendToOperator({ type: 'cap.reached' });
      log.warn({ serviceId: this.config.serviceId, costUSD, cap }, 'cost cap reached, stopping');
      void this.stop();
    }
  }

  // ---- Plumbing ----

  private transition(status: ServiceState['status']): void {
    this.state.status = status;
    this.sendToOperator({ type: 'state', state: this.state });
  }

  private sendToOperator(msg: OrchestratorMessage): void {
    const s = this.operatorSocket;
    if (!s || s.readyState !== 1 /* OPEN */) return;
    try {
      s.send(JSON.stringify(msg));
    } catch (err) {
      log.warn({ err }, 'failed to send op message');
    }
  }

  /** External accessor so the WS handler can send back pongs without re-importing types. */
  sendToOperatorRaw(msg: OrchestratorMessage): void {
    this.sendToOperator(msg);
  }

  /**
   * Binary frame format on operator WS (translated audio):
   *   byte 0       : tag = 0x01
   *   byte 1       : language code length L (uint8)
   *   bytes 2..2+L : language code utf-8 (e.g. "es")
   *   bytes 2+L..  : PCM16 LE mono audio at the model's output sample rate
   *                  (24kHz for gpt-realtime / gpt-realtime-translate).
   */
  private sendBinaryToOperator(lang: LanguageCode, pcm16: Buffer): void {
    const s = this.operatorSocket;
    if (!s || s.readyState !== 1) return;
    const codeBuf = Buffer.from(lang, 'utf8');
    const header = Buffer.alloc(2);
    header.writeUInt8(0x01, 0);
    header.writeUInt8(codeBuf.length, 1);
    const frame = Buffer.concat([header, codeBuf, pcm16]);
    try {
      s.send(frame, { binary: true });
    } catch (err) {
      log.warn({ err }, 'failed to send binary frame');
    }
  }

  private now(): number {
    return Date.now() - (this.startedAt || Date.now());
  }
}
