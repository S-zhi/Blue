import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeAudio, encodeRequest, decodeResponse } from '../server/protocol.js';
import { normalizeResult } from '../server/results.js';
import { getConfig, makeRequest } from '../server/config.js';

function responseFrame(payload, { final = false, gzip = true, sequence = 2 } = {}) {
  const bytes = Buffer.from(JSON.stringify(payload));
  const body = gzip ? gzipSync(bytes) : bytes;
  const result = Buffer.alloc(12 + body.length);
  result.set([0x11, final ? 0x93 : 0x91, gzip ? 0x11 : 0x10, 0]);
  result.writeInt32BE(final ? -sequence : sequence, 4); result.writeUInt32BE(body.length, 8); body.copy(result, 12);
  return result;
}
test('request and final audio frames carry the correct protocol flags and gzip body', () => {
  const payload = { audio: { format: 'pcm', rate: 16000 } };
  const request = encodeRequest(payload);
  assert.deepEqual([...request.subarray(0, 4)], [0x11, 0x10, 0x11, 0]);
  assert.equal(request.readUInt32BE(4), request.length - 8);
  assert.deepEqual(JSON.parse(gunzipSync(request.subarray(8))), payload);
  const audio = Buffer.from([1, 0, 255, 127]);
  const final = encodeAudio(audio, true);
  assert.deepEqual([...final.subarray(0, 4)], [0x11, 0x22, 0x01, 0]);
  assert.deepEqual(gunzipSync(final.subarray(8)), audio);
  assert.equal(gunzipSync(encodeAudio(Buffer.alloc(0), true).subarray(8)).length, 0);
});
test('compressed and raw final response sequences decode', () => {
  const payload = { result: { text: '您好，我是您的 AI 助手。' } };
  for (const gzip of [true, false]) {
    const result = decodeResponse(responseFrame(payload, { final: true, gzip, sequence: 42 }));
    assert.equal(result.sequence, -42); assert.equal(result.final, true); assert.deepEqual(result.payload, payload);
  }
});
test('malformed frames, incorrect sizes and truncated sequence fields are rejected', () => {
  assert.throws(() => decodeResponse(Buffer.from([0x11, 0x91])));
  const frame = responseFrame({ result: {} });
  frame.writeUInt32BE(99999999, 8); assert.throws(() => decodeResponse(frame), /size/);
  assert.throws(() => decodeResponse(Buffer.from([0x12, 0x91, 0x10, 0, 0, 0, 0, 0])));
});
test('normalization handles SDK envelopes, result arrays, string additions, and no metadata', () => {
  const envelope = { payload_msg: { audio_info: { duration: 8040 }, result: { text: '您好。', utterances: [{ text: '您好。', definite: true, start_time: 280, end_time: 2000, additions: JSON.stringify({ age: '31.7', gender: 'female', emotion: 'happy', speaker_id: '0' }) }] } }, is_last_package: true };
  const result = normalizeResult({ payload: envelope });
  assert.equal(result.text, '您好。'); assert.equal(result.final, true); assert.equal(result.duration, 8040);
  assert.equal(result.attributes.age, 31.7); assert.equal(result.attributes.gender, 'female'); assert.equal(result.attributes.emotion, 'happy');
  assert.equal(normalizeResult({ payload: { result: [{ text: '你好' }, { text: '世界' }] } }).text, '你好世界');
  assert.equal(normalizeResult({ payload: { result: { text: '没有属性' } } }).attributes.age, null);
});
test('newest utterance does not inherit demographic attributes from a previous speaker', () => {
  const result = normalizeResult({ payload: { result: { utterances: [{ text: 'A', additions: { age: '42', gender: 'male' } }, { text: 'B', additions: { speaker_id: '1' } }] } } });
  assert.equal(result.attributes.age, null); assert.equal(result.attributes.gender, null); assert.equal(result.attributes.speaker, '1');
});
test('config uses documented async endpoint, model 2.0, and enables all requested attributes', () => {
  const config = getConfig({ DOUBAO_API_KEY: 'test-only' });
  assert.ok(config.endpoint.endsWith('bigmodel_async')); assert.equal(config.resourceId, 'volc.seedasr.sauc.duration');
  const payload = makeRequest(config);
  for (const flag of ['enable_age_detection', 'enable_gender_detection', 'enable_emotion_detection', 'show_utterances', 'enable_speaker_info']) assert.equal(payload.request[flag], true);
  assert.equal(payload.request.result_type, 'full'); assert.equal(payload.audio.format, 'pcm');
  assert.throws(() => getConfig({ DOUBAO_ASR_URL: 'wss://evil.example/steal' }), /Unsupported/);
  assert.throws(() => getConfig({ DOUBAO_ENABLE_AGE: 'yes' }));
});
