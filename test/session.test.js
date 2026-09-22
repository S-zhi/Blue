import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import { startAsrSession } from '../server/asr.js';
import { getConfig } from '../server/config.js';

class FakeSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(data, callback) { this.sent.push(data); callback?.(); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
}
const config = getConfig({ DOUBAO_API_KEY: 'local-test-key' });
const browserMessages = socket => socket.sent.map(message => JSON.parse(message));
function setup(t) {
  const client = new FakeSocket(), upstream = new FakeSocket();
  startAsrSession(client, config, () => upstream);
  t.after(() => { client.close(); upstream.terminate(); });
  return { client, upstream };
}
test('BFF session sends all requested feature flags, PCM, and the final marker in order', t => {
  const { client, upstream } = setup(t);
  upstream.emit('open');
  const payload = JSON.parse(gunzipSync(upstream.sent[0].subarray(8)));
  assert.equal(payload.request.enable_gender_detection, true);
  assert.equal(payload.request.enable_age_detection, true);
  assert.equal(payload.request.enable_emotion_detection, true);
  assert.equal(browserMessages(client)[0].type, 'ready');
  client.emit('message', Buffer.alloc(6400, 7), true);
  client.emit('message', Buffer.from('{"type":"finish"}'), false);
  assert.equal(upstream.sent[1][1], 0x20); assert.equal(upstream.sent[2][1], 0x22);
  assert.deepEqual(gunzipSync(upstream.sent[1].subarray(8)), Buffer.alloc(6400, 7));
  assert.equal(gunzipSync(upstream.sent[2].subarray(8)).length, 0);
});
test('BFF delivers final transcript before closing and normalizes SDK envelopes', t => {
  const { client, upstream } = setup(t);
  upstream.emit('open');
  upstream.emit('message', Buffer.from(JSON.stringify({ code: 0, is_last_package: true, payload_msg: { result: { text: '测试完成', utterances: [{ text: '测试完成', additions: { age: '33', gender: 'male', emotion: 'neutral' } }] } } })), false);
  const result = browserMessages(client).find(message => message.type === 'result');
  assert.equal(result.text, '测试完成'); assert.equal(result.final, true); assert.equal(result.attributes.age, 33);
  assert.equal(client.readyState, 3); assert.equal(upstream.readyState, 3);
});
test('backpressure stops forwarding instead of growing an unbounded queue', t => {
  const { client, upstream } = setup(t); upstream.emit('open'); upstream.bufferedAmount = 150000;
  client.emit('message', Buffer.alloc(6400), true);
  assert.equal(browserMessages(client).at(-1).code, 'BACKPRESSURE'); assert.equal(upstream.sent.length, 1);
});
test('empty terminal acknowledgement retains the latest transcript and attributes', t => {
  const { client, upstream } = setup(t); upstream.emit('open');
  upstream.emit('message', Buffer.from(JSON.stringify({ result: {
    text: '保留最后一句。', utterances: [{ text: '保留最后一句。', definite: false, additions: { age: '28.5', emotion: 'happy' } }],
  } })), false);
  upstream.emit('message', Buffer.from(JSON.stringify({ is_last_package: true, payload_msg: { audio_info: { duration: 2000 } } })), false);
  const result = browserMessages(client).at(-1);
  assert.equal(result.type, 'result'); assert.equal(result.final, true);
  assert.equal(result.text, '保留最后一句。'); assert.equal(result.duration, 2000);
  assert.equal(result.attributes.age, 28.5); assert.equal(result.attributes.emotion, 'happy');
  assert.equal(result.utterances[0].definite, true);
  assert.equal(client.readyState, 3); assert.equal(upstream.readyState, 3);
});
test('provider errors are sanitized, preserving codes without echoing arbitrary bodies', t => {
  const { client, upstream } = setup(t); upstream.emit('open');
  upstream.emit('message', Buffer.from(JSON.stringify({ code: 45000001, message: 'private upstream detail' })), false);
  const error = browserMessages(client).at(-1);
  assert.equal(error.code, 'PROVIDER_45000001'); assert.ok(!error.message.includes('private upstream detail'));
});
test('malformed PCM packets abort the session and release its upstream', t => {
  const { client, upstream } = setup(t); upstream.emit('open'); client.emit('message', Buffer.alloc(3), true);
  assert.equal(browserMessages(client).at(-1).code, 'INVALID_AUDIO'); assert.equal(upstream.readyState, 3);
});
