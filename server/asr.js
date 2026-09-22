import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from './vendor/ws.js';
import { encodeRequest, encodeAudio, decodeResponse } from './protocol.js';
import { makeRequest } from './config.js';
import { normalizeResult } from './results.js';

const AUDIO_PACKET_BYTES = 6400;
const MAX_BUFFER = 128 * 1024;

export function attachAsrServer(httpServer, config, { connectUpstream } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  const connect = connectUpstream || (() => new WebSocket(config.endpoint, {
    headers: { 'X-Api-Key': config.apiKey, 'X-Api-Resource-Id': config.resourceId, 'X-Api-Request-Id': randomUUID() },
    handshakeTimeout: 10000, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false,
  }));
  function reject(socket, status, reason) {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  function upgrade(request, socket, head) {
    if (new URL(request.url, 'http://localhost').pathname !== '/api/asr') return;
    if (!config.origins.has(request.headers.origin)) return reject(socket, 403, 'Forbidden');
    if (!config.apiKey) return reject(socket, 503, 'Not Configured');
    if (wss.clients.size >= config.maxSessions) return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
  }
  httpServer.on('upgrade', upgrade);
  wss.on('connection', client => startAsrSession(client, config, connect));

  return {
    middleware(request, response, next) {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path !== '/api/asr/health') return next();
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ configured: Boolean(config.apiKey), features: config.features, maxRecordingMs: config.maxRecordingMs }));
    },
    close() {
      httpServer.off('upgrade', upgrade);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

export function startAsrSession(client, config, connect) {
    let upstream, ready = false, finished = false, receivedFinal = false, ended = false, audioBytes = 0;
    let finalTimer, latestResult;
    const durationTimer = setTimeout(() => fail('SESSION_LIMIT', '单次识别已达时长限制，请重新开始。'), config.maxRecordingMs + config.finalTimeoutMs);
    const connectTimer = setTimeout(() => fail('CONNECT_TIMEOUT', '云端连接超时，请检查网络。'), 12000);
    const closeClient = () => {
      client.close(1000);
      const timer = setTimeout(() => { if (client.readyState !== WebSocket.CLOSED) client.terminate(); }, 1500);
      timer.unref();
    };
    const send = message => {
      if (client.readyState === WebSocket.OPEN && client.bufferedAmount <= MAX_BUFFER) client.send(JSON.stringify(message));
    };
    function clean() {
      clearTimeout(durationTimer); clearTimeout(connectTimer); clearTimeout(finalTimer);
      if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
    }
    function fail(code, message) {
      if (ended) return;
      ended = true;
      send({ type: 'error', code, message });
      clean(); closeClient();
    }
    client.on('error', () => { ended = true; clean(); });
    client.on('close', () => { ended = true; clean(); });
    client.on('message', (data, binary) => {
      if (ended) return;
      if (!ready || !upstream || upstream.readyState !== WebSocket.OPEN) return fail('NOT_READY', '语音连接尚未准备好。');
      if (finished) return fail('ALREADY_FINISHED', '音频流已结束。');
      if (binary) {
        if (!data.length || data.length > AUDIO_PACKET_BYTES || data.length % 2) return fail('INVALID_AUDIO', '音频包格式不正确。');
        audioBytes += data.length;
        if (audioBytes > config.maxRecordingMs * 32) return fail('AUDIO_LIMIT', '音频时长超出限制。');
        if (upstream.bufferedAmount > MAX_BUFFER) return fail('BACKPRESSURE', '网络拥堵，已停止采音以避免字幕延迟。');
        upstream.send(encodeAudio(data));
      } else {
        let command;
        try { command = JSON.parse(data.toString()); } catch { return fail('INVALID_COMMAND', '无法解析语音控制消息。'); }
        if (command.type !== 'finish') return fail('INVALID_COMMAND', '不支持的语音控制消息。');
        finished = true;
        upstream.send(encodeAudio(Buffer.alloc(0), true));
        send({ type: 'finalizing' });
        finalTimer = setTimeout(() => fail('FINAL_TIMEOUT', '最终结果等待超时，已保留当前字幕。'), config.finalTimeoutMs);
      }
    });
    try { upstream = connect(); } catch { return fail('CONNECT_FAILED', '无法创建云端语音连接。'); }
    upstream.on('open', () => {
      if (ended) return upstream.terminate();
      upstream.send(encodeRequest(makeRequest(config)), error => {
        if (error) return fail('START_FAILED', '无法初始化云端识别。');
        if (ended) return;
        clearTimeout(connectTimer);
        ready = true;
        send({ type: 'ready', features: config.features, maxRecordingMs: config.maxRecordingMs });
      });
    });
    upstream.on('message', (data, binary) => {
      if (ended) return;
      try {
        const frame = binary ? decodeResponse(data) : { code: 0, final: false, payload: JSON.parse(data.toString()) };
        const code = frame.code || frame.payload?.code || 0;
        if (code) return fail(`PROVIDER_${code}`, `云端识别失败（${code}），请检查密钥、资源授权和余额。`);
        let result = normalizeResult(frame);
        // A terminal acknowledgement may contain no hypothesis. Preserve the
        // last full snapshot instead of clearing the user's completed caption.
        if (result.final && !result.text && !result.utterances.length && latestResult) {
          result = {
            ...latestResult, final: true,
            duration: result.duration ?? latestResult.duration,
            utterances: latestResult.utterances.map(utterance => ({ ...utterance, definite: true })),
          };
        }
        if (result.text || result.utterances.length) latestResult = result;
        if (client.bufferedAmount > MAX_BUFFER) return fail('CLIENT_SLOW', '接收字幕的连接过慢，识别已结束。');
        if (result.text || result.utterances.length || result.final) send(result);
        if (result.final) {
          receivedFinal = true; ended = true;
          clean(); closeClient();
        }
      } catch { fail('PROTOCOL_ERROR', '无法解析云端响应，请核对服务端协议。'); }
    });
    upstream.on('unexpected-response', (request, response) => {
      const status = response.statusCode;
      // Do not return upstream headers or bodies, which may contain identifiers.
      response.resume(); request.destroy();
      fail(`HTTP_${status}`, `云端握手失败（HTTP ${status}），请检查鉴权和资源权限。`);
    });
    upstream.on('error', () => fail('UPSTREAM_ERROR', '云端语音连接失败，请检查网络和服务配置。'));
    upstream.on('close', () => { if (!ended && !receivedFinal) fail('UPSTREAM_CLOSED', '云端连接提前结束，已保留当前字幕。'); });
}
