import { SpeechSession } from './session.js';
import { getConversation } from '../conversation.js';

const EMOTIONS = { angry: '生气', happy: '开心', neutral: '平静', sad: '悲伤', surprise: '惊讶' };
export function mountVoice() {
  const panel = document.querySelector('#voice-panel');
  const permission = document.querySelector('#voice-permission');
  const conversation = getConversation();
  const errorBox = document.querySelector('#voice-error');

  const sideReadout = document.querySelector('#side-readout');
  let disposed = false, retryTimer, emotion = 'neutral', speaking = false, blocked = false;
  const foreground = () => document.visibilityState === 'visible' && document.hasFocus();
  function updateRing() {
    window.dispatchEvent(new CustomEvent('ring:set-state', { detail: { state: `emotion_${emotion}`, motion: speaking ? 'pulse' : 'flow' } }));
  }
  function reset() {
    errorBox.textContent = '';
    for (const id of ['voice-age', 'voice-gender', 'voice-emotion', 'voice-speaker']) document.getElementById(id).textContent = '—';
  }
  const session = new SpeechSession({
    onState(state) {
      panel.dataset.state = state;
      const voiceMode = session.active || state === 'done' || state === 'error';
      sideReadout.dataset.mode = voiceMode ? 'voice' : 'render';
      sideReadout.setAttribute('aria-label', voiceMode ? '实时语音特征估计' : '实时渲染信息');
      if (state === 'connecting') { reset(); conversation.beginVoice(); }
      if (state === 'armed') { permission.hidden = true; errorBox.textContent = ''; }
      if (state === 'done') retryTimer = setTimeout(activate, 400);
    },
    onGesture() { permission.hidden = false; permission.textContent = '允许麦克风 · 自动感知'; },
    onMicrophone(available) { conversation.setMicrophone(available); },
    onLevel() {},
    onSpeech(value) { speaking = value; updateRing(); },
    onError(message) { blocked = true; errorBox.textContent = message; permission.hidden = false; permission.textContent = '重试语音感知'; },
    onResult(result) {
      conversation.voiceResult(result);
      const attributes = result.attributes || {};
      const pending = result.final ? '未返回' : '等待分句';
      document.querySelector('#voice-age').textContent = typeof attributes.age === 'number' ? `约 ${Math.round(attributes.age)} 岁` : pending;
      document.querySelector('#voice-gender').textContent = ({ male: '男声', female: '女声' })[attributes.gender] || pending;
      document.querySelector('#voice-emotion').textContent = EMOTIONS[attributes.emotion] || pending;
      document.querySelector('#voice-speaker').textContent = attributes.speaker === null || attributes.speaker === undefined ? '—' : `S${attributes.speaker}`;
      if (Object.hasOwn(EMOTIONS, attributes.emotion)) { emotion = attributes.emotion; updateRing(); }
    },
  });
  async function activate() {
    if (disposed || blocked || !foreground() || session.active) return;
    await session.start();
  }
  function onForeground() {
    clearTimeout(retryTimer);
    if (!foreground()) session.destroy();
    else activate();
  }
  function unlock() {
    blocked = false;
    // Resume suspended audio on a trusted gesture when browser policy requires it.
    session.context?.resume().catch(() => {});
    activate();
  }
  function onPageHide() { session.destroy(); }
  permission.addEventListener('click', unlock);
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('visibilitychange', onForeground);
  window.addEventListener('focus', onForeground);
  window.addEventListener('blur', onForeground);
  window.addEventListener('pagehide', onPageHide);
  activate();
  return () => {
    disposed = true; clearTimeout(retryTimer); session.destroy();
    permission.removeEventListener('click', unlock);
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    document.removeEventListener('visibilitychange', onForeground);
    window.removeEventListener('focus', onForeground);
    window.removeEventListener('blur', onForeground);
    window.removeEventListener('pagehide', onPageHide);
  };
}
