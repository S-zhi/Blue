import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmStreamPlayer, TtsSession } from '../src/tts/session.js';

class AudioContext {
  state = 'suspended'; currentTime = 0; destination = {}; sources = []; buffers = [];
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createBuffer(channels, samples, rate) {
    const data = new Float32Array(samples);
    const buffer = { duration: samples / rate, getChannelData: () => data, data, rate };
    this.buffers.push(buffer); return buffer;
  }
  createBufferSource() {
    const source = { connect() {}, disconnect() {}, start(at) { this.startAt = at; }, stop() { this.stopped = true; }, end() { this.onended?.(); } };
    this.sources.push(source); return source;
  }
}

const health = { configured: true, format: 'pcm', sampleRate: 24000, protocolVersion: 'bidirectional-v3.2' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t, options = {}) {
  const events = [], sockets = [], contexts = [];
  class Context extends AudioContext {
    constructor() { super(); contexts.push(this); }
    resume() { events.push('resume'); return options.resume ? options.resume(this) : super.resume(); }
  }
  class Socket {
    readyState = 1; sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.onclose?.(); }
    json(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    pcm(bytes) { this.onmessage?.({ data: new Uint8Array(bytes).buffer }); }
  }
  const session = new TtsSession({
    AudioContext: Context, WebSocket: Socket,
    location: { href: 'http://localhost:3000/', protocol: 'http:' },
    fetch: (...args) => { events.push('fetch'); return options.fetch ? options.fetch(...args) : Promise.resolve({ ok: true, json: async () => options.health || health }); },
    timeoutMs: options.timeoutMs || 1000,
  });
  t.after(() => session.stop());
  return { session, sockets, contexts, events };
}
const ready = socket => socket.json({ type: 'ready', format: 'pcm_s16le', sampleRate: 24000 });

test('audio is unlocked synchronously in click before the first network request', async t => {
  const { session, events } = setup(t);
  const promise = session.speak('测试');
  const canceled = assert.rejects(promise, { code: 'ABORTED' });
  assert.deepEqual(events, ['resume']);
  await tick();
  assert.deepEqual(events, ['resume', 'fetch']);
  session.stop(); await canceled;
});

test('PCM signed samples survive odd chunk boundaries and preserve sample rate', async () => {
  const context = new AudioContext(); await context.resume();
  const player = new PcmStreamPlayer(context, 24000);
  player.append(new Uint8Array([0]).buffer);
  player.append(new Uint8Array([128, 255, 127]).buffer);
  assert.deepEqual([...context.buffers[0].data], [-1, 32767 / 32768]);
  assert.equal(context.buffers[0].rate, 24000);
  const completion = player.drain(); context.sources[0].end(); await completion;
});

test('done and socket close wait for the last audio source to actually finish', async t => {
  const { session, sockets, contexts } = setup(t);
  let settled = false;
  const pending = session.speak('你好').then(result => { settled = true; return result; });
  await tick();
  const socket = sockets[0]; ready(socket);
  socket.pcm([0, 64, 0, 192]);
  socket.json({ type: 'done', audioBytes: 4 }); socket.close();
  await tick();
  assert.equal(settled, false); assert.equal(contexts[0].state, 'running');
  contexts[0].sources[0].end();
  assert.equal((await pending).audioBytes, 4);
  assert.equal(contexts[0].state, 'closed');
});

test('no audio and all-zero audio produce clear errors rather than playback complete', async t => {
  for (const [bytes, code] of [[[], 'NO_AUDIO'], [[0, 0], 'SILENT_AUDIO']]) {
    const { session, sockets } = setup(t);
    const rejected = assert.rejects(session.speak('测试'), { code });
    await tick(); ready(sockets[0]);
    if (bytes.length) sockets[0].pcm(bytes);
    sockets[0].json({ type: 'done', audioBytes: bytes.length });
    await rejected;
  }
});

test('stop while fetching cancels promptly and does not open a stale socket', async t => {
  let finishFetch, signal;
  const { session, sockets, contexts } = setup(t, {
    fetch: (_url, options) => { signal = options.signal; return new Promise(resolve => { finishFetch = resolve; }); },
  });
  const rejected = assert.rejects(session.speak('测试'), { code: 'ABORTED' });
  await tick(); session.stop(); await rejected;
  assert.equal(signal.aborted, true); assert.equal(contexts[0].state, 'closed');
  finishFetch({ ok: true, json: async () => health }); await tick();
  assert.equal(sockets.length, 0);
});

test('blocked audio permission times out without contacting the provider', async t => {
  const { session, events, contexts } = setup(t, { resume: () => new Promise(() => {}), timeoutMs: 10 });
  await assert.rejects(session.speak('测试'), { code: 'PLAYBACK_BLOCKED' });
  assert.deepEqual(events, ['resume']); assert.equal(contexts[0].state, 'closed');
});

test('stopping during playback drains no extra time and permits immediate restart', async t => {
  const { session, sockets, contexts } = setup(t);
  const first = assert.rejects(session.speak('第一句'), { code: 'ABORTED' });
  await tick(); ready(sockets[0]); sockets[0].pcm([0, 64]); sockets[0].json({ type: 'done', audioBytes: 2 });
  const second = assert.rejects(session.speak('第二句'), { code: 'ABORTED' });
  await first; await tick();
  assert.equal(contexts[0].state, 'closed'); assert.equal(contexts[0].sources[0].stopped, true);
  assert.equal(contexts[1].state, 'running'); assert.equal(sockets.length, 2);
  session.stop(); await second;
});

test('a suspended audio device during playback fails instead of claiming success', async t => {
  const { session, sockets, contexts } = setup(t);
  const rejected = assert.rejects(session.speak('测试'), { code: 'PLAYBACK_INTERRUPTED' });
  await tick(); ready(sockets[0]); sockets[0].pcm([0, 64]);
  contexts[0].state = 'suspended'; contexts[0].onstatechange();
  await rejected;
});

test('old running server is detected with an actionable restart error', async t => {
  const { session, sockets } = setup(t, { health: { ...health, protocolVersion: undefined } });
  await assert.rejects(session.speak('测试'), { code: 'SERVER_OUTDATED' });
  assert.equal(sockets.length, 0);
});

test('large multibyte text stays below WebSocket per-message limits', async t => {
  const { session, sockets } = setup(t);
  const text = '测试😀'.repeat(3000);
  const rejected = assert.rejects(session.speak(text), { code: 'ABORTED' });
  await tick(); ready(sockets[0]);
  const chunks = sockets[0].sent.filter(message => message.type === 'text');
  assert.equal(chunks.map(message => message.text).join(''), text);
  assert.ok(chunks.every(message => Buffer.byteLength(JSON.stringify(message)) < 32768));
  session.stop(); await rejected;
});
