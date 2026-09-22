import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeTtsResponse, encodeTtsEvent, TTS_EVENT } from '../server/tts-protocol.js';

function responseFrame(event, payload, { messageType = 9, sessionId, connectionId, gzip = false, serialization = 1 } = {}) {
  let body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  if (gzip) body = gzipSync(body);
  const id = Buffer.from(sessionId || connectionId || '');
  const result = Buffer.alloc(4 + 4 + (id.length ? 4 + id.length : 0) + 4 + body.length);
  result.set([0x11, (messageType << 4) | 4, (serialization << 4) | (gzip ? 1 : 0), 0]);
  let offset = 4; result.writeInt32BE(event, offset); offset += 4;
  if (id.length) { result.writeUInt32BE(id.length, offset); offset += 4; id.copy(result, offset); offset += id.length; }
  result.writeUInt32BE(body.length, offset); offset += 4; body.copy(result, offset);
  return result;
}

test('TTS client events include event, session metadata and JSON payload', () => {
  const frame = encodeTtsEvent(TTS_EVENT.TASK_REQUEST, { text: '你好' }, { sessionId: 'session-1', gzip: true });
  assert.deepEqual([...frame.subarray(0, 4)], [0x11, 0x14, 0x11, 0]);
  assert.equal(frame.readInt32BE(4), TTS_EVENT.TASK_REQUEST);
  const idLength = frame.readUInt32BE(8); assert.equal(frame.subarray(12, 12 + idLength).toString(), 'session-1');
  const payloadOffset = 12 + idLength; const payloadSize = frame.readUInt32BE(payloadOffset);
  assert.equal(payloadSize, frame.length - payloadOffset - 4);
  assert.deepEqual(JSON.parse(gunzipSync(frame.subarray(payloadOffset + 4))), { text: '你好' });
});

test('TTS decoder handles connection, session and raw audio responses', () => {
  const connection = decodeTtsResponse(responseFrame(TTS_EVENT.CONNECTION_STARTED, { message: 'ok' }, { connectionId: 'connect-1' }));
  assert.equal(connection.connectionId, 'connect-1'); assert.equal(connection.payloadJson.message, 'ok');
  const session = decodeTtsResponse(responseFrame(TTS_EVENT.SESSION_STARTED, { message: 'ok' }, { sessionId: 'session-1', gzip: true }));
  assert.equal(session.sessionId, 'session-1'); assert.equal(session.payloadJson.message, 'ok');
  const pcm = Buffer.from([0, 1, 2, 3]);
  const audio = decodeTtsResponse(responseFrame(352, pcm, { messageType: 11, sessionId: 'session-1', serialization: 0 }));
  assert.equal(audio.audio, true); assert.deepEqual(audio.payload, pcm);
});

test('TTS decoder rejects truncated and oversized payloads', () => {
  assert.throws(() => decodeTtsResponse(Buffer.from([0x11, 0x94])));
  const frame = responseFrame(TTS_EVENT.SESSION_STARTED, {}, { sessionId: 's' });
  frame.writeUInt32BE(0xffffffff, 13);
  assert.throws(() => decodeTtsResponse(frame), /size/);
});
