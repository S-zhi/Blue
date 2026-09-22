import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioCaptions } from '../src/tts/captions.js';

test('sentence captions use PCM boundaries and preserve punctuation and whitespace', () => {
  const captions = new AudioCaptions('你好。\n世界！');
  captions.sentence({ boundary: 'start', text: '你好。', audioBytes: 0 }, 24000);
  captions.sentence({ boundary: 'end', audioBytes: 48000 }, 24000);
  captions.sentence({ boundary: 'start', text: '世界！', audioBytes: 48000 }, 24000);
  captions.sentence({ boundary: 'end', audioBytes: 96000 }, 24000);
  assert.equal(captions.at(null), '');
  assert.equal(captions.at(0), '你好。');
  assert.equal(captions.at(.9), '你好。');
  assert.equal(captions.at(1), '你好。\n世界！');
  assert.equal(captions.end, 2);
});

test('word timestamps are deduplicated and malformed timing cannot release audio', () => {
  const captions = new AudioCaptions('Hello world.');
  captions.add({ words: [{ word: 'Hello', startTime: 0, endTime: .5 }, { word: 'world.', startTime: .8, endTime: 1 }] });
  captions.add({ words: [{ word: 'Hello', startTime: 0, endTime: .5 }, { word: 'invalid', startTime: 0, endTime: -1 }] });
  assert.equal(captions.words.length, 2);
  assert.equal(captions.at(.6), 'Hello'); assert.equal(captions.at(.8), 'Hello world.');
});
