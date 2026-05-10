/**
 * AudioWorklet: receives PCM16 LE chunks at 24 kHz (gpt-realtime output rate)
 * via postMessage, queues them, and renders them to a single mono channel at
 * the AudioContext's native rate using simple linear interpolation.
 *
 * The output node is captured via MediaStreamAudioDestinationNode so it can
 * be published to LiveKit as a normal WebRTC audio track.
 */
class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Continuous Float32 buffer of source samples at 24 kHz. */
    this.buffer = new Float32Array(0);
    this.readIdx = 0;       // fractional read cursor (in src samples)
    this.srcRate = 24000;
    this.step = this.srcRate / sampleRate; // src samples consumed per dst sample

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data === 'flush') {
        this.buffer = new Float32Array(0);
        this.readIdx = 0;
        return;
      }
      if (!data || data.byteLength == null) return;

      const int16 = new Int16Array(data);
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        const v = int16[i];
        f32[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
      }

      // Trim what we've already consumed so the buffer doesn't grow unbounded.
      const consumed = Math.floor(this.readIdx);
      if (consumed > 0 && consumed < this.buffer.length) {
        const remaining = this.buffer.length - consumed;
        const merged = new Float32Array(remaining + f32.length);
        merged.set(this.buffer.subarray(consumed));
        merged.set(f32, remaining);
        this.buffer = merged;
        this.readIdx -= consumed;
      } else if (consumed >= this.buffer.length) {
        this.buffer = f32;
        this.readIdx = 0;
      } else {
        const merged = new Float32Array(this.buffer.length + f32.length);
        merged.set(this.buffer);
        merged.set(f32, this.buffer.length);
        this.buffer = merged;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const ch = output[0];
    if (!ch) return true;

    const buf = this.buffer;
    for (let i = 0; i < ch.length; i++) {
      const idx = this.readIdx;
      const i0 = Math.floor(idx);
      const i1 = i0 + 1;
      if (i1 >= buf.length) {
        // Underrun — output silence and don't advance.
        ch[i] = 0;
        continue;
      }
      const t = idx - i0;
      ch[i] = buf[i0] * (1 - t) + buf[i1] * t;
      this.readIdx += this.step;
    }
    return true;
  }
}

registerProcessor('pcm-playback', PcmPlaybackProcessor);
