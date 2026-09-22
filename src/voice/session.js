import workletUrl from './pcm-worklet.js?worker&url';
import { Packetizer, VoiceActivityDetector } from './audio-core.js';
import { TranscriptDeadline } from './timing.js';

export class SpeechSession {
  constructor({ onState, onLevel, onSpeech, onResult, onError, onCountdown = () => {}, onGesture = () => {}, onMicrophone = () => {} }) {
    Object.assign(this, { onState, onLevel, onSpeech, onResult, onError, onCountdown, onGesture, onMicrophone });
    this.state = 'idle'; this.generation = 0;
  }
  get active() { return ['armed', 'requesting', 'connecting', 'listening', 'speaking', 'waiting', 'finalizing'].includes(this.state); }
  change(state) { this.state = state; this.onState(state); }
  current(token) { return token === this.generation; }
  async start() {
    if (this.active) return;
    const token = ++this.generation;
    this.finishSent = false;
    this.detector = new VoiceActivityDetector();
    this.deadline = new TranscriptDeadline(() => this.stop());
    this.preRoll = [];
    this.change('requesting');
    this.abortController = new AbortController();
    this.healthTimer = setTimeout(() => this.abortController?.abort(), 8000);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
        this.onMicrophone(false);
        throw new Error('请使用支持 AudioWorklet 的浏览器，并通过 localhost 或 HTTPS 打开页面。');
      }
      const response = await fetch('/api/asr/health', { signal: this.abortController.signal, cache: 'no-store' });
      clearTimeout(this.healthTimer);
      if (!response.ok) throw new Error('语音中间层不可用，请重新启动开发服务。');
      const health = await response.json();
      if (!this.current(token)) return;
      if (!health.configured) throw new Error('请在项目 .env 中设置 DOUBAO_API_KEY，然后重启服务。');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
      if (!this.current(token)) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.onMicrophone(true);
      for (const track of stream.getTracks()) track.onended = () => { this.onMicrophone(false); this.fail('麦克风已断开或权限被撤销。'); };
      const context = new AudioContext({ latencyHint: 'interactive' });
      this.context = context;
      if (context.state === 'suspended') this.onGesture();
      await context.resume();
      await context.audioWorklet.addModule(workletUrl);
      if (!this.current(token)) return;
      this.node = new AudioWorkletNode(context, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
      this.source = context.createMediaStreamSource(stream);
      this.mute = context.createGain();
      this.mute.gain.value = 0;
      this.node.onprocessorerror = () => this.fail('音频处理器发生错误，请重新开始。');
      this.packetizer = new Packetizer(packet => {
        if (!this.current(token)) return;
        if (this.socket?.readyState !== WebSocket.OPEN) return this.fail('语音连接已中断。');
        if (this.socket.bufferedAmount > 128 * 1024) return this.fail('上传网络拥堵，已停止采音。');
        this.socket.send(packet);
      });
      this.node.port.onmessage = event => {
        if (!this.current(token)) return;
        if (event.data.type === 'flushed') return this.finish(token);
        if (event.data.type !== 'frame') return;
        const activity = this.detector.update(event.data.rms, event.data.durationMs);
        this.onLevel(activity.level);
        if (this.state === 'armed' || this.state === 'connecting') {
          this.preRoll.push(event.data.pcm);
          if (this.state === 'armed' && this.preRoll.length > 25) this.preRoll.shift();
          if (this.preRoll.length > 600) return this.fail('云端连接过慢，请稍后重试。');
          if (this.state === 'armed' && activity.speaking) this.connect(token);
          return;
        }
        this.packetizer.push(event.data.pcm);
        if (!this.current(token) || this.state === 'finalizing') return;
        if (activity.changed) this.onSpeech(activity.speaking);
        const nextState = activity.speaking ? 'speaking' : 'listening';
        if (this.state !== nextState) this.change(nextState);
      };
      this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
      this.change('armed');
    } catch (error) {
      if (!this.current(token)) return;
      if (['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'SecurityError'].includes(error.name)) this.onMicrophone(false);
      this.fail(error.name === 'NotAllowedError' ? '请在浏览器中允许麦克风权限。' : error.message || '无法启动语音感知。');
    }
  }
  connect(token) {
      this.change('connecting');
      const url = new URL('/api/asr', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url);
      this.socket = socket;
      this.connectTimer = setTimeout(() => this.fail('语音连接超时，请检查网络和服务配置。'), 15000);
      socket.onmessage = event => {
        if (!this.current(token)) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return this.fail('无法解析语音服务消息。'); }
        if (message.type === 'ready') {
          clearTimeout(this.connectTimer);
          for (const pcm of this.preRoll) this.packetizer.push(pcm);
          this.preRoll = [];
          this.deadline.start();
          this.onSpeech(this.detector.speaking);
          this.change('listening');
          this.recordingTimer = setTimeout(() => this.stop(), Math.min(message.maxRecordingMs || 120000, 120000));
        } else if (message.type === 'result') {
          this.deadline.update(message.text);
          this.onResult(message);
          if (message.final) this.complete();
        } else if (message.type === 'error') {
          this.fail(message.message || '语音服务返回错误。');
        }
      };
      socket.onerror = () => { if (this.current(token)) this.fail('语音连接失败，请检查 BFF、密钥权限和网络。'); };
      socket.onclose = () => { if (this.current(token)) this.fail('语音连接提前关闭，当前字幕已保留。'); };
  }
  stop() {
    if (!this.active || this.state === 'finalizing') return;
    if (['armed', 'requesting', 'connecting'].includes(this.state)) {
      ++this.generation; this.clean(); this.change('idle'); return;
    }
    this.deadline.clear();
    this.change('finalizing'); this.onSpeech(false); this.onLevel(0);
    this.onCountdown(null);
    clearTimeout(this.recordingTimer);
    const token = this.generation;
    this.node.port.postMessage({ type: 'flush' });
    this.flushTimer = setTimeout(() => this.finish(token), 1500);
  }
  finish(token) {
    if (!this.current(token) || this.finishSent) return;
    this.finishSent = true;
    clearTimeout(this.flushTimer);
    this.packetizer.flush();
    if (!this.current(token)) return;
    this.releaseMicrophone();
    if (this.socket?.readyState !== WebSocket.OPEN) return this.fail('音频结束时连接已中断。');
    this.socket.send(JSON.stringify({ type: 'finish' }));
    this.finalTimer = setTimeout(() => this.fail('等待最终字幕超时，当前内容已保留。'), 18000);
  }
  complete() {
    ++this.generation; this.clean(); this.change('done');
  }
  fail(message) {
    ++this.generation; this.clean(); this.change('error'); this.onError(message);
  }
  releaseMicrophone() {
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.disconnect(); this.node.port.close(); }
    this.source?.disconnect(); this.mute?.disconnect();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (this.context && this.context.state !== 'closed') this.context.close().catch(() => {});
    this.node = null; this.source = null; this.mute = null; this.stream = null; this.context = null;
  }
  clean() {
    this.deadline?.clear();
    for (const timer of ['healthTimer', 'connectTimer', 'recordingTimer', 'flushTimer', 'finalTimer']) clearTimeout(this[timer]);
    this.abortController?.abort(); this.abortController = null;
    this.releaseMicrophone();
    if (this.socket) {
      this.socket.onmessage = null; this.socket.onerror = null; this.socket.onclose = null;
      if (this.socket.readyState !== WebSocket.CLOSED) this.socket.close();
      this.socket = null;
    }
    this.onSpeech(false); this.onLevel(0);
    this.onCountdown(null);
  }
  destroy() { ++this.generation; this.clean(); this.state = 'idle'; }
}
