// Opt-in live check. Synthesizes only the fixed test sentence below; never
// prints credentials, speaker IDs, upstream headers, or arbitrary error bodies.
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../server/config.js';
import { connectTtsUpstream, startTtsSession, TTS_PROTOCOL_VERSION } from '../server/tts.js';
import { WebSocket } from '../server/vendor/ws.js';
import { playPcm } from './tts-audio.js';

if (process.argv.includes('--help')) {
  console.log('npm run test:tts:live [-- --play] [-- --url http://127.0.0.1:3000]');
  console.log('默认只验证音频数据，不播放声音。--play 在 macOS 默认输出设备播放合成结果。');
  process.exit(0);
}
const shouldPlay = process.argv.includes('--play');
if (shouldPlay && process.platform !== 'darwin') {
  console.error('--play 当前支持 macOS；其他系统请在网页点击播放。');
  process.exit(1);
}
const audioChunks = [];
console.log(shouldPlay ? '合成完成后将通过 macOS 默认输出设备播放。' : '仅检查音频数据，不播放声音；需要试听请运行 npm run test:tts:play。');

const parts = ['你好，', '这是一条语音合成测试。'];
const started = Date.now();
let audioBytes = 0, audioFrames = 0, peak = 0, energy = 0, samples = 0, carry = null, firstAudioMs = null;
let client, sampleRate, success = false, finished = false;
const timer = setTimeout(() => fail('TIMEOUT'), 35000);
function fail(code) {
  if (finished) return;
  finished = true; clearTimeout(timer); process.exitCode = 1;
  console.error(JSON.stringify({ ok: false, code, audioBytes, audioFrames }));
  client?.terminate();
}
function audio(input) {
  let bytes = Buffer.from(input);
  if (shouldPlay) audioChunks.push(bytes);
  audioBytes += bytes.length; audioFrames++;
  firstAudioMs ??= Date.now() - started;
  if (carry !== null) { bytes = Buffer.concat([Buffer.from([carry]), bytes]); carry = null; }
  if (bytes.length % 2) { carry = bytes.at(-1); bytes = bytes.subarray(0, -1); }
  for (let i = 0; i < bytes.length; i += 2) {
    const value = bytes.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(value)); energy += value * value; samples++;
  }
}
function control(message) {
  if (message.type === 'ready') {
    if (message.format !== 'pcm_s16le' || !Number.isFinite(message.sampleRate)) return fail('INVALID_FORMAT');
    sampleRate = message.sampleRate;
    console.log(JSON.stringify({ stage: 'ready', sampleRate }));
    for (const text of parts) command({ type: 'text', text });
    command({ type: 'finish' });
  } else if (message.type === 'error') {
    fail(typeof message.code === 'string' && /^[A-Z0-9_]+$/.test(message.code) ? message.code : 'TTS_ERROR');
  } else if (message.type === 'done') {
    if (!audioBytes || !samples) return fail('NO_AUDIO');
    if (carry !== null || message.audioBytes !== audioBytes) return fail('INVALID_AUDIO');
    if (!peak) return fail('SILENT_AUDIO');
    success = true;
    console.log(JSON.stringify({ ok: true, audioBytes, audioFrames, firstAudioMs,
      durationSeconds: Number((samples / sampleRate).toFixed(3)),
      peak: Number(peak.toFixed(4)), rms: Number(Math.sqrt(energy / samples).toFixed(4)),
    }));
  }
}
function command(message) {
  if (client instanceof LocalClient) client.emit('message', Buffer.from(JSON.stringify(message)), false);
  else client.send(JSON.stringify(message));
}
class LocalClient extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  send(data, options) { queueMicrotask(() => { if (!finished) options?.binary ? audio(data) : control(JSON.parse(data)); }); }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    // Deliver queued final/error messages before the close notification, as a
    // real WebSocket does; otherwise an auth error becomes CLOSED_BEFORE_DONE.
    queueMicrotask(() => this.emit('close'));
  }
  terminate() { this.close(); }
}

try {
  const urlIndex = process.argv.indexOf('--url');
  if (urlIndex >= 0) {
    const base = new URL(process.argv[urlIndex + 1]);
    if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) throw new Error('INVALID_LOCAL_URL');
    const health = await fetch(new URL('/api/tts/health', base), { signal: AbortSignal.timeout(8000) });
    if (!health.ok) throw new Error('HEALTH_FAILED');
    const info = await health.json();
    if (!info.configured) throw new Error('NOT_CONFIGURED');
    if (info.protocolVersion !== TTS_PROTOCOL_VERSION) throw new Error('SERVER_OUTDATED');
    const endpoint = new URL('/api/tts', base); endpoint.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    client = new WebSocket(endpoint, { headers: { Origin: base.origin }, handshakeTimeout: 10000 });
    client.on('message', (data, binary) => { if (!finished) binary ? audio(data) : control(JSON.parse(data)); });
  } else {
    try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const config = getConfig();
    if (!config.apiKey || !config.ttsSpeaker) throw new Error('NOT_CONFIGURED');
    client = new LocalClient();
    startTtsSession(client, { ...config, ttsSessionTimeoutMs: 30000 }, () => connectTtsUpstream(config));
  }
  client.on('close', async () => {
    if (finished) return;
    if (!success) return fail('CLOSED_BEFORE_DONE');
    finished = true; clearTimeout(timer);
    if (shouldPlay) {
      console.log('开始播放合成语音…');
      try {
        await playPcm(Buffer.concat(audioChunks), sampleRate);
        console.log('系统播放器已结束播放。若仍无声，请检查 macOS 当前输出设备及静音状态。');
      } catch {
        process.exitCode = 1;
        console.error(JSON.stringify({ ok: false, code: 'LOCAL_PLAYBACK_FAILED' }));
      }
    }
  });
  client.on('error', () => fail('CONNECTION_ERROR'));
} catch (error) {
  fail(['INVALID_LOCAL_URL', 'HEALTH_FAILED', 'NOT_CONFIGURED', 'SERVER_OUTDATED'].includes(error.message) ? error.message : 'SETUP_FAILED');
}
