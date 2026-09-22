import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmFramer, Packetizer, VoiceActivityDetector } from '../src/voice/audio-core.js';

for (const rate of [16000, 44100, 48000]) {
  test(`streaming ${rate} Hz audio produces 16000 samples per second without chunk drift`, () => {
    const frames = [];
    const framer = new PcmFramer(rate, frame => frames.push(frame));
    const audio = Float32Array.from({ length: rate }, (_, i) => Math.sin(i * Math.PI * 2 * 440 / rate) * .5);
    for (let offset = 0; offset < audio.length; offset += 137) framer.push(audio.subarray(offset, offset + 137));
    framer.flush();
    assert.equal(frames.reduce((sum, frame) => sum + frame.pcm.byteLength / 2, 0), 16000);
    assert.ok(frames.every(frame => frame.pcm.byteLength <= 640));
    assert.ok(frames.every(frame => frame.rms > .25 && frame.rms < .45));
  });
}
test('PCM clips safely and encodes signed little-endian samples', () => {
  let output;
  const framer = new PcmFramer(16000, frame => { output = new DataView(frame.pcm); });
  framer.push(new Float32Array([-2, 2, 0])); framer.flush();
  assert.equal(output.getInt16(0, true), -32768); assert.equal(output.getInt16(2, true), 32767); assert.equal(output.getInt16(4, true), 0);
});
test('200ms packetization preserves all bytes and sends the final short tail exactly once', () => {
  const outputs = [];
  const input = Uint8Array.from({ length: 16000 }, (_, index) => index % 251);
  const packets = new Packetizer(packet => outputs.push(packet));
  for (let offset = 0; offset < input.length; offset += 640) packets.push(input.slice(offset, offset + 640).buffer);
  packets.flush(); packets.flush();
  assert.deepEqual(outputs.map(packet => packet.length), [6400, 6400, 3200]);
  assert.deepEqual(Buffer.concat(outputs), Buffer.from(input));
});
test('voice trigger requires 60ms attack and 600ms quiet release', () => {
  const vad = new VoiceActivityDetector();
  assert.equal(vad.update(.1).speaking, false);
  assert.equal(vad.update(.1).speaking, false);
  assert.equal(vad.update(.1).speaking, true);
  for (let index = 0; index < 29; index++) assert.equal(vad.update(0).speaking, true);
  assert.equal(vad.update(0).speaking, false);
  assert.equal(vad.update(.2).speaking, false); // A single click does not trigger.
  assert.equal(vad.update(0).speaking, false);
});
