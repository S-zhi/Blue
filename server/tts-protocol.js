import { gunzipSync, gzipSync } from 'node:zlib';

const MESSAGE = { client: 1, server: 9, audio: 11, error: 15 };
const FLAGS_WITH_EVENT = 4;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

export const TTS_EVENT = Object.freeze({
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  START_SESSION: 100,
  CANCEL_SESSION: 101,
  FINISH_SESSION: 102,
  TASK_REQUEST: 200,
  CONNECTION_STARTED: 50,
  CONNECTION_FINISHED: 52,
  CONNECTION_FAILED: 51,
  SESSION_STARTED: 150,
  SESSION_FINISHED: 152,
  SESSION_FAILED: 153,
  SESSION_CANCELED: 151,
  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352,
  TTS_SUBTITLE: 353,
});

const CONNECTION_EVENTS = new Set([50, 51, 52]);

function jsonBytes(payload) {
  return Buffer.from(JSON.stringify(payload ?? {}));
}

export function encodeTtsEvent(event, payload = {}, { sessionId, gzip = false } = {}) {
  let body = jsonBytes(payload);
  if (gzip) body = gzipSync(body);
  const session = sessionId ? Buffer.from(sessionId) : null;
  const metadataBytes = 4 + (session ? 4 + session.length : 0) + 4;
  const frame = Buffer.allocUnsafe(4 + metadataBytes + body.length);
  frame.set([0x11, (MESSAGE.client << 4) | FLAGS_WITH_EVENT, (1 << 4) | (gzip ? 1 : 0), 0], 0);
  let offset = 4;
  frame.writeInt32BE(event, offset); offset += 4;
  if (session) {
    frame.writeUInt32BE(session.length, offset); offset += 4;
    session.copy(frame, offset); offset += session.length;
  }
  frame.writeUInt32BE(body.length, offset); offset += 4;
  body.copy(frame, offset);
  return frame;
}

function readBytes(bytes, state, label) {
  if (state.offset + 4 > bytes.length) throw new Error(`Truncated TTS ${label} length`);
  const size = bytes.readUInt32BE(state.offset); state.offset += 4;
  if (size > MAX_PAYLOAD_BYTES || state.offset + size > bytes.length) throw new Error(`Invalid TTS ${label} size`);
  const value = bytes.subarray(state.offset, state.offset + size); state.offset += size;
  return value;
}

export function decodeTtsResponse(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 8) throw new Error('TTS response frame is truncated');
  const version = bytes[0] >> 4;
  const headerBytes = (bytes[0] & 15) * 4;
  const messageType = bytes[1] >> 4;
  const flags = bytes[1] & 15;
  const serialization = bytes[2] >> 4;
  const compression = bytes[2] & 15;
  if (version !== 1 || headerBytes < 4 || headerBytes > bytes.length - 4) throw new Error('Invalid TTS header');
  if (![MESSAGE.server, MESSAGE.audio, MESSAGE.error].includes(messageType)) throw new Error('Unsupported TTS message type');
  if (![0, 1].includes(compression)) throw new Error('Unsupported TTS compression');
  if (![0, 1].includes(serialization)) throw new Error('Unsupported TTS serialization');
  if (![0, 1, 2, 3, 4].includes(flags)) throw new Error('Unsupported TTS flags');
  const state = { offset: headerBytes };
  const readInt = (signed = false) => {
    if (state.offset + 4 > bytes.length) throw new Error('Truncated TTS metadata');
    const value = signed ? bytes.readInt32BE(state.offset) : bytes.readUInt32BE(state.offset);
    state.offset += 4;
    return value;
  };
  let event = null, sequence = null, code = 0, connectionId = null, sessionId = null;
  // ErrorInformation frames have an error code in place of a sequence; they
  // normally have NoSeq (0), so the first integer must not be read as an event.
  if (messageType === MESSAGE.error) code = readInt();
  else if (flags === 1 || flags === 3) sequence = readInt(true);
  if (flags === FLAGS_WITH_EVENT) {
    event = readInt(true);
    if (CONNECTION_EVENTS.has(event)) connectionId = readBytes(bytes, state, 'connection id').toString();
    else sessionId = readBytes(bytes, state, 'session id').toString();
  }
  let payload = readBytes(bytes, state, 'payload');
  if (state.offset !== bytes.length) throw new Error('Unexpected bytes after TTS payload');
  if (compression === 1) payload = gunzipSync(payload, { maxOutputLength: MAX_PAYLOAD_BYTES });
  // AudioOnlyServer carries PCM, even when a provider sets JSON in the header.
  const audio = messageType === MESSAGE.audio;
  let payloadJson = null;
  if (!audio && serialization === 1 && payload.length) payloadJson = JSON.parse(payload.toString());
  return { event, sequence, code, flags, messageType, connectionId, sessionId, payload, payloadJson, audio };
}
