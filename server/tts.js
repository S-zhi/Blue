import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from './vendor/ws.js';
import { decodeTtsResponse, encodeTtsEvent, TTS_EVENT } from './tts-protocol.js';

const MAX_BUFFER = 256 * 1024;
const MAX_TEXT_CHARS = 20000;
export const TTS_PROTOCOL_VERSION = 'bidirectional-v3.3';

export function makeTtsRequest(config, event, sessionId, text = '') {
  return {
    user: { uid: sessionId },
    namespace: 'BidirectionalTTS',
    event,
    req_params: {
      text,
      speaker: config.ttsSpeaker,
      audio_params: { format: 'pcm', sample_rate: config.ttsSampleRate },
    },
  };
}

export function connectTtsUpstream(config) {
  return new WebSocket(config.ttsEndpoint, {
    headers: {
      'X-Api-Key': config.apiKey,
      'X-Api-Resource-Id': config.ttsResourceId,
      'X-Api-Connect-Id': randomUUID(),
      'X-Control-Require-Usage-Tokens-Return': '*',
    },
    handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false,
  });
}

export function attachTtsServer(httpServer, config, { connectUpstream } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false });
  const connect = connectUpstream || (() => connectTtsUpstream(config));
  function reject(socket, status, reason) {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
  function upgrade(request, socket, head) {
    if (new URL(request.url, 'http://localhost').pathname !== '/api/tts') return;
    if (!config.ttsOrigins.has(request.headers.origin)) return reject(socket, 403, 'Forbidden');
    if (!config.apiKey || !config.ttsSpeaker) return reject(socket, 503, 'Not Configured');
    if (wss.clients.size >= config.ttsMaxSessions) return reject(socket, 429, 'Too Many Requests');
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
  }
  httpServer.on('upgrade', upgrade);
  wss.on('connection', client => startTtsSession(client, config, connect));
  return {
    middleware(request, response, next) {
      if (new URL(request.url, 'http://localhost').pathname !== '/api/tts/health') return next();
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({
        configured: Boolean(config.apiKey && config.ttsSpeaker),
        format: 'pcm', sampleRate: config.ttsSampleRate, protocolVersion: TTS_PROTOCOL_VERSION,
      }));
    },
    close() {
      httpServer.off('upgrade', upgrade);
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}

export function startTtsSession(client, config, connect) {
  const sessionId = randomUUID();
  let upstream, state = 'connecting', ended = false, totalChars = 0, audioBytes = 0, audioFrames = 0, closeTimer;
  const startedAt = Date.now();
  let firstAudioMs = null;
  const connectTimer = setTimeout(() => fail('CONNECT_TIMEOUT', '云端语音合成连接超时。'), 12000);
  const sessionTimer = setTimeout(() => fail('SESSION_TIMEOUT', '语音合成会话超时。'), config.ttsSessionTimeoutMs);
  const sendJson = message => {
    if (client.readyState === WebSocket.OPEN && client.bufferedAmount <= MAX_BUFFER) client.send(JSON.stringify(message));
  };
  const closeClient = () => {
    if (client.readyState === WebSocket.OPEN) client.close(1000);
    const timer = setTimeout(() => { if (client.readyState !== WebSocket.CLOSED) client.terminate(); }, 1500);
    timer.unref();
  };
  function clean() {
    clearTimeout(connectTimer); clearTimeout(sessionTimer); clearTimeout(closeTimer);
    if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
  }
  function finishClient(message) {
    if (ended) return;
    ended = true; sendJson(message); clean(); closeClient();
  }
  function fail(code, message) { finishClient({ type: 'error', code, message }); }
  function sendUpstream(event, payload = {}, withSession = false) {
    if (ended) return;
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return fail('UPSTREAM_CLOSED', '云端语音合成连接已断开。');
    if (upstream.bufferedAmount > MAX_BUFFER) return fail('BACKPRESSURE', '文本发送网络拥堵，合成已停止。');
    upstream.send(encodeTtsEvent(event, payload, { sessionId: withSession ? sessionId : undefined }), error => {
      if (error) fail('UPSTREAM_ERROR', '语音合成请求发送失败。');
    });
  }
  client.on('error', () => { ended = true; clean(); });
  client.on('close', () => {
    if (!ended && upstream?.readyState === WebSocket.OPEN && ['ready', 'streaming'].includes(state)) {
      upstream.send(encodeTtsEvent(TTS_EVENT.CANCEL_SESSION, {}, { sessionId }));
    }
    ended = true; clean();
  });
  client.on('message', (data, binary) => {
    if (ended) return;
    if (binary) return fail('INVALID_COMMAND', '语音合成仅接受文本控制消息。');
    let command;
    try { command = JSON.parse(data.toString()); } catch { return fail('INVALID_COMMAND', '无法解析语音合成请求。'); }
    if (!command || typeof command !== 'object' || Array.isArray(command)) return fail('INVALID_COMMAND', '无法解析语音合成请求。');
    if (command.type === 'text') {
      if (!['ready', 'streaming'].includes(state)) return fail('NOT_READY', '语音合成会话尚未准备好。');
      const text = typeof command.text === 'string' ? command.text : '';
      if (!text.trim()) return fail('INVALID_TEXT', '待合成文本不能为空。');
      totalChars += [...text].length;
      if (totalChars > MAX_TEXT_CHARS) return fail('TEXT_LIMIT', '待合成文本超过单次会话限制。');
      state = 'streaming';
      sendUpstream(TTS_EVENT.TASK_REQUEST, makeTtsRequest(config, TTS_EVENT.TASK_REQUEST, sessionId, text), true);
      return;
    }
    if (command.type === 'finish') {
      if (!['ready', 'streaming'].includes(state)) return fail('NOT_READY', '语音合成会话尚未准备好。');
      if (!totalChars) return fail('INVALID_TEXT', '待合成文本不能为空。');
      state = 'finishing';
      sendUpstream(TTS_EVENT.FINISH_SESSION, {}, true);
      return;
    }
    if (command.type === 'cancel') {
      if (['ready', 'streaming', 'finishing'].includes(state)) sendUpstream(TTS_EVENT.CANCEL_SESSION, {}, true);
      return finishClient({ type: 'canceled' });
    }
    fail('INVALID_COMMAND', '不支持的语音合成控制消息。');
  });
  try { upstream = connect(); } catch { return fail('CONNECT_FAILED', '无法创建云端语音合成连接。'); }
  upstream.on('open', () => { if (ended) upstream.terminate(); else sendUpstream(TTS_EVENT.START_CONNECTION); });
  upstream.on('message', (data, binary) => {
    if (ended) return;
    if (!binary) return fail('PROTOCOL_ERROR', '云端语音合成返回了非预期消息。');
    let frame;
    try { frame = decodeTtsResponse(data); } catch { return fail('PROTOCOL_ERROR', '无法解析云端语音合成响应。'); }
    if (frame.sessionId !== null && frame.sessionId !== sessionId) return fail('PROTOCOL_ERROR', '云端语音合成会话编号不匹配。');
    if (frame.messageType === 15 || frame.code || [TTS_EVENT.CONNECTION_FAILED, TTS_EVENT.SESSION_FAILED].includes(frame.event)) {
      const rawCode = frame.code || frame.payloadJson?.code;
      const providerCode = /^\d{1,10}$/.test(String(rawCode)) ? String(rawCode) : 'UNKNOWN';
      return fail(`PROVIDER_${providerCode}`, `云端语音合成失败（${providerCode}），请检查密钥、音色、资源授权和余额。`);
    }
    if (frame.event === TTS_EVENT.CONNECTION_STARTED) {
      if (state !== 'connecting') return fail('PROTOCOL_ERROR', '云端连接事件顺序错误。');
      state = 'starting';
      return sendUpstream(TTS_EVENT.START_SESSION, makeTtsRequest(config, TTS_EVENT.START_SESSION, sessionId), true);
    }
    if (frame.event === TTS_EVENT.SESSION_STARTED) {
      if (state !== 'starting') return fail('PROTOCOL_ERROR', '云端会话事件顺序错误。');
      clearTimeout(connectTimer);
      state = 'ready';
      return sendJson({ type: 'ready', format: 'pcm_s16le', sampleRate: config.ttsSampleRate });
    }
    if (frame.audio) {
      if (![null, TTS_EVENT.TTS_RESPONSE].includes(frame.event) || !['streaming', 'finishing'].includes(state)) return fail('PROTOCOL_ERROR', '云端音频事件顺序错误。');
      if (frame.payload.length && client.readyState === WebSocket.OPEN) {
        if (client.bufferedAmount > MAX_BUFFER) return fail('CLIENT_SLOW', '音频接收速度过慢，合成已停止。');
        audioBytes += frame.payload.length; audioFrames++;
        firstAudioMs ??= Date.now() - startedAt;
        if (audioBytes > config.ttsSampleRate * 2 * 120) return fail('AUDIO_LIMIT', '合成音频超过两分钟限制。');
        client.send(frame.payload, { binary: true });
      }
      return;
    }
    if ([TTS_EVENT.TTS_SENTENCE_START, TTS_EVENT.TTS_SENTENCE_END].includes(frame.event)) {
      return sendJson({
        type: 'sentence', boundary: frame.event === TTS_EVENT.TTS_SENTENCE_START ? 'start' : 'end',
        text: typeof frame.payloadJson?.text === 'string' ? frame.payloadJson.text : '',
        audioBytes,
      });
    }
    if (frame.event === TTS_EVENT.TTS_SUBTITLE) return sendJson({ type: 'subtitle', payload: frame.payloadJson || {} });
    if (frame.event === TTS_EVENT.SESSION_CANCELED) return finishClient({ type: 'canceled' });
    if (frame.event === TTS_EVENT.SESSION_FINISHED) {
      if (state !== 'finishing') return fail('PROTOCOL_ERROR', '云端会话提前结束。');
      if (!audioBytes) return fail('NO_AUDIO', '云端结束合成但没有返回音频，请检查音色与模型是否匹配。');
      if (audioBytes % 2) return fail('INVALID_AUDIO', '云端 PCM 音频数据不完整。');
      state = 'closed';
      clearTimeout(sessionTimer);
      sendJson({ type: 'done', usage: frame.payloadJson?.usage || null, audioBytes, audioFrames, firstAudioMs });
      sendUpstream(TTS_EVENT.FINISH_CONNECTION);
      closeTimer = setTimeout(() => finishClient({ type: 'closed' }), 1000);
      return;
    }
    if (frame.event === TTS_EVENT.CONNECTION_FINISHED) {
      if (state !== 'closed') return fail('UPSTREAM_CLOSED', '云端连接在合成完成前结束。');
      finishClient({ type: 'closed' });
    }
  });
  upstream.on('unexpected-response', (request, response) => {
    const status = response.statusCode; response.resume(); request.destroy();
    fail(`HTTP_${status}`, `云端语音合成握手失败（HTTP ${status}）。`);
  });
  upstream.on('error', () => { if (state === 'closed') finishClient({ type: 'closed' }); else fail('UPSTREAM_ERROR', '云端语音合成连接失败，请检查网络和服务配置。'); });
  upstream.on('close', () => { if (state === 'closed') finishClient({ type: 'closed' }); else if (!ended) fail('UPSTREAM_CLOSED', '云端语音合成连接提前结束。'); });
}
