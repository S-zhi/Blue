import { gzipSync, gunzipSync } from 'node:zlib';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Doubao binary protocol v1: 4-byte header, optional sequence, size, payload.
// Client uses unsequenced messages; the last audio packet uses flag 0b0010.
function encode(type, flags, serialization, payload) {
  const compressed = gzipSync(payload);
  const frame = Buffer.allocUnsafe(8 + compressed.length);
  frame.set([0x11, (type << 4) | flags, (serialization << 4) | 1, 0], 0);
  frame.writeUInt32BE(compressed.length, 4);
  compressed.copy(frame, 8);
  return frame;
}
export function encodeRequest(payload) {
  return encode(1, 0, 1, Buffer.from(JSON.stringify(payload)));
}
export function encodeAudio(pcm, final = false) {
  return encode(2, final ? 2 : 0, 0, Buffer.from(pcm));
}
export function decodeResponse(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 8) throw new Error('ASR response frame is truncated');
  const version = bytes[0] >> 4;
  const headerBytes = (bytes[0] & 15) * 4;
  const type = bytes[1] >> 4, flags = bytes[1] & 15;
  const serialization = bytes[2] >> 4, compression = bytes[2] & 15;
  if (version !== 1 || headerBytes < 4 || headerBytes > bytes.length - 4) throw new Error('Invalid ASR header');
  if (![9, 11, 15].includes(type) || ![0, 1].includes(compression)) throw new Error('Unsupported ASR frame');
  let offset = headerBytes, sequence, code = 0;
  const readInt = (signed = false) => {
    if (offset + 4 > bytes.length) throw new Error('Truncated ASR metadata');
    const value = signed ? bytes.readInt32BE(offset) : bytes.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  if (type === 15) code = readInt();
  else if ((flags & 1) || type === 11) sequence = readInt(true);
  // ACK frames may contain only the sequence.
  if (type === 11 && offset === bytes.length) return { code, sequence, final: Boolean(flags & 2), payload: {} };
  const size = readInt();
  if (size > MAX_RESPONSE_BYTES || offset + size !== bytes.length) throw new Error('Invalid ASR payload size');
  let payload = bytes.subarray(offset);
  if (compression === 1) payload = gunzipSync(payload, { maxOutputLength: MAX_RESPONSE_BYTES });
  if (serialization === 1) payload = JSON.parse(payload.toString('utf8'));
  else if (type === 15) payload = { message: payload.toString('utf8') };
  else if (size) throw new Error('Expected JSON ASR result');
  else payload = {};
  return { code, sequence, final: Boolean(flags & 2) || sequence < 0, payload };
}
