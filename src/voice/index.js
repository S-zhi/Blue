import { SpeechSession } from './session.js';
import { getConversation } from '../conversation.js';

const EMOTIONS = { angry: '生气', happy: '开心', neutral: '平静', sad: '悲伤', surprise: '惊讶' };
export function mountVoice({ Session = SpeechSession } = {}) {
  const panel = document.querySelector('#voice-panel');
  const toggle = document.querySelector('#voice-toggle');
  const label = document.querySelector('#voice-toggle-label');
  const conversation = getConversation();
  const errorBox = document.querySelector('#voice-error');

  const sideReadout = document.querySelector('#side-readout');
  let disposed = false, emotion = 'neutral', speaking = false;
  const foreground = () => document.visibilityState === 'visible' && document.hasFocus();
  function updateRing() {
    window.dispatchEvent(new CustomEvent('ring:set-state', { detail: { state: `emotion_${emotion}`, motion: speaking ? 'pulse' : 'flow' } }));
  }
  function reset() {
    errorBox.textContent = '';
    for (const id of ['voice-age', 'voice-gender', 'voice-emotion', 'voice-speaker']) document.getElementById(id).textContent = '—';
  }
  const session = new Session({
    onState(state) {
      panel.dataset.state = state;
      const voiceMode = session.active || state === 'done' || state === 'error' || sideReadout.dataset.mode === 'voice';
      sideReadout.dataset.mode = voiceMode ? 'voice' : 'render';
      sideReadout.setAttribute('aria-label', voiceMode ? '实时语音特征估计' : '实时渲染信息');
      const listening = session.active && state !== 'finalizing';
      toggle.setAttribute('aria-pressed', String(listening));
      toggle.setAttribute('aria-label', listening ? '停止语音识别' : '开始语音识别');
      toggle.disabled = state === 'finalizing';
      label.textContent = state === 'finalizing' ? '正在识别…' : listening ? '点击停止监听' : '点击开始说话';
      toggle.dataset.state = state;
      if (state === 'requesting') { reset(); conversation.beginVoice(); }
      if (state === 'armed') errorBox.textContent = '';
      if (['idle', 'error', 'done'].includes(state) && !conversation.pending) conversation.onStatus('');
    },
    onGesture() { errorBox.textContent = '点击圆环启用麦克风声音。'; },
    onMicrophone(available) { conversation.setMicrophone(available); },
    onLevel() {},
    onSpeech(value) { speaking = value; updateRing(); },
    onError(message) { errorBox.textContent = message; label.textContent = '点击重试'; },
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
  function resetSession() { session.destroy(); session.change('idle'); }
  function onToggle() {
    if (disposed || !foreground()) return;
    if (session.active) { session.stop(); return; }
    window.blueTts?.stop();
    window.blueTts?.unlock();
    session.start();
  }
  function onForeground() { if (!foreground()) resetSession(); }
  function onPageHide() { resetSession(); }
  function onTtsStart() { resetSession(); }
  toggle.addEventListener('click', onToggle);
  document.addEventListener('visibilitychange', onForeground);
  window.addEventListener('blur', onForeground);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('tts:start', onTtsStart);
  return () => {
    disposed = true; session.destroy();
    toggle.removeEventListener('click', onToggle);
    document.removeEventListener('visibilitychange', onForeground);
    window.removeEventListener('blur', onForeground);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('tts:start', onTtsStart);
  };
}
