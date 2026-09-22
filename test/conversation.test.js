import test from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from '../src/conversation.js';
import { SubtitleWriter } from '../src/subtitles.js';
import { runConsole } from '../server/agent/console.js';
import { Readable, Writable } from 'node:stream';

function setup(request) {
  const output = [];
  const captions = { begin() {}, show(text, role) { output.push({ text, role }); }, dispose() {} };
  return { conversation: new Conversation({ captions, request }), output };
}

test('only final speech executes, exactly once per turn; identical next-turn commands still execute', async () => {
  const requests = [];
  const { conversation, output } = setup(async text => { requests.push(text); return { output: '已完成' }; });
  conversation.beginVoice();
  conversation.voiceResult({ text: '查', final: false });
  conversation.voiceResult({ text: '查询', utterances: [{ definite: true }], final: false });
  assert.equal(requests.length, 0);
  await conversation.voiceResult({ text: '查询', final: true });
  await conversation.voiceResult({ text: '查询', final: true });
  assert.deepEqual(requests, ['查询']);
  assert.deepEqual(output.at(-1), { text: '已完成', role: 'assistant' });
  conversation.beginVoice();
  await conversation.voiceResult({ text: '查询', final: true });
  assert.deepEqual(requests, ['查询', '查询']);
  conversation.dispose();
});

test('manual fallback is only available without microphone and uses the same execution path', async () => {
  const requests = [];
  const { conversation, output } = setup(async text => { requests.push(text); return { output: '读取完成', artifacts: [{ type: 'demo-secret', value: 'demo-123' }] }; });
  await conversation.manual('获取密钥');
  conversation.setMicrophone(true); await conversation.manual('获取密钥');
  assert.equal(requests.length, 0);
  conversation.setMicrophone(false); await conversation.manual('获取密钥');
  assert.deepEqual(requests, ['获取密钥']);
  assert.deepEqual(output.at(-1), { text: '读取完成\n演示密钥：demo-123', role: 'assistant' });
  conversation.dispose();
});

test('late answers never overwrite a newer speech transcript', async () => {
  let finish;
  const { conversation, output } = setup(() => new Promise(resolve => { finish = resolve; }));
  conversation.beginVoice();
  const pending = conversation.voiceResult({ text: '旧问题', final: true });
  await Promise.resolve();
  conversation.beginVoice(); conversation.voiceResult({ text: '新问题', final: false });
  finish({ output: '旧回答' }); await pending;
  assert.deepEqual(output.at(-1), { text: '新问题', role: 'user' });
  conversation.dispose();
});

test('an upstream failure appears as an error subtitle and does not block the next turn', async () => {
  let count = 0;
  const { conversation, output } = setup(async () => { if (count++ === 0) throw new Error('HTTP 520'); return { output: '恢复' }; });
  conversation.setMicrophone(false);
  await conversation.manual('第一次');
  assert.equal(output.at(-1).role, 'error');
  assert.match(output.at(-1).text, /520/);
  await conversation.manual('第二次');
  assert.equal(output.at(-1).text, '恢复');
  conversation.dispose();
});

test('subtitles reveal graphemes progressively and remain for thirty seconds after completion', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const output = [];
  const writer = new SubtitleWriter((...args) => output.push(args), { interval: 10 });
  writer.show('你好👨‍👩‍👧', 'assistant');
  assert.deepEqual(output.at(-1), ['你', 'assistant', true]);
  t.mock.timers.tick(10); assert.equal(output.at(-1)[0], '你好');
  t.mock.timers.tick(10); assert.deepEqual(output.at(-1), ['你好👨‍👩‍👧', 'assistant', false]);
  t.mock.timers.tick(29999); assert.equal(output.at(-1)[0], '你好👨‍👩‍👧');
  t.mock.timers.tick(1); assert.equal(output.at(-1)[0], '');
  writer.show('你好👨‍👩‍👧', 'assistant'); assert.equal(output.at(-1)[0], '');
  writer.begin(); writer.show('你好👨‍👩‍👧', 'assistant'); assert.equal(output.at(-1)[0], '你');
  writer.dispose();
});

test('recognition revisions replace the changed suffix without stacking typing timers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let current;
  const writer = new SubtitleWriter(text => { current = text; }, { interval: 10 });
  writer.show('你好'); t.mock.timers.tick(10);
  writer.show('你们好'); assert.equal(current, '你们');
  t.mock.timers.tick(10); assert.equal(current, '你们好');
  writer.dispose();
});

test('interactive demo processes multiple requests and continues after a failed request', async () => {
  let printed = ''; const calls = [];
  const output = new Writable({ write(chunk, _encoding, callback) { printed += chunk.toString(); callback(); } });
  const input = Readable.from(['失败\n', '第二条\n', '/exit\n', '不执行\n']);
  const agent = { async run(text) { calls.push(text); if (text === '失败') throw new Error('test 520'); return { output: `${text}完成` }; } };
  await runConsole({ agent, input, output, initial: '第一条' });
  assert.deepEqual(calls, ['第一条', '失败', '第二条']);
  assert.match(printed, /第二条完成/); assert.match(printed, /test 520/);
});
