import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoRegistry } from '../server/mcp/demo-registry.js';
import { createMcpDispatcher, MCP_PROTOCOL_VERSION } from '../server/mcp/protocol.js';
import { LocalMcpTransport, McpClient, HttpMcpTransport } from '../server/mcp/client.js';

test('MCP client discovers registered tools and reads the server-owned demo secret', async () => {
  const registry = createDemoRegistry({
    secret: 'server-side-secret',
    now: () => new Date('2026-09-22T00:00:00.000Z'),
  });
  const client = new McpClient(new LocalMcpTransport(createMcpDispatcher(registry)));
  const server = await client.initialize();
  assert.equal(server.protocolVersion, MCP_PROTOCOL_VERSION);
  const tools = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['demo.get_secret', 'demo.echo']);
  const result = await client.callTool('demo.get_secret', { purpose: 'integration-test' });
  assert.equal(result.structuredContent.secret, 'server-side-secret');
  assert.equal(result.structuredContent.purpose, 'integration-test');
  assert.equal(result.structuredContent.issuedAt, '2026-09-22T00:00:00.000Z');
});

test('MCP resources are dynamically discoverable and readable', async () => {
  const client = new McpClient(new LocalMcpTransport(createMcpDispatcher(createDemoRegistry())));
  const resources = await client.listResources();
  assert.equal(resources[0].uri, 'demo://integration-guide');
  const result = await client.readResource(resources[0].uri);
  assert.match(result.contents[0].text, /MCP Tool/);
});

test('HTTP MCP transport sends bearer token and JSON-RPC without exposing transport details to caller', async () => {
  const requests = [];
  const transport = new HttpMcpTransport('https://mcp.example.test/mcp', {
    token: 'private-token',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  const response = await transport.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
  assert.equal(response.id, 7);
  assert.equal(requests[0].init.headers.authorization, 'Bearer private-token');
  assert.equal(JSON.parse(requests[0].init.body).method, 'tools/list');
});
