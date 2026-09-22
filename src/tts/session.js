import { AudioCaptions } from './captions.js';

const SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 32000, 44100, 48000]);
const PROTOCOL_VERSION = 'bidirectional-v3.3';

function failure(code, message) { return Object.assign(new Error(message), { code }); }

export class PcmStreamPlayer {
  constructor(context, sampleRate) {
    this.context = context; this.sampleRate = sampleRate;
    this.nextStart = context.currentTime + 0.04;
    this.schedule = [];
    this.sources = new Set(); this.carry = null; this.bytes = 0;
    this.samples = 0; this.peak = 0; this.drainResolve = null;
  }
  append(buffer) {
    if (this.context.state !== 'running') throw failure('PLAYBACK_BLOCKED', '浏览器暂停了音频播放，请再次点击播放。');
    let bytes = new Uint8Array(buffer);
    this.bytes += bytes.length;
    if (this.bytes > this.sampleRate * 2 * 120) throw failure('AUDIO_LIMIT', '合成音频超过两分钟限制。');
    if (this.carry !== null) {
      const merged = new Uint8Array(bytes.length + 1); merged[0] = this.carry; merged.set(bytes, 1); bytes = merged; this.carry = null;
    }
    if (bytes.length % 2) { this.carry = bytes.at(-1); bytes = bytes.subarray(0, -1); }
    if (!bytes.length) return;
    const samples = bytes.length / 2;
    const audio = this.context.createBuffer(1, samples, this.sampleRate);
    const channel = audio.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples; index++) {
      const sample = view.getInt16(index * 2, true) / 32768;
      channel[index] = sample; this.peak = Math.max(this.peak, Math.abs(sample));
    }
    const offset = this.samples / this.sampleRate;
    this.samples += samples;
    const source = this.context.createBufferSource();
    source.buffer = audio; source.connect(this.context.destination);
    source.onended = () => {
      this.sources.delete(source); source.disconnect();
      if (!this.sources.size) { this.drainResolve?.(); this.drainResolve = null; }
    };
    const start = Math.max(this.context.currentTime + 0.02, this.nextStart);
    this.schedule.push({ start, offset, duration: audio.duration });
    this.sources.add(source);
    source.start(start); this.nextStart = start + audio.duration;
  }
  get playedSeconds() {
    const now = this.context.currentTime;
    if (!this.schedule.length || now < this.schedule[0].start) return null;
    let position = 0;
    for (const part of this.schedule) {
      if (now < part.start) break;
      position = part.offset + Math.min(Math.max(0, part.duration - 1 / this.sampleRate), now - part.start);
    }
    return position;
  }
  drain() {
    if (this.carry !== null) throw failure('INVALID_AUDIO', '收到的音频数据不完整。');
    if (!this.samples) throw failure('NO_AUDIO', '合成结束但没有收到音频。');
    if (!this.peak) throw failure('SILENT_AUDIO', '收到的音频全部为静音，请检查音色与模型是否匹配。');
    // Completion comes from Web Audio, not wall-clock time while suspended.
    return this.sources.size ? new Promise(resolve => { this.drainResolve = resolve; }) : Promise.resolve();
  }
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* It may already have ended. */ }
      source.disconnect();
    }
    this.sources.clear(); this.carry = null;
    this.drainResolve?.(); this.drainResolve = null;
  }
}

