export const CAPTION_HOLD_MS = 30000;
export class TranscriptDeadline {
  constructor(onEnd, delay = 10000) { this.onEnd = onEnd; this.delay = delay; this.text = ''; }
  start() { this.clear(); this.text = ''; this.running = true; this.arm(); }
  arm() { clearTimeout(this.timer); this.timer = setTimeout(() => { this.running = false; this.onEnd(); }, this.delay); }
  update(text) {
    if (!this.running || typeof text !== 'string' || !text.trim() || text === this.text) return;
    this.text = text;
    this.arm();
  }
  clear() { clearTimeout(this.timer); this.running = false; }
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
