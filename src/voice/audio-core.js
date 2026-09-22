export const TARGET_RATE = 16000;
export const FRAME_SAMPLES = 320; // 20 ms; independent from the 200 ms network packets.

// Streaming weighted-average resampling preserves fractional positions at 44.1 kHz.
export class PcmFramer {
  constructor(inputRate, onFrame) {
    if (!Number.isFinite(inputRate) || inputRate <= 0) throw new Error('Invalid input sample rate');
    this.ratio = inputRate / TARGET_RATE;
    this.onFrame = onFrame;
    this.sum = 0; this.weight = 0; this.index = 0; this.energy = 0; this.peak = 0;
    this.buffer = new ArrayBuffer(FRAME_SAMPLES * 2);
    this.view = new DataView(this.buffer);
  }
  push(samples) {
    for (const input of samples) {
      let remaining = 1;
      const sample = Number.isFinite(input) ? Math.max(-1, Math.min(1, input)) : 0;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          this.emitSample(this.sum / this.ratio);
          this.weight = 0; this.sum = 0;
        }
      }
    }
  }
  emitSample(sample) {
    this.view.setInt16(this.index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    this.energy += sample * sample; this.peak = Math.max(this.peak, Math.abs(sample));
    if (++this.index === FRAME_SAMPLES) this.emitFrame();
  }
  emitFrame() {
    if (!this.index) return;
    const pcm = this.buffer.slice(0, this.index * 2);
    this.onFrame({ pcm, rms: Math.sqrt(this.energy / this.index), peak: this.peak, durationMs: this.index / 16 });
    this.index = 0; this.energy = 0; this.peak = 0;
  }
  flush() {
    if (this.weight > 0) this.emitSample(this.sum / this.weight);
    this.weight = 0; this.sum = 0;
    this.emitFrame();
  }
}

export class VoiceActivityDetector {
  constructor({ attackMs = 60, releaseMs = 600 } = {}) {
    this.attackMs = attackMs; this.releaseMs = releaseMs;
    this.noise = .003; this.speaking = false; this.activeMs = 0; this.quietMs = 0;
  }
  update(rms, durationMs = 20) {
    const startThreshold = Math.max(.012, Math.min(.06, this.noise * 3));
    const stopThreshold = Math.max(.007, Math.min(.04, this.noise * 1.8));
    const previous = this.speaking;
    if (!this.speaking) {
      this.activeMs = rms >= startThreshold ? this.activeMs + durationMs : 0;
      if (rms < startThreshold * .8) this.noise += (rms - this.noise) * .02;
      if (this.activeMs >= this.attackMs) { this.speaking = true; this.quietMs = 0; }
    } else {
      this.quietMs = rms < stopThreshold ? this.quietMs + durationMs : 0;
      if (this.quietMs >= this.releaseMs) { this.speaking = false; this.activeMs = 0; }
    }
    return { speaking: this.speaking, changed: previous !== this.speaking, level: Math.min(1, rms / .12), startThreshold, stopThreshold };
  }
}

export class Packetizer {
  constructor(onPacket, bytesPerPacket = 6400) {
    this.onPacket = onPacket; this.bytesPerPacket = bytesPerPacket;
    this.pending = new Uint8Array(bytesPerPacket); this.length = 0;
  }
  push(buffer) {
    const bytes = new Uint8Array(buffer);
    let offset = 0;
    while (offset < bytes.length) {
      const count = Math.min(this.bytesPerPacket - this.length, bytes.length - offset);
      this.pending.set(bytes.subarray(offset, offset + count), this.length);
      this.length += count; offset += count;
      if (this.length === this.bytesPerPacket) this.flush();
    }
  }
  flush() {
    if (!this.length) return;
    const packet = this.pending.slice(0, this.length);
    this.length = 0;
    this.onPacket(packet);
  }
}
