'use client';

/**
 * Lightweight standalone level meter. Used pre-flight on the operator screen
 * so the AV team can verify their audio device is actually wired up before
 * burning OpenAI tokens. Independent of AudioEngine to avoid coupling the WS
 * lifecycle to "am I getting signal?".
 */
export class LevelTester {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private raf: number | null = null;
  private listener: ((rms: number, peak: number) => void) | null = null;

  async start(deviceId: string | null, onLevel: (rms: number, peak: number) => void): Promise<void> {
    await this.stop();
    this.listener = onLevel;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const src = ctx.createMediaStreamSource(this.stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    src.connect(analyser);
    this.ctx = ctx;
    this.analyser = analyser;
    this.tick();
  }

  private tick = () => {
    if (!this.analyser || !this.listener) return;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]!;
      sum += v * v;
      const av = Math.abs(v);
      if (av > peak) peak = av;
    }
    const rms = Math.sqrt(sum / buf.length);
    this.listener(rms, peak);
    this.raf = requestAnimationFrame(this.tick);
  };

  async stop(): Promise<void> {
    if (this.raf !== null) {
      try { cancelAnimationFrame(this.raf); } catch {/* noop */}
      this.raf = null;
    }
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch {/* noop */}
    this.stream = null;
    try { await this.ctx?.close(); } catch {/* noop */}
    this.ctx = null;
    this.analyser = null;
    this.listener = null;
  }
}
