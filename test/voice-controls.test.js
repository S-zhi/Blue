import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the production event wiring with controllable microphone states.
const source = (await readFile(new URL('../src/voice/index.js', import.meta.url), 'utf8'))
  .replace("import { SpeechSession } from './session.js';", 'const SpeechSession = null;')
  .replace("import { getConversation } from '../conversation.js';", 'const getConversation = () => globalThis.voiceTestConversation;');
const { mountVoice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class Element extends EventTarget {
  dataset = {}; attributes = {}; textContent = ''; disabled = false;
  setAttribute(name, value) { this.attributes[name] = value; }
}

test('only ring clicks enable capture; stop, completion, focus and TTS never rearm it', t => {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const document = new EventTarget();
  Object.assign(document, { visibilityState: 'visible', hasFocus: () => true, querySelector: element, getElementById: id => element(`#${id}`) });
  const window = new EventTarget();
  const calls = []; window.blueTts = { stop: () => calls.push('tts:stop'), unlock: () => calls.push('tts:unlock') };
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('Auto-listening timer is forbidden'); });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = window; globalThis.document = document;
  globalThis.voiceTestConversation = { beginVoice: () => calls.push('turn'), setMicrophone() {}, onStatus() {}, pending: 0 };
  let session;
  class Session {
    state = 'idle';
    constructor(callbacks) { Object.assign(this, callbacks); session = this; }
    get active() { return ['requesting', 'armed', 'listening', 'finalizing'].includes(this.state); }
    change(state) { this.state = state; this.onState(state); }
    start() { calls.push('start'); this.change('requesting'); this.change('armed'); }
    stop() { calls.push('stop'); this.change('finalizing'); }
    destroy() { calls.push('destroy'); this.state = 'idle'; }
  }
  const unmount = mountVoice({ Session });
  t.after(() => { unmount(); Object.assign(globalThis, previous); delete globalThis.voiceTestConversation; });
  const toggle = element('#voice-toggle');
  document.dispatchEvent(new Event('pointerdown')); document.dispatchEvent(new Event('keydown'));
  window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('tts:end'));
  assert.equal(calls.filter(value => value === 'start').length, 0);
  toggle.dispatchEvent(new Event('click'));
  assert.deepEqual(calls.slice(0, 4), ['tts:stop', 'tts:unlock', 'start', 'turn']);
  assert.equal(toggle.attributes['aria-pressed'], 'true');
  toggle.dispatchEvent(new Event('click')); assert.equal(toggle.disabled, true);
  session.change('done'); assert.equal(toggle.disabled, false);
  window.dispatchEvent(new Event('tts:end')); window.dispatchEvent(new Event('focus'));
  assert.equal(calls.filter(value => value === 'start').length, 1);
  toggle.dispatchEvent(new Event('click'));
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(session.state, 'idle'); assert.equal(toggle.attributes['aria-pressed'], 'false');
  document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls.filter(value => value === 'start').length, 2);
  window.dispatchEvent(new Event('tts:start')); window.dispatchEvent(new Event('tts:end'));
  assert.equal(calls.filter(value => value === 'start').length, 2);
});
