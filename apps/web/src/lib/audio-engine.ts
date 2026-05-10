'use client';

import type { LanguageCode, OperatorMessage, OrchestratorMessage } from '@rtv/shared';

export interface AudioEngineCallbacks {
  onMessage: (msg: OrchestratorMessage) => void;
  onLanguageStream: (lang: LanguageCode, stream: MediaStream) => void;
  onConnectionChange: (state: 'connecting' | 'open' | 'closed' | 'error') => void;
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
  private captureCtx: AudioContext | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private sinks = new Map<LanguageCode, PlaybackSink>();
  private closed = false;

  constructor(private readonly cb: AudioEngineCallbacks) {}

  // ---------- Lifecycle ----------

  async connect(wsUrl: string): Promise<void> {
    this.cb.onConnectionChange('connecting');
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this.cb.onConnectionChange('open');
        resolve();
      };
      ws.onerror = (err) => {
        this.cb.onConnectionChange('error');
        reject(new Error('orchestrator ws error'));
      };
    });

    ws.onmessage = (event) => this.handleWs(event);
    ws.onclose = () => {
      this.cb.onConnectionChange('closed');
    };
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
    node.port.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(event.data);
    };
    src.connect(node);

    this.captureCtx = ctx;
    this.captureNode = node;

    this.send({ type: 'audio.meta', sampleRate: 16000, channels: 1, codec: 'pcm16' });
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
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
