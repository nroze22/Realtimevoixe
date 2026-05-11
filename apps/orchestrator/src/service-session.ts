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
    void this.pollListeners();
    this.transition('live');
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
    });

    await ts.start();
    this.sessions.set(lang, ts);
    if (this.sourceCaptionsOwner === null) {
      this.sourceCaptionsOwner = lang;
    }
    this.sendToOperator({ type: 'log', level: 'info', message: `Translation session opened: ${lang}`, tMs: this.now() });
  }

  appendInputAudio(pcm16: Buffer): void {
    if (this.state.status !== 'live' && this.state.status !== 'paused') return;
    if (this.state.status === 'paused') return;
    if (this.state.capReached) return;
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
    for (const ts of this.sessions.values()) ts.close();
    this.sessions.clear();
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
