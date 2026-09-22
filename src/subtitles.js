// Shared renderer for recognition text and Agent answers. No audio or API calls.
export class SubtitleWriter {
  constructor(render, { interval = 24, hold = 30000 } = {}) {
    this.render = render; this.interval = interval; this.hold = hold;
    this.characters = []; this.shown = []; this.role = ''; this.target = null;
    this.segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  }
  begin() { this.target = null; }
  show(text, role = 'user') {
    if (!text || (text === this.target && role === this.role)) return;
    clearTimeout(this.timer); clearTimeout(this.expiry);
    const next = Array.from(this.segmenter.segment(text), item => item.segment);
    let prefix = 0;
    if (this.target !== null && this.role === role) {
      while (prefix < this.shown.length && this.shown[prefix] === next[prefix]) prefix++;
    }
    this.target = text; this.role = role; this.characters = next;
    this.shown = next.slice(0, prefix);
    const tick = () => {
      if (this.shown.length < this.characters.length) this.shown.push(this.characters[this.shown.length]);
      const typing = this.shown.length < this.characters.length;
      this.render(this.shown.join(''), this.role, typing);
      if (typing) this.timer = setTimeout(tick, this.interval);
      else this.expiry = setTimeout(() => this.render('', this.role, false), this.hold);
    };
    tick();
  }
  dispose() { clearTimeout(this.timer); clearTimeout(this.expiry); }
}
