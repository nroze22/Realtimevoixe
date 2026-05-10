/**
 * AudioWorklet: downsample mono Float32 input from the device sample rate
 * to 16 kHz, convert to PCM16LE, and post Int16 chunks (~40ms) back to the
 * main thread. Designed to feed OpenAI Realtime via the orchestrator WS.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.acc = 0;
    this.frameSamples = Math.floor(this.targetRate * 0.04); // 40ms
    this.buffer = new Int16Array(this.frameSamples);
    this.bufferIdx = 0;
    // Lowpass for naive antialiasing — simple 1st order filter.
    this.lpState = 0;
    this.lpAlpha = 0.2;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      // Lowpass
      this.lpState += this.lpAlpha * (ch[i] - this.lpState);
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        let s = this.lpState;
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        const i16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
        this.buffer[this.bufferIdx++] = i16;
        if (this.bufferIdx >= this.frameSamples) {
          // Transfer the underlying buffer to avoid copy.
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Int16Array(this.frameSamples);
          this.bufferIdx = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
