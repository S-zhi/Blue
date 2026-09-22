import test from 'node:test';
import assert from 'node:assert/strict';
import { McpAgent, MCP_GATEWAY_TOOL } from '../server/agent/runner.js';
import { OpenAICompatibleProvider } from '../server/agent/provider.js';
import { AGENT_SYSTEM_PROMPT } from '../server/agent/system-prompt.js';
import { getAgentConfig } from '../server/agent/config.js';
import { createDemoRegistry } from '../server/mcp/demo-registry.js';
import { createMcpDispatcher } from '../server/mcp/protocol.js';
import { McpClient, LocalMcpTransport } from '../server/mcp/client.js';

test('agent exposes exactly one model-side tool and routes every business call through MCP', async () => {
  const responses = [
    { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'mcp', arguments: '{"action":"list_tools"}' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: '2', type: 'function', function: { name: 'mcp', arguments: '{"action":"call_tool","name":"demo.get_secret","arguments":{"purpose":"agent-test"}}' } }] },
    { role: 'assistant', content: '已通过 MCP 读取演示密钥。' },
  ];
  const observed = [];
  const provider = {
    async complete(request) { observed.push(structuredClone(request)); return responses.shift(); },
  };
  const mcp = new McpClient(new LocalMcpTransport(createMcpDispatcher(createDemoRegistry({ secret: 'mcp-secret' }))));
  const result = await new McpAgent({ provider, mcp }).run('读取服务端密钥');
  assert.equal(result.output, '已通过 MCP 读取演示密钥。');
  assert.deepEqual(result.artifacts, [{ type: 'demo-secret', value: 'mcp-secret' }]);
  assert.deepEqual(result.calls, [
    { action: 'list_tools', target: null },
    { action: 'call_tool', target: 'demo.get_secret' },
  ]);
  assert.deepEqual(observed[0].tools, [MCP_GATEWAY_TOOL]);
  assert.match(observed[0].messages[0].content, /唯一外部能力.*mcp/s);
  assert.match(observed[2].messages.at(-1).content, /mcp-secret/);
});

test('agent rejects attempts to call tools outside the MCP gateway', async () => {
  const provider = { async complete() { return { role: 'assistant', tool_calls: [{ id: 'x', type: 'function', function: { name: 'filesystem', arguments: '{}' } }] }; } };
  const agent = new McpAgent({ provider, mcp: {} });
  await assert.rejects(() => agent.run('绕过 MCP'), /outside the MCP gateway/);
});

test('custom model provider uses Responses API by default and translates MCP function calls', async () => {
  let request;
  const provider = new OpenAICompatibleProvider({
    apiKey: 'test-api-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ output: [{ type: 'function_call', call_id: 'call_1', name: 'mcp', arguments: '{"action":"list_tools"}' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  const message = await provider.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [MCP_GATEWAY_TOOL] });
  assert.equal(message.tool_calls[0].function.name, 'mcp');
  assert.equal(request.url, 'https://api.deepseek.com/responses');
  assert.equal(request.init.headers.authorization, 'Bearer test-api-key');
  const body = JSON.parse(request.init.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.tools[0].name, 'mcp');
  assert.equal(body.tools[0].strict, false);
  assert.equal(body.input[0].role, 'user');
});

test('provider diagnostics preserve status and request ID while redacting credentials', async () => {
  const provider = new OpenAICompatibleProvider({
    apiKey: 'private-key-value', baseUrl: 'https://provider.example/v1', model: 'custom',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'upstream failed private-key-value Bearer abc sk-hidden' } }), {
      status: 520, headers: { 'content-type': 'application/json', 'cf-ray': 'diagnostic-request-id' },
    }),
  });
  await assert.rejects(() => provider.complete({ messages: [], tools: [] }), error => {
    assert.equal(error.status, 520);
    assert.match(error.message, /diagnostic-request-id/);
    assert.match(error.message, /upstream failed/);
    assert.ok(!/private-key-value|Bearer abc|sk-hidden/.test(error.message));
    return true;
  });
});

test('HTML gateway errors are summarized without returning the error page', async () => {
  const provider = new OpenAICompatibleProvider({
    apiKey: 'private', baseUrl: 'https://provider.example/v1', model: 'custom',
    fetchImpl: async () => new Response('<html>upstream internals</html>', { status: 520, headers: { 'content-type': 'text/html' } }),
  });
  await assert.rejects(() => provider.complete({ messages: [], tools: [] }), error => {
    assert.match(error.message, /HTTP 520/);
    assert.ok(!error.message.includes('upstream internals'));
    return true;
  });
});

test('plain diagnostic requests omit tools and malformed success payloads are rejected', async () => {
  const provider = new OpenAICompatibleProvider({
    apiKey: 'private', baseUrl: 'https://provider.example/v1', model: 'custom',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal('tools' in body, false);
      assert.equal('tool_choice' in body, false);
      return new Response(JSON.stringify({ error: 'invalid successful response' }), { status: 200 });
    },
  });
  await assert.rejects(() => provider.complete({ messages: [], tools: [] }), /完整的 Responses/);
});

test('custom model provider retains optional Chat Completions compatibility', async () => {
  let url;
  const provider = new OpenAICompatibleProvider({
    apiKey: 'key', baseUrl: 'https://provider.example/v1', model: 'custom', apiStyle: 'chat-completions',
    fetchImpl: async (requestUrl) => {
      url = requestUrl;
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200 });
    },
  });
  assert.equal((await provider.complete({ messages: [], tools: [] })).content, 'ok');
  assert.equal(url, 'https://provider.example/v1/chat/completions');
});

test('agent configuration uses requested defaults without exposing API key through other fields', () => {
  const config = getAgentConfig({ ASXS_CODE_API_KEY: 'secret-key' });
  assert.equal(config.baseUrl, 'https://api.deepseek.com');
  assert.equal(config.model, 'deepseek-flash');
  assert.equal(config.apiStyle, 'responses');
  assert.equal(config.apiKey, 'secret-key');
  assert.ok(!JSON.stringify({ ...config, apiKey: undefined }).includes('secret-key'));
  assert.match(AGENT_SYSTEM_PROMPT, /所有动态信息.*必须通过 mcp/s);
});
