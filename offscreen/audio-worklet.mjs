class AnySubtitlePcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = 16000;
    this.sourceRate = Number(options.processorOptions?.sourceSampleRate) || sampleRate;
    this.ratio = this.sourceRate / this.targetRate;
    this.pending = [];
    this.position = 0;
    this.chunk = new Int16Array(this.targetRate);
    this.chunkOffset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) {
      output.fill(0);
    }
    if (!input?.length) {
      return true;
    }
    for (const sample of input) {
      this.pending.push(sample);
    }
    while (this.position + this.ratio <= this.pending.length) {
      const start = Math.floor(this.position);
      const end = Math.min(this.pending.length, Math.floor(this.position + this.ratio));
      let sum = 0;
      let count = 0;
      for (let index = start; index < end; index += 1) {
        sum += this.pending[index];
        count += 1;
      }
      const value = Math.max(-1, Math.min(1, count ? sum / count : 0));
      this.chunk[this.chunkOffset] = value < 0 ? value * 32768 : value * 32767;
      this.chunkOffset += 1;
      this.position += this.ratio;
      if (this.chunkOffset === this.chunk.length) {
        this.port.postMessage({ type: "pcm", pcm: this.chunk.buffer }, [this.chunk.buffer]);
        this.chunk = new Int16Array(this.targetRate);
        this.chunkOffset = 0;
      }
    }
    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.pending.splice(0, consumed);
      this.position -= consumed;
    }
    return true;
  }
}

registerProcessor("any-subtitle-pcm", AnySubtitlePcmProcessor);
