import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmToWav } from '../scripts/tts-audio.js';

test('playback WAV describes PCM byte count, mono format and 24kHz rate without changing samples', () => {
  const pcm = Buffer.from([0, 128, 255, 127, 0, 0, 0, 64]);
  const wav = pcmToWav(pcm, 24000);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(28), 48000);
  assert.equal(wav.readUInt16LE(32), 2);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});

test('invalid or incomplete PCM cannot be passed to the system player', () => {
  assert.throws(() => pcmToWav(Buffer.from([1]), 24000), /INVALID_PCM/);
  assert.throws(() => pcmToWav(Buffer.alloc(0), 24000), /INVALID_PCM/);
  assert.throws(() => pcmToWav(Buffer.from([1, 0]), 12345), /INVALID_SAMPLE_RATE/);
});
