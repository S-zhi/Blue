import { TtsSession } from './session.js';

export function mountTts() {
  const form = document.querySelector('#tts-panel');
  const input = document.querySelector('#tts-text');
  const speakButton = document.querySelector('#tts-speak');
  const stopButton = document.querySelector('#tts-stop');
  const status = document.querySelector('#tts-status');
  let operation = 0, active = false;
  const setState = (state, message) => {
    if (form) form.dataset.state = state;
    if (status) status.textContent = message;
    if (speakButton) speakButton.disabled = state === 'playing';
    if (stopButton) stopButton.disabled = state !== 'playing';
  };
  const announce = type => window.dispatchEvent(new CustomEvent(type));
  const session = new TtsSession({
    onProgress({ stage, audioBytes }) {
      const message = { unlocking: '正在启用声音…', connecting: '正在连接语音服务…', synthesizing: '正在合成，等待音频…', playing: '正在播放…' }[stage];
      setState('playing', message || '正在处理…');
      if (form && audioBytes !== undefined) form.dataset.audioBytes = String(audioBytes);
    },
  });
  const speak = async text => {
    const current = ++operation;
    active = true; setState('playing', '正在启用声音…');
    if (form) { form.dataset.audioBytes = '0'; delete form.dataset.errorCode; }
    announce('tts:start');
    try {
      await session.speak(text);
      if (current === operation) setState('done', '播放完成');
    } catch (error) {
      if (current === operation) {
        const code = typeof error.code === 'string' ? error.code : 'TTS_ERROR';
        if (form) form.dataset.errorCode = code;
        setState('error', `${error.message || '语音合成失败'}（${code}）`);
        throw error;
      }
    } finally {
      if (current === operation) { active = false; announce('tts:end'); }
    }
  };
  const stop = () => {
    ++operation; session.stop();
    if (active) announce('tts:end');
    active = false; setState('idle', '已停止');
  };
  const api = Object.freeze({
    speak,
    stop,
  });
  window.blueTts = api;
  const onSubmit = event => {
    event.preventDefault();
    const text = input?.value.trim();
    if (!text) return setState('error', '请输入待合成文本');
    speak(text).catch(() => {});
  };
  form?.addEventListener('submit', onSubmit);
  stopButton?.addEventListener('click', stop);
  window.addEventListener('pagehide', stop);
  return () => {
    form?.removeEventListener('submit', onSubmit);
    stopButton?.removeEventListener('click', stop);
    window.removeEventListener('pagehide', stop);
    stop();
    if (window.blueTts === api) delete window.blueTts;
  };
}
