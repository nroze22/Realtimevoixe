'use client';

import type { LanguageCode, OperatorMessage, OrchestratorMessage } from '@rtv/shared';

export interface AudioEngineCallbacks {
  onMessage: (msg: OrchestratorMessage) => void;
  onLanguageStream: (lang: LanguageCode, stream: MediaStream) => void;
  onConnectionChange: (state: 'connecting' | 'open' | 'closed' | 'error') => void;
  /** Reports input RMS in 0..1 range (post-getUserMedia, pre-WS). */
  onInputLevel?: (rms: number) => void;
  /** Fires when round-trip latency to the orchestrator is measured (via ping/pong). */
  onLatency?: (rttMs: number) => void;
}

interface PlaybackSink {
  ctx: AudioContext;
  node: AudioWorkletNode;
  destination: MediaStreamAudioDestinationNode;
  stream: MediaStream;
}

/**
 * Manages the operator's WebSocket to the orchestrator, the AudioWorklet
 * pipeline that captures the chosen audio device as PCM16 16kHz, and one
 * playback sink per target language exposing an outbound MediaStream
 * suitable for LiveKit publishing.
 */
export class AudioEngine {
  private ws: WebSocket | null = null;
  private wsUrl: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private captureCtx: AudioContext | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelRaf: number | null = null;
  private mediaStream: MediaStream | null = null;
  private sinks = new Map<LanguageCode, PlaybackSink>();
  private closed = false;
  /** Smart-silence: tracks whether the current state is "silent enough to gate". */
  private silentSinceMs: number | null = null;
  private silentReported = false;

  constructor(private readonly cb: AudioEngineCallbacks) {}

  // ---------- Lifecycle ----------

