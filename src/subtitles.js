// In-memory subtitles: one entry per speaker/turn, retained until this page closes.
// Recognition updates arrive immediately; assistant updates come from the audio clock.
export class SubtitleWriter {
  constructor(render) {
    this.render = render; this.entries = []; this.active = null; this.nextId = 0;
  }
  begin() { this.active = null; }
  show(text, role = 'user', speaking = false) {
    if (!text) return;
    if (!this.active || this.active.role !== role) {
      this.active = { id: ++this.nextId, role, text: '' };
      this.entries.push(this.active);
    }
    if (this.active.text === text && this.active.speaking === speaking) return;
    Object.assign(this.active, { text, speaking });
    this.render(text, role, speaking, this.active.id);
  }
  dispose() { this.active = null; this.entries = []; }
}

export function mountCaptionHistory(transcript, announcement, latest) {
  const nodes = new Map();
  let following = true;
  const atBottom = () => transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48;
  const onScroll = () => { following = atBottom(); latest.hidden = following; };
  const toLatest = () => { following = true; transcript.scrollTop = transcript.scrollHeight; latest.hidden = true; };
  transcript.addEventListener('scroll', onScroll);
  latest.addEventListener('click', toLatest);
  return {
    render(text, role, speaking, id) {
      let node = nodes.get(id);
      if (!node) {
        const message = document.createElement('article');
        message.className = 'conversation-message'; message.dataset.role = role;
        const label = document.createElement('small');
        label.textContent = { user: '你', assistant: 'BLUE', error: '提示' }[role] || role;
        node = document.createElement('p'); message.append(label, node);
        transcript.append(message); nodes.set(id, node);
      }
      node.textContent = text;
      node.parentElement.dataset.speaking = String(speaking);
      if (following) toLatest();
      else latest.hidden = false;
      if (!speaking) announcement.textContent = text;
    },
    dispose() { transcript.removeEventListener('scroll', onScroll); latest.removeEventListener('click', toLatest); nodes.clear(); },
  };
}
