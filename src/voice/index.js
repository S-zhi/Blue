import { SpeechSession } from './session.js';
import { CaptionRetention } from './timing.js';

const EMOTIONS = { angry: '生气', happy: '开心', neutral: '平静', sad: '悲伤', surprise: '惊讶' };
const STATES = {
  idle: '语音待命', requesting: '准备麦克风…', connecting: '正在连接云端…',
  listening: '正在聆听', speaking: '检测到声音', waiting: '等待继续说话', finalizing: '正在确认最终字幕…', done: '识别完成', error: '识别未完成',
};
export function mountVoice() {
  const panel = document.querySelector('#voice-panel');
  const toggle = document.querySelector('#voice-toggle');
  const status = document.querySelector('#voice-status');
  const transcript = document.querySelector('#voice-transcript');
  const errorBox = document.querySelector('#voice-error');
  const clear = document.querySelector('#voice-clear');
  const elapsed = document.querySelector('#voice-duration');
  const sideReadout = document.querySelector('#side-readout');
  const countdown = document.querySelector('#voice-countdown');
  const announcement = document.querySelector('#voice-announcement');
  const retention = new CaptionRetention(() => {
    transcript.replaceChildren();
    transcript.className = 'voice-transcript empty';
    announcement.textContent = '';
  });
  let previousFinal = '';
  function reset({ keepCaption = false } = {}) {
    if (!keepCaption) {
      retention.clear();
      transcript.replaceChildren();
      transcript.className = 'voice-transcript empty';
      announcement.textContent = '';
    }
    errorBox.textContent = '';
    elapsed.textContent = '00:00';
    previousFinal = '';
    for (const id of ['voice-age', 'voice-gender', 'voice-emotion', 'voice-speaker']) document.getElementById(id).textContent = '—';
  }
  const session = new SpeechSession({
    onState(state) {
      panel.dataset.state = state;
      const voiceMode = session.active || state === 'done' || state === 'error';
      sideReadout.dataset.mode = voiceMode ? 'voice' : 'render';
      sideReadout.setAttribute('aria-label', voiceMode ? '实时语音特征估计' : '实时渲染信息');
      status.textContent = STATES[state];
      toggle.textContent = ['requesting', 'connecting'].includes(state) ? '取消连接' : state === 'finalizing' ? '确认中…' : ['listening', 'speaking', 'waiting'].includes(state) ? '结束识别' : '开启语音';
      toggle.disabled = state === 'finalizing';
      toggle.setAttribute('aria-pressed', String(['listening', 'speaking', 'waiting'].includes(state)));
      clear.disabled = session.active;
    },
    onLevel(level) { panel.style.setProperty('--voice-level', level.toFixed(3)); },
    onCountdown(seconds) {
      const text = seconds === null ? '静音 10 秒 · 自动结束' : `${seconds} 秒后结束 · 说话即可继续`;
      if (countdown.textContent !== text) countdown.textContent = text;
    },
    onSpeech(speaking) {
      window.dispatchEvent(new CustomEvent('ring:set-state', { detail: { state: 'normal', motion: speaking ? 'pulse' : 'flow' } }));
    },
    onError(message) { errorBox.textContent = message; },
    onResult(result) {
      const utterances = Array.isArray(result.utterances) ? result.utterances : [];
      const text = typeof result.text === 'string' ? result.text : '';
      const showCaption = retention.update(text);
      if (showCaption) {
        transcript.replaceChildren();
        transcript.className = 'voice-transcript';
        // The cloud sends the full hypothesis. Replace it; never append snapshots.
        if (utterances.length && utterances.map(utterance => utterance.text).join('') === text) {
          for (const utterance of utterances) {
            const span = document.createElement('span');
            span.className = utterance.definite || result.final ? 'confirmed' : 'interim';
            span.textContent = utterance.text;
            transcript.append(span);
          }
        } else {
          const span = document.createElement('span');
          span.className = result.final ? 'confirmed' : 'interim'; span.textContent = text || (result.final ? '未识别到有效语音。' : '正在识别…');
          transcript.append(span);
        }
        transcript.scrollTop = transcript.scrollHeight;
      }
      const attributes = result.attributes || {};
      const pending = result.final ? '未返回' : '等待分句';
      document.querySelector('#voice-age').textContent = typeof attributes.age === 'number' ? `约 ${Math.round(attributes.age)} 岁` : pending;
      document.querySelector('#voice-gender').textContent = ({ male: '男声', female: '女声' })[attributes.gender] || pending;
      document.querySelector('#voice-emotion').textContent = EMOTIONS[attributes.emotion] || pending;
      document.querySelector('#voice-speaker').textContent = attributes.speaker === null || attributes.speaker === undefined ? '—' : `S${attributes.speaker}`;
      if (Number.isFinite(result.duration)) {
        const seconds = Math.floor(result.duration / 1000);
        elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }
      const finalText = result.final ? text : utterances.filter(utterance => utterance.definite).map(utterance => utterance.text).join('');
      if (finalText && finalText !== previousFinal) {
        document.querySelector('#voice-announcement').textContent = finalText;
        previousFinal = finalText;
      }
    },
  });
  function onToggle() {
    if (session.active) session.stop();
    else { reset({ keepCaption: true }); retention.beginTurn(); session.start(); }
  }
  function onClear() { if (!session.active) reset(); }
  function onPageHide() { session.destroy(); retention.clear(); transcript.replaceChildren(); }
  toggle.addEventListener('click', onToggle);
  clear.addEventListener('click', onClear);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    session.destroy();
    retention.clear();
    toggle.removeEventListener('click', onToggle); clear.removeEventListener('click', onClear);
    window.removeEventListener('pagehide', onPageHide);
  };
}