  async connect(wsUrl: string): Promise<void> {
    this.wsUrl = wsUrl;
    this.cb.onConnectionChange('connecting');
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.cb.onConnectionChange('open');
        resolve();
      };
      ws.onerror = () => {
        this.cb.onConnectionChange('error');
        reject(new Error('orchestrator ws error'));
      };
    });

    ws.onmessage = (event) => this.handleWs(event);
    ws.onclose = () => {
      this.cb.onConnectionChange('closed');
      this.stopHeartbeat();
      this.scheduleReconnect();
    };
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.wsUrl) return;
    if (this.reconnectTimer) return;
    const attempt = ++this.reconnectAttempts;
    const delay = Math.min(15_000, 500 * Math.pow(2, attempt - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed || !this.wsUrl) return;
      this.cb.onConnectionChange('connecting');
      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.cb.onConnectionChange('open');
      };
      ws.onmessage = (event) => this.handleWs(event);
      ws.onerror = () => this.cb.onConnectionChange('error');
      ws.onclose = () => {
        this.cb.onConnectionChange('closed');
        this.scheduleReconnect();
      };
    }, delay);
  }

  send(msg: OperatorMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  async startCapture(deviceId: string | null): Promise<void> {
    if (this.captureCtx) return;
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.mediaStream = stream;

    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule('/worklets/pcm-capture.js');
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    /**
     * Jitter buffer for the upstream WS. WebSocket.send() is non-blocking but
     * the OS socket buffer can back up under WiFi congestion; we use
     * bufferedAmount to detect that and queue up to ~2s of audio rather than
     * dropping samples. If the queue grows beyond cap, we shed the oldest.
     */
    const sendQueue: ArrayBuffer[] = [];
    let draining = false;
    const MAX_QUEUE_FRAMES = 50; // ~2s at 40ms frames
    const HIGH_WATERMARK_BYTES = 256 * 1024;

    const drain = () => {
      draining = false;
      while (sendQueue.length > 0) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          sendQueue.length = 0;
          return;
        }
        if (this.ws.bufferedAmount > HIGH_WATERMARK_BYTES) {
          // Schedule next attempt after the socket drains a bit.
          draining = true;
          setTimeout(drain, 20);
          return;
        }
        const next = sendQueue.shift()!;
        this.ws.send(next);
      }
    };

    node.port.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.ws.bufferedAmount > HIGH_WATERMARK_BYTES || sendQueue.length > 0) {
        sendQueue.push(event.data);
        if (sendQueue.length > MAX_QUEUE_FRAMES) {
          // Network is too slow — shed the oldest frame to keep up.
          sendQueue.shift();
        }
        if (!draining) {
          draining = true;
          setTimeout(drain, 0);
        }
      } else {
        this.ws.send(event.data);
      }
    };
    src.connect(node);

    // Branch off an AnalyserNode for the level meter — runs entirely in the
    // browser and never touches the WS.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    this.analyser = analyser;
    this.startLevelLoop();

    this.captureCtx = ctx;
    this.captureNode = node;

    this.send({ type: 'audio.meta', sampleRate: 16000, channels: 1, codec: 'pcm16' });
  }

  private startLevelLoop(): void {
    if (!this.analyser) return;
    const buf = new Float32Array(this.analyser.fftSize);
    const tick = () => {
      if (this.closed || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
      const rms = Math.sqrt(sum / buf.length);
      this.cb.onInputLevel?.(rms);
      this.updateSilenceGate(rms);
      this.levelRaf = (typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame(tick)
        : (setTimeout(tick, 50) as unknown as number));
    };
    tick();
  }

  /**
   * Track silent stretches. After 5s below threshold, signal the orchestrator
   * to gate audio forwarding to OpenAI. Resume the moment speech returns.
   */
  private updateSilenceGate(rms: number): void {
    const SILENCE_THRESHOLD = 0.0035;  // ~ -49 dBFS
    const SILENCE_HOLD_MS   = 5_000;
    const now = Date.now();
    if (rms < SILENCE_THRESHOLD) {
      if (this.silentSinceMs === null) this.silentSinceMs = now;
      if (!this.silentReported && now - this.silentSinceMs >= SILENCE_HOLD_MS) {
        this.silentReported = true;
        this.send({ type: 'audio.silent', silent: true });
      }
    } else {
      this.silentSinceMs = null;
      if (this.silentReported) {
        this.silentReported = false;
        this.send({ type: 'audio.silent', silent: false });
      }
    }
  }

  async ensureSink(lang: LanguageCode): Promise<MediaStream> {
    const existing = this.sinks.get(lang);
    if (existing) return existing.stream;

    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule('/worklets/pcm-playback.js');
    const node = new AudioWorkletNode(ctx, 'pcm-playback', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const destination = ctx.createMediaStreamDestination();
    node.connect(destination);

    const sink: PlaybackSink = { ctx, node, destination, stream: destination.stream };
    this.sinks.set(lang, sink);
    this.cb.onLanguageStream(lang, sink.stream);
    return sink.stream;
  }

  /** The active capture MediaStream, or null if capture hasn't started. */
  getInputStream(): MediaStream | null {
    return this.mediaStream;
  }

  /** The translated-audio MediaStream for a given language, or null. */
  getOutputStream(lang: LanguageCode): MediaStream | null {
    return this.sinks.get(lang)?.stream ?? null;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.levelRaf !== null) {
      try {
        if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.levelRaf);
        else clearTimeout(this.levelRaf);
      } catch {/* noop */}
      this.levelRaf = null;
    }
    try {
      this.captureNode?.disconnect();
    } catch {/* noop */}
    try {
      await this.captureCtx?.close();
    } catch {/* noop */}
    this.mediaStream?.getTracks().forEach((t) => t.stop());

    for (const sink of this.sinks.values()) {
      try { sink.node.disconnect(); } catch {/* noop */}
      try { await sink.ctx.close(); } catch {/* noop */}
    }
    this.sinks.clear();

    try { this.ws?.close(); } catch {/* noop */}
  }

  // ---------- WS handling ----------

  private handleWs(event: MessageEvent) {
    if (event.data instanceof ArrayBuffer) {
      this.handleBinary(event.data);
      return;
    }
    try {
      const msg = JSON.parse(event.data) as OrchestratorMessage;
      if (msg.type === 'pong') {
        this.cb.onLatency?.(Math.max(0, Date.now() - msg.ts));
        return;
      }
      this.cb.onMessage(msg);
    } catch {
      // ignore
    }
  }

  /**
   * Binary frame format from orchestrator (translated audio):
   *   byte 0       : tag = 0x01
   *   byte 1       : language code length L (uint8)
   *   bytes 2..2+L : language code utf-8
   *   bytes 2+L..  : PCM16 LE mono @ 24 kHz
   */
  private handleBinary(buf: ArrayBuffer) {
    const view = new DataView(buf);
    const tag = view.getUint8(0);
    if (tag !== 0x01) return;
    const codeLen = view.getUint8(1);
    const code = new TextDecoder().decode(new Uint8Array(buf, 2, codeLen)) as LanguageCode;
    const audio = buf.slice(2 + codeLen); // ArrayBuffer of PCM16
    const sink = this.sinks.get(code);
    if (!sink) {
      // Sink not provisioned yet — the operator hasn't subscribed for this language locally.
      // Lazily create it so audio doesn't drop.
      void this.ensureSink(code).then((stream) => {
        // Re-enqueue this chunk after sink exists.
        const s = this.sinks.get(code);
        if (s) s.node.port.postMessage(audio, [audio]);
      });
      return;
    }
    // Transfer the underlying ArrayBuffer into the worklet to avoid copy.
    sink.node.port.postMessage(audio, [audio]);
  }
}
