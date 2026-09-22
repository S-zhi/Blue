export const END_SILENCE_MS = 10000;
export const CAPTION_HOLD_MS = 30000;

// Count captured audio time, not rendering frames or cloud response latency.
export class TurnEndDetector {
  constructor(silenceMs = END_SILENCE_MS) {
    this.silenceMs = silenceMs;
    this.started = false;
    this.quietMs = 0;
    this.ended = false;
  }
  update(rms, durationMs, activity) {
    if (activity.speaking) this.started = true;
    if (!this.started || this.ended) return { waiting: false, remainingMs: null, ended: this.ended };
    // Cancel a pending ending on the first audible frame; the separate VAD
    // still requires 60 ms before switching the ring to its speaking pulse.
    this.quietMs = rms >= activity.stopThreshold ? 0 : this.quietMs + durationMs;
    this.ended = this.quietMs >= this.silenceMs;
    return {
      waiting: this.quietMs >= 600,
      remainingMs: Math.max(0, this.silenceMs - this.quietMs),
      ended: this.ended,
    };
  }
}

export class CaptionRetention {
  constructor(onExpire, holdMs = CAPTION_HOLD_MS) {
    this.onExpire = onExpire;
    this.holdMs = holdMs;
    this.text = '';
    this.visible = false;
  }
  update(text) {
    if (!text) return false;
    if (this.newTurn || text !== this.text) {
      clearTimeout(this.timer);
      this.newTurn = false;
      this.text = text;
      this.visible = true;
      this.timer = setTimeout(() => {
        this.visible = false;
        this.onExpire();
      }, this.holdMs);
    }
    // Repeated hypotheses or a final flag alone must not extend the lifetime
    // or resurrect an expired caption.
    return this.visible;
  }
  beginTurn() { this.newTurn = true; }
  clear() {
    clearTimeout(this.timer);
    this.text = '';
    this.visible = false;
    this.newTurn = false;
  }
}
