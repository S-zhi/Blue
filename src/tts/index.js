import { TtsSession } from './session.js';

// Conversation playback has no standalone preview form.
export function mountTts() {
  let operation = 0, active = false;
  const announce = type => window.dispatchEvent(new CustomEvent(type));
  const session = new TtsSession();
  const speak = async (text, options) => {
    const current = ++operation;
    active = true; announce('tts:start');
    try { return await session.speak(text, options); }
    finally {
      if (current === operation) { active = false; announce('tts:end'); }
    }
  };
  const stop = () => {
    ++operation; session.stop();
    if (active) announce('tts:end');
    active = false;
  };
  // Unlock on the ring/input click, before recognition and Agent network awaits.
  const unlock = () => session.unlock().catch(() => {});
  const api = Object.freeze({ speak, stop, unlock });
  window.blueTts = api;
  const onPageHide = () => { stop(); session.dispose(); };
  window.addEventListener('pagehide', onPageHide);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    stop(); session.dispose();
    if (window.blueTts === api) delete window.blueTts;
  };
}