export class TtsSession {
  constructor({
    onProgress = () => {},
    fetch = globalThis.fetch,
    AudioContext = globalThis.AudioContext,
    WebSocket = globalThis.WebSocket,
    location = globalThis.location,
    timeoutMs = 15000,
  } = {}) {
    Object.assign(this, { onProgress, AudioContext, WebSocket, location, timeoutMs });
    // Native browser fetch requires Window as its receiver, not TtsSession.
    this.fetch = fetch.bind(globalThis);
    this.run = null;
  }
  unlock() {
    if (!this.AudioContext) return Promise.reject(failure('AUDIO_UNSUPPORTED', '当前浏览器不支持音频播放。'));
    if (!this.preparedContext || this.preparedContext.state === 'closed') this.preparedContext = new this.AudioContext({ latencyHint: 'interactive' });
    return this.preparedContext.resume();
  }
  speak(text, { onCaption } = {}) {
    if (typeof text !== 'string' || !text.trim()) return Promise.reject(failure('INVALID_TEXT', '待合成文本不能为空。'));
    if ([...text].length > 20000) return Promise.reject(failure('TEXT_LIMIT', '待合成文本超过单次会话限制。'));
    this.stop();
    return new Promise((resolve, reject) => {
      const run = { abort: new AbortController(), finished: false, providerDone: false, receivedBytes: 0, releasedBytes: 0, pending: [], captions: new AudioCaptions(text) };
      const synchronized = typeof onCaption === 'function';
      this.run = run;
      const current = () => this.run === run && !run.finished;
      const finish = error => {
        if (run.finished) return;
        run.finished = true; clearTimeout(run.timer); clearInterval(run.captionTimer); run.abort.abort();
        if (run.socket) {
          run.socket.onmessage = null; run.socket.onerror = null; run.socket.onclose = null;
          if (run.socket.readyState < 2) run.socket.close();
        }
        run.player?.stop();
        if (run.context) {
          run.context.onstatechange = null;
          if (run.context.state !== 'closed') run.context.close().catch(() => {});
        }
        if (this.run === run) this.run = null;
        if (error) reject(error);
        else resolve({ audioBytes: run.player.bytes, durationSeconds: run.player.samples / run.player.sampleRate });
      };
      run.cancel = () => {
        if (run.socket?.readyState === 1 && !run.providerDone) {
          try { run.socket.send(JSON.stringify({ type: 'cancel' })); } catch { /* Close handles a disconnected socket. */ }
        }
        finish(failure('ABORTED', '播放已停止。'));
      };
      const deadline = (code, message, ms = this.timeoutMs) => {
        clearTimeout(run.timer); run.timer = setTimeout(() => finish(failure(code, message)), ms);
      };
      const progress = (stage, details = {}) => { if (current()) this.onProgress({ stage, ...details }); };
      const updateCaption = () => {
        if (!current() || !synchronized || !run.player) return;
        const caption = run.captions.at(run.player.playedSeconds);
        if (caption && caption !== run.lastCaption) { run.lastCaption = caption; onCaption(caption); }
      };
      const flushAudio = () => {
        // Subtitle packets may arrive after PCM. Hold each sentence until its
        // timing is available, rather than displaying captions late or guessing.
        const limit = run.providerDone || !synchronized ? Infinity : Math.ceil(run.captions.end * run.player.sampleRate) * 2;
        while (run.pending.length && run.releasedBytes < limit) {
          const bytes = run.pending[0];
          const length = Math.min(bytes.length, limit - run.releasedBytes);
          run.player.append(bytes.slice(0, length).buffer);
          run.releasedBytes += length;
          if (length === bytes.length) run.pending.shift();
          else run.pending[0] = bytes.subarray(length);
        }
      };
      const connect = async () => {
        try {
          if (!this.AudioContext) throw failure('AUDIO_UNSUPPORTED', '当前浏览器不支持音频播放。');
          // Execute inside the trusted click, before ANY network await. Use the
          // device rate for the context and the provider PCM rate for buffers.
          run.context = this.preparedContext || new this.AudioContext({ latencyHint: 'interactive' });
          this.preparedContext = null;
          deadline('PLAYBACK_BLOCKED', '浏览器未允许音频播放，请再次点击播放。');
          const resume = run.context.resume();
          progress('unlocking');
          await resume;
          if (!current()) return;
          if (run.context.state !== 'running') throw failure('PLAYBACK_BLOCKED', '浏览器未允许音频播放，请再次点击播放。');
          run.context.onstatechange = () => {
            if (current() && run.context.state !== 'running') finish(failure('PLAYBACK_INTERRUPTED', '音频播放被浏览器暂停，请重新点击播放。'));
          };
          progress('connecting');
          deadline('HEALTH_TIMEOUT', '语音合成服务检查超时。');
          const response = await this.fetch('/api/tts/health', { cache: 'no-store', signal: run.abort.signal });
          if (!current()) return;
          if (!response.ok) throw failure('SERVICE_UNAVAILABLE', '语音合成中间层不可用。');
          const health = await response.json();
          if (!current()) return;
          if (!health.configured) throw failure('NOT_CONFIGURED', '请设置服务端 API Key 和音色后重启服务。');
          if (health.protocolVersion !== PROTOCOL_VERSION) throw failure('SERVER_OUTDATED', '语音服务仍在运行旧版本，请重启 npm start 后刷新页面。');
          if (health.format !== 'pcm' || !SAMPLE_RATES.has(health.sampleRate)) throw failure('INVALID_FORMAT', '语音服务返回了不支持的音频格式。');
          run.player = new PcmStreamPlayer(run.context, health.sampleRate);
          if (synchronized) run.captionTimer = setInterval(updateCaption, 25);
          const url = new URL('/api/tts', this.location.href); url.protocol = this.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const socket = new this.WebSocket(url); socket.binaryType = 'arraybuffer'; run.socket = socket;
          deadline('CONNECT_TIMEOUT', '语音合成连接超时。');
          let ready = false;
          socket.onmessage = event => {
            if (!current()) return;
            try {
              if (event.data instanceof ArrayBuffer) {
                if (!ready || run.providerDone) throw failure('PROTOCOL_ERROR', '音频返回顺序错误。');
                run.receivedBytes += event.data.byteLength;
                if (run.receivedBytes > health.sampleRate * 2 * 120) throw failure('AUDIO_LIMIT', '合成音频超过两分钟限制。');
                run.pending.push(new Uint8Array(event.data)); flushAudio();
                deadline('AUDIO_TIMEOUT', '音频流中断，请重新播放。', 30000);
                progress('playing', { audioBytes: run.player.bytes });
                return;
              }
              const message = JSON.parse(event.data);
              if (!message || typeof message !== 'object') throw failure('PROTOCOL_ERROR', '无法解析语音合成消息。');
              if (message.type === 'ready') {
                if (ready || message.format !== 'pcm_s16le' || message.sampleRate !== health.sampleRate) throw failure('PROTOCOL_ERROR', '语音合成格式或会话状态不一致。');
                ready = true;
                // Bound JSON packets below 32 KiB including escaping and UTF-8.
                const characters = [...text];
                for (let i = 0; i < characters.length; i += 1000) {
                  const chunk = characters.slice(i, i + 1000).join('');
                  if (chunk.trim()) socket.send(JSON.stringify({ type: 'text', text: chunk }));
                }
                socket.send(JSON.stringify({ type: 'finish' }));
                progress('synthesizing');
                deadline('AUDIO_TIMEOUT', '云端尚未返回音频，请检查音色和模型配置。', 30000);
              } else if (message.type === 'sentence') {
                if (!ready || run.providerDone) throw failure('PROTOCOL_ERROR', '句子返回顺序错误。');
                run.captions.sentence(message, health.sampleRate); flushAudio(); updateCaption();
                deadline('AUDIO_TIMEOUT', '音频流中断，请重新播放。', 30000);
              } else if (message.type === 'subtitle') {
                if (!ready || run.providerDone) throw failure('PROTOCOL_ERROR', '字幕返回顺序错误。');
                run.captions.add(message.payload); flushAudio(); updateCaption();
                deadline('AUDIO_TIMEOUT', '音频流中断，请重新播放。', 30000);
              } else if (message.type === 'done') {
                if (!ready || run.providerDone) throw failure('PROTOCOL_ERROR', '语音合成结束事件顺序错误。');
                if (message.audioBytes !== run.receivedBytes) throw failure('INVALID_AUDIO', '音频接收不完整，请重新播放。');
                run.providerDone = true;
                flushAudio();
                const draining = run.player.drain();
                deadline('PLAYBACK_TIMEOUT', '音频播放未完成，请检查浏览器音频权限。', Math.max(5000, (run.player.nextStart - run.context.currentTime) * 1000 + 5000));
                draining.then(() => { if (current()) { if (synchronized) onCaption(text); finish(); } }, finish);
              } else if (message.type === 'error') {
                finish(failure(typeof message.code === 'string' ? message.code : 'TTS_ERROR', message.message || '语音合成失败。'));
              } else if (message.type === 'canceled') {
                finish(failure('CANCELED', '云端取消了本次语音合成。'));
              }
            } catch (error) { finish(error.code ? error : failure('PROTOCOL_ERROR', '无法解析语音合成消息或音频。')); }
          };
          socket.onerror = () => { if (current() && !run.providerDone) finish(failure('CONNECTION_ERROR', '语音合成连接失败。')); };
          socket.onclose = () => { if (current() && !run.providerDone) finish(failure('CONNECTION_CLOSED', '语音合成连接提前关闭。')); };
        } catch (error) { if (current()) finish(error); }
      };
      connect();
    });
  }
  stop() { this.run?.cancel(); }
  dispose() {
    this.stop();
    this.preparedContext?.close().catch(() => {}); this.preparedContext = null;
  }
}
