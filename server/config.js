import { randomUUID } from 'node:crypto';

const ENDPOINTS = new Set([
  'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
]);
const RESOURCES = new Set([
  'volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent',
  'volc.bigasr.sauc.duration', 'volc.bigasr.sauc.concurrent',
]);
function flag(env, key, fallback = true) {
  if (env[key] === undefined || env[key] === '') return fallback;
  if (!['true', 'false'].includes(env[key])) throw new Error(`${key} must be true or false`);
  return env[key] === 'true';
}
export function getConfig(env = process.env) {
  const endpoint = env.DOUBAO_ASR_URL || 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
  const resourceId = env.DOUBAO_RESOURCE_ID || 'volc.seedasr.sauc.duration';
  if (!ENDPOINTS.has(endpoint)) throw new Error('Unsupported DOUBAO_ASR_URL');
  if (!RESOURCES.has(resourceId)) throw new Error('Unsupported DOUBAO_RESOURCE_ID');
  return {
    apiKey: (env.DOUBAO_API_KEY || '').trim(), endpoint, resourceId,
    origins: new Set((env.ASR_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,http://localhost:3000,http://127.0.0.1:3000').split(',').map(value => value.trim()).filter(Boolean)),
    maxSessions: 2, maxRecordingMs: 120000, finalTimeoutMs: 15000,
    features: {
      age: flag(env, 'DOUBAO_ENABLE_AGE'), gender: flag(env, 'DOUBAO_ENABLE_GENDER'),
      emotion: flag(env, 'DOUBAO_ENABLE_EMOTION'), speaker: flag(env, 'DOUBAO_ENABLE_SPEAKER'),
    },
  };
}
export function makeRequest(config) {
  return {
    user: { uid: randomUUID() },
    audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
    request: {
      model_name: 'bigmodel', enable_nonstream: false,
      enable_itn: true, enable_punc: true, enable_ddc: true,
      result_type: 'full', show_utterances: true, end_window_size: 800,
      enable_speaker_info: config.features.speaker,
      enable_age_detection: config.features.age,
      enable_gender_detection: config.features.gender,
      enable_emotion_detection: config.features.emotion,
      show_speech_rate: true, show_volume: true,
    },
  };
}
