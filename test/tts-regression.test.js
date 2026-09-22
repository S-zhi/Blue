import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import { decodeTtsResponse, TTS_EVENT } from '../server/tts-protocol.js';
import { startTtsSession } from '../server/tts.js';
import { getConfig } from '../server/config.js';

// Literal wire IDs deliberately do not reuse the implementation's enum.
// Source: Volcengine WebSocket bidirectional V3 / SDK TaskRequest docs.
function frame(event, payload, id = 'test-session', type = 9, serialization = 1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const sid = Buffer.from(id);
  const head = Buffer.from([0x11, (type << 4) | 4, serialization << 4, 0]);
  const integer = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
  return Buffer.concat([head, integer(event), integer(sid.length), sid, integer(body.length), body]);
}

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(data, options, callback) { this.sent.push(data); if (typeof options === 'function') options(); callback?.(); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}

function request(bytes) {
  const event = bytes.readUInt32BE(4);
  let offset = 8, id;
  if (event >= 100) {
    const length = bytes.readUInt32BE(offset); offset += 4;
    id = bytes.subarray(offset, offset + length).toString(); offset += length;
  }
  let payload = bytes.subarray(offset + 4);
  if ((bytes[2] & 15) === 1) payload = gunzipSync(payload);
  return { event, id, payload: JSON.parse(payload) };
}

function setup(t) {
  const client = new Socket(), upstream = new Socket();
  startTtsSession(client, getConfig({ DOUBAO_API_KEY: 'test', DOUBAO_TTS_SPEAKER: 'test-speaker' }), () => upstream);
  t.after(() => client.close());
  upstream.emit('open');
  upstream.emit('message', frame(50, {}, 'connection'), true);
  const id = request(upstream.sent.at(-1)).id;
  upstream.emit('message', frame(150, {}, id), true);
  return { client, upstream, id };
}

const json = client => client.sent.filter(value => typeof value === 'string').map(value => JSON.parse(value));

test('wire constants distinguish SessionFailed 153 from SessionCanceled 151', () => {
  assert.equal(TTS_EVENT.SESSION_FAILED, 153);
  assert.equal(TTS_EVENT.SESSION_CANCELED, 151);
});

test('error frame without WithEvent starts with error code, not event ID', () => {
  // header 11 f0 10 00, code 45000000, payload length 2, JSON {}.
  const decoded = decodeTtsResponse(Buffer.from('11f0100002aea540000000027b7d', 'hex'));
  assert.equal(decoded.code, 45000000);
  assert.deepEqual(decoded.payloadJson, {});
});

test('audio frame remains binary even with JSON serialization in the header', () => {
  const pcm = Buffer.from([0xff, 0x7f, 0x00, 0x80]);
  const decoded = decodeTtsResponse(frame(352, pcm, 's', 11, 1));
  assert.equal(decoded.audio, true);
  assert.deepEqual(decoded.payload, pcm);
});

test('task text is nested under req_params as required by provider', t => {
  const { client, upstream } = setup(t);
  client.emit('message', Buffer.from('{"type":"text","text":"测试。"}'), false);
  const task = request(upstream.sent.at(-1));
  assert.equal(task.event, 200);
  assert.equal(task.payload.event, 200);
  assert.equal(task.payload.namespace, 'BidirectionalTTS');
  assert.equal(task.payload.req_params.speaker, 'test-speaker');
  assert.equal(task.payload.req_params.audio_params.format, 'pcm');
  assert.equal(task.payload.req_params?.text, '测试。');
  assert.equal(task.payload.text, undefined);
});

test('provider session failure is an error, never a successful cancellation', t => {
  const { client, upstream, id } = setup(t);
  upstream.emit('message', frame(153, { code: 45000000, message: 'private upstream details' }, id), true);
  assert.equal(json(client).at(-1).type, 'error');
  assert.equal(json(client).at(-1).code, 'PROVIDER_45000000');
  assert.ok(!json(client).at(-1).message.includes('private upstream'));
});

test('empty SessionFinished must not report successful audio delivery', t => {
  const { client, upstream, id } = setup(t);
  client.emit('message', Buffer.from('{"type":"text","text":"测试。"}'), false);
  client.emit('message', Buffer.from('{"type":"finish"}'), false);
  upstream.emit('message', frame(152, {}, id), true);
  assert.equal(json(client).at(-1).code, 'NO_AUDIO');
  assert.ok(!json(client).some(message => message.type === 'done'));
});

test('JSON null from client is rejected without crashing the BFF', t => {
  const { client } = setup(t);
  assert.doesNotThrow(() => client.emit('message', Buffer.from('null'), false));
  assert.equal(json(client).at(-1).code, 'INVALID_COMMAND');
});

test('audio for another session cannot leak into this playback', t => {
  const { client, upstream } = setup(t);
  upstream.emit('message', frame(352, Buffer.from([0, 1]), 'wrong-session', 11, 0), true);
  assert.equal(json(client).at(-1).code, 'PROTOCOL_ERROR');
  assert.equal(client.sent.filter(Buffer.isBuffer).length, 0);
});
