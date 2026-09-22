import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import { startTtsSession } from '../server/tts.js';
import { TTS_EVENT } from '../server/tts-protocol.js';
import { getConfig } from '../server/config.js';

class FakeSocket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(data, options) { this.sent.push({ data, options }); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}

function responseFrame(event, payload, { messageType = 9, sessionId, connectionId, serialization = 1 } = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  const id = Buffer.from(sessionId || connectionId || '');
  const frame = Buffer.alloc(12 + id.length + (id.length ? 4 : 0) + body.length);
  frame.set([0x11, (messageType << 4) | 4, serialization << 4, 0]);
  let offset = 4; frame.writeInt32BE(event, offset); offset += 4;
  if (id.length) { frame.writeUInt32BE(id.length, offset); offset += 4; id.copy(frame, offset); offset += id.length; }
  frame.writeUInt32BE(body.length, offset); offset += 4; body.copy(frame, offset);
  return frame;
}

const browserJson = socket => socket.sent
  .filter(item => typeof item.data === 'string')
  .map(item => JSON.parse(item.data));

function decodeClientEvent(frame) {
  const event = frame.readInt32BE(4);
  let offset = 8, sessionId = null;
  if (![TTS_EVENT.START_CONNECTION, TTS_EVENT.FINISH_CONNECTION].includes(event)) {
    const idLength = frame.readUInt32BE(offset); offset += 4;
    sessionId = frame.subarray(offset, offset + idLength).toString(); offset += idLength;
  }
  const payloadLength = frame.readUInt32BE(offset); offset += 4;
  let payload = frame.subarray(offset, offset + payloadLength);
  if ((frame[2] & 15) === 1) payload = gunzipSync(payload);
  return { event, sessionId, payloadJson: JSON.parse(payload.toString()) };
}

test('TTS session performs connection, session, text and finish events in order', t => {
  const client = new FakeSocket(), upstream = new FakeSocket();
  const config = getConfig({ DOUBAO_API_KEY: 'test-key', DOUBAO_TTS_SPEAKER: 'test-speaker' });
  startTtsSession(client, config, () => upstream);
  t.after(() => { client.close(); upstream.terminate(); });
  upstream.emit('open');
  assert.equal(decodeClientEvent(upstream.sent[0].data).event, TTS_EVENT.START_CONNECTION);
  upstream.emit('message', responseFrame(TTS_EVENT.CONNECTION_STARTED, {}, { connectionId: 'c-1' }), true);
  const start = decodeClientEvent(upstream.sent[1].data);
  assert.equal(start.event, TTS_EVENT.START_SESSION);
  assert.equal(start.payloadJson.req_params.speaker, 'test-speaker');
  const sessionId = start.sessionId;
  upstream.emit('message', responseFrame(TTS_EVENT.SESSION_STARTED, {}, { sessionId }), true);
  assert.equal(browserJson(client).at(-1).type, 'ready');
  client.emit('message', Buffer.from(JSON.stringify({ type: 'text', text: '你好' })), false);
  client.emit('message', Buffer.from(JSON.stringify({ type: 'finish' })), false);
  assert.equal(decodeClientEvent(upstream.sent[2].data).event, TTS_EVENT.TASK_REQUEST);
  assert.equal(decodeClientEvent(upstream.sent[2].data).payloadJson.req_params.text, '你好');
  assert.equal(decodeClientEvent(upstream.sent[3].data).event, TTS_EVENT.FINISH_SESSION);
});

test('TTS session forwards only raw audio and completes after provider finish', t => {
  const client = new FakeSocket(), upstream = new FakeSocket();
  const config = getConfig({ DOUBAO_API_KEY: 'test-key', DOUBAO_TTS_SPEAKER: 'test-speaker' });
  startTtsSession(client, config, () => upstream);
  t.after(() => { client.close(); upstream.terminate(); });
  upstream.emit('open');
  upstream.emit('message', responseFrame(TTS_EVENT.CONNECTION_STARTED, {}, { connectionId: 'c-1' }), true);
  const sessionId = decodeClientEvent(upstream.sent[1].data).sessionId;
  upstream.emit('message', responseFrame(TTS_EVENT.SESSION_STARTED, {}, { sessionId }), true);
  client.emit('message', Buffer.from('{"type":"text","text":"你好"}'), false);
  client.emit('message', Buffer.from('{"type":"finish"}'), false);
  const pcm = Buffer.from([0, 0, 1, 0]);
  upstream.emit('message', responseFrame(352, pcm, { messageType: 11, serialization: 0, sessionId }), true);
  assert.deepEqual(client.sent.find(item => Buffer.isBuffer(item.data)).data, pcm);
  upstream.emit('message', responseFrame(TTS_EVENT.TTS_RESPONSE, { text: 'metadata' }, { sessionId }), true);
  assert.equal(client.sent.filter(item => Buffer.isBuffer(item.data)).length, 1);
  upstream.emit('message', responseFrame(TTS_EVENT.SESSION_FINISHED, { usage: { text_words: 2 } }, { sessionId }), true);
  assert.equal(browserJson(client).at(-1).type, 'done');
  assert.equal(decodeClientEvent(upstream.sent.at(-1).data).event, TTS_EVENT.FINISH_CONNECTION);
});
