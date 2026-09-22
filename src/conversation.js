import { SubtitleWriter } from './subtitles.js';

export async function requestAgent(input, signal) {
  const response = await fetch('/api/agent/run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }), signal,
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Agent 服务不可用，请重新启动开发服务。');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `执行失败（${response.status}）`);
  return payload;
}

export class Conversation {
  constructor({ captions, request = requestAgent }) {
    this.captions = captions; this.request = request; this.revision = 0;
    this.tail = Promise.resolve(); this.pending = 0; this.disposed = false;
    this.microphone = 'pending'; this.listeners = new Set();
  }
  setMicrophone(available) {
    this.microphone = available ? 'available' : 'unavailable';
    for (const listener of this.listeners) listener(this.microphone);
  }
  subscribe(listener) {
    this.listeners.add(listener); listener(this.microphone);
    return () => this.listeners.delete(listener);
  }
  beginVoice() {
    this.revision++; this.voiceSubmitted = false; this.voiceText = '';
    this.captions.begin();
  }
  voiceResult(result) {
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (this.voiceSubmitted) return;
    if (text) { this.voiceText = text; this.captions.show(text, 'user'); }
    // Only the final ASR package can execute a command. Partial/definite
    // sentence updates remain display-only to avoid repeated side effects.
    if (result.final) {
      this.voiceSubmitted = true;
      if (this.voiceText) return this.execute(this.voiceText, this.revision);
    }
  }
  manual(text) {
    if (this.microphone !== 'unavailable' || !text.trim()) return Promise.resolve(false);
    const revision = ++this.revision;
    this.captions.begin(); this.captions.show(text.trim(), 'user');
    return this.execute(text.trim(), revision);
  }
  execute(text, revision) {
    if (this.pending >= 4) {
      this.captions.show('待处理指令较多，请稍后再说。', 'error');
      return Promise.resolve(false);
    }
    this.pending++;
    const task = async () => {
      if (this.disposed) return false;
      this.controller = new AbortController();
      const timer = setTimeout(() => this.controller?.abort(), 180000);
      try {
        const result = await this.request(text, this.controller.signal);
        const keys = (result.artifacts || []).filter(item => item.type === 'demo-secret' && typeof item.value === 'string');
        const answer = [result.output || '', ...keys.filter(item => !(result.output || '').includes(item.value)).map(item => `演示密钥：${item.value}`)].filter(Boolean).join('\n');
        if (!this.disposed && revision === this.revision) this.captions.show(answer || '模型没有返回文字，请重试。', 'assistant');
        return true;
      } catch (error) {
        if (!this.disposed && revision === this.revision) this.captions.show(error.name === 'AbortError' ? '执行等待超时，请稍后重试。' : `执行未完成：${error.message}`, 'error');
        return false;
      } finally { clearTimeout(timer); this.controller = null; }
    };
    const running = this.tail.then(task).finally(() => { this.pending--; });
    this.tail = running.catch(() => {});
    return running;
  }
  dispose() { this.disposed = true; this.controller?.abort(); this.captions.dispose(); this.listeners.clear(); }
}

let shared;
export function getConversation() {
  if (!shared) {
    const transcript = document.querySelector('#voice-transcript');
    const announcement = document.querySelector('#voice-announcement');
    const captions = new SubtitleWriter((text, role, typing) => {
      transcript.textContent = text;
      transcript.dataset.role = role;
      transcript.dataset.typing = String(typing);
      transcript.scrollTop = transcript.scrollHeight;
      if (!typing) announcement.textContent = text;
    });
    shared = new Conversation({ captions });
  }
  return shared;
}
if (import.meta.hot) import.meta.hot.dispose(() => { shared?.dispose(); shared = null; });
