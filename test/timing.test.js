import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptDeadline, CaptionRetention } from '../src/voice/timing.js';

test('no recognition content ends after ten seconds even if sound continues', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ended = 0; const deadline = new TranscriptDeadline(() => ended++);
  deadline.start(); t.mock.timers.tick(9999); assert.equal(ended, 0);
  deadline.update(''); t.mock.timers.tick(1); assert.equal(ended, 1);
});
test('only changed text renews the deadline; duplicate hypotheses do not', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ended = 0; const deadline = new TranscriptDeadline(() => ended++);
  deadline.start(); t.mock.timers.tick(9000); deadline.update('你好');
  t.mock.timers.tick(9000); deadline.update('你好');
  t.mock.timers.tick(1000); assert.equal(ended, 1);
});
test('revised text cancels pending end and cleanup cancels all timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ended = 0; const deadline = new TranscriptDeadline(() => ended++);
  deadline.start(); deadline.update('你好'); t.mock.timers.tick(9999);
  deadline.update('你好世界'); t.mock.timers.tick(9999); assert.equal(ended, 0);
  deadline.clear(); t.mock.timers.tick(10000); assert.equal(ended, 0);
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
