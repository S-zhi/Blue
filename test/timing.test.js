import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceActivityDetector } from '../src/voice/audio-core.js';
import { TurnEndDetector, CaptionRetention } from '../src/voice/timing.js';

function detector() {
  const vad = new VoiceActivityDetector(), turn = new TurnEndDetector();
  return (rms, count = 1) => {
    let result;
    for (let i = 0; i < count; i++) result = turn.update(rms, 20, vad.update(rms, 20));
    return result;
  };
}

test('initial silence and isolated clicks do not start the end-of-turn countdown', () => {
  const feed = detector();
  assert.equal(feed(0, 600).remainingMs, null);
  feed(.1);
  assert.equal(feed(0, 600).ended, false);
  assert.equal(feed(0).remainingMs, null);
});

test('turn ends exactly ten seconds after speech, including the VAD release delay', () => {
  const feed = detector(); feed(.1, 3);
  assert.equal(feed(0, 29).waiting, false);
  assert.deepEqual(feed(0), { waiting: true, remainingMs: 9400, ended: false });
  assert.equal(feed(0, 469).ended, false);
  assert.equal(feed(0).ended, true);
});

test('sound at 9.98 seconds cancels confirmation immediately and restarts the quiet window', () => {
  const feed = detector(); feed(.1, 3); feed(0, 499);
  assert.deepEqual(feed(.1), { waiting: false, remainingMs: 10000, ended: false });
  feed(.1, 2);
  assert.equal(feed(0, 499).ended, false);
  assert.equal(feed(0).ended, true);
});

test('sustained speech never ends automatically through the silence detector', () => {
  assert.equal(detector()(.05, 2000).ended, false);
});

test('captions expire after 30 seconds; duplicate and final-only updates do not renew them', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let expired = 0;
  const retention = new CaptionRetention(() => expired++);
  assert.equal(retention.update('正在说话'), true);
  t.mock.timers.tick(29000);
  assert.equal(retention.update('正在说话'), true);
  t.mock.timers.tick(999); assert.equal(expired, 0);
  t.mock.timers.tick(1); assert.equal(expired, 1);
  assert.equal(retention.update('正在说话'), false);
  assert.equal(retention.update(''), false);
});

test('new transcript content renews retention; clearing cancels pending expiry', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let expired = 0;
  const retention = new CaptionRetention(() => expired++);
  retention.update('你好'); t.mock.timers.tick(20000);
  retention.update('你好，世界'); t.mock.timers.tick(29999);
  assert.equal(expired, 0);
  t.mock.timers.tick(1); assert.equal(expired, 1);
  retention.update('新一句'); retention.clear(); t.mock.timers.tick(30000);
  assert.equal(expired, 1);
  assert.equal(retention.update('新一句'), true);
  retention.clear();
});

test('a new recording preserves existing caption until its own first result, even when repeated', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const retention = new CaptionRetention(() => {});
  retention.update('你好'); t.mock.timers.tick(20000);
  retention.beginTurn();
  t.mock.timers.tick(10000);
  assert.equal(retention.visible, false);
  assert.equal(retention.update('你好'), true);
  t.mock.timers.tick(29999); assert.equal(retention.visible, true);
  t.mock.timers.tick(1); assert.equal(retention.visible, false);
});
