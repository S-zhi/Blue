import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gunzipSync } from 'node:zlib';
import { WebSocket, WebSocketServer } from '../server/vendor/ws.js';
import { attachAsrServer } from '../server/asr.js';
import { getConfig } from '../server/config.js';

const listen = async (server, t) => {
  try { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
  catch (error) { if (error.code === 'EPERM') { t.skip('Sandbox disallows local port listeners; run this integration test outside the sandbox.'); return null; } throw error; }
};
function serverFrame(payload, final) {
  const bytes = Buffer.from(JSON.stringify(payload));
  const data = Buffer.alloc(12 + bytes.length);
  data.set([0x11, final ? 0x93 : 0x91, 0x10, 0]);
  data.writeInt32BE(final ? -2 : 1, 4); data.writeUInt32BE(bytes.length, 8); bytes.copy(data, 12);
  return data;
}
test('local relay sends config, forwards PCM, replaces partial snapshots, and drains final response', { timeout: 7000 }, async t => {
  const providerHttp = createServer(); const providerPort = await listen(providerHttp, t); if (providerPort === null) return;
  const provider = new WebSocketServer({ server: providerHttp });
  let requestPayload; const receivedAudio = [];
  provider.on('connection', socket => socket.on('message', data => {
    const payload = gunzipSync(data.subarray(8));
    if ((data[1] >> 4) === 1) { requestPayload = JSON.parse(payload); return; }
    receivedAudio.push(payload);
    const final = Boolean(data[1] & 2);
    const utterance = { text: final ? '您好，我是您的 AI 助手。' : '您好，我是', definite: final, additions: { age: '28.5', gender: 'female', emotion: 'neutral', speaker_id: '0' } };
    socket.send(serverFrame({ audio_info: { duration: 200 }, result: { text: utterance.text, utterances: [utterance] } }, final));
  }));
  const origin = 'http://localhost:5173';
  const config = getConfig({ DOUBAO_API_KEY: 'local-test-key', ASR_ALLOWED_ORIGINS: origin });
  let bridge;
  const server = createServer((req, res) => bridge.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  const port = await listen(server, t); if (port === null) return;
  bridge = attachAsrServer(server, config, { connectUpstream: () => new WebSocket(`ws://127.0.0.1:${providerPort}`) });
  t.after(() => { bridge.close(); server.close(); for (const socket of provider.clients) socket.terminate(); provider.close(); providerHttp.close(); });
  const messages = [];
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/asr`, { headers: { Origin: origin } });
  t.after(() => client.terminate());
  client.on('message', data => {
    const message = JSON.parse(data); messages.push(message);
    if (message.type === 'ready') { client.send(Buffer.alloc(6400, 7)); client.send(JSON.stringify({ type: 'finish' })); }
  });
  await once(client, 'close');
  assert.equal(requestPayload.audio.rate, 16000);
  assert.equal(requestPayload.request.enable_age_detection, true);
  assert.deepEqual(receivedAudio.map(packet => packet.length), [6400, 0]);
  const results = messages.filter(message => message.type === 'result');
  assert.equal(results[0].text, '您好，我是'); assert.equal(results.at(-1).final, true);
  assert.equal(results.at(-1).text, '您好，我是您的 AI 助手。');
  assert.equal(results.at(-1).attributes.age, 28.5);
  assert.equal(messages.filter(message => message.type === 'error').length, 0);
});
test('foreign origins are rejected before an upstream connection is opened', { timeout: 3000 }, async t => {
  const config = getConfig({ DOUBAO_API_KEY: 'local-test-key' });
  const server = createServer(); const port = await listen(server, t); if (port === null) return; let connected = false;
  const bridge = attachAsrServer(server, config, { connectUpstream: () => { connected = true; throw new Error(); } });
  t.after(() => { bridge.close(); server.close(); });
  const client = new WebSocket(`ws://127.0.0.1:${port}/api/asr`, { headers: { Origin: 'https://other.example' } });
  client.on('error', () => {});
  const [request, response] = await once(client, 'unexpected-response');
  assert.equal(response.statusCode, 403); assert.equal(connected, false); response.resume(); request.destroy();
});
