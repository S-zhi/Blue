import { McpRegistry } from './registry.js';

export function createDemoRegistry({ secret, now = () => new Date() } = {}) {
  const storedSecret = secret || 'demo-secret-not-for-production';
  return new McpRegistry()
    .registerTool({
      name: 'demo.get_secret',
      title: '读取演示密钥',
      description: '从 Demo MCP 服务端读取由服务端持有的演示密钥。仅用于验证 MCP 调用链路。',
      inputSchema: {
        type: 'object',
        properties: { purpose: { type: 'string', description: '本次读取密钥的用途说明' } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async args => ({
      secret: storedSecret,
      source: 'demo-mcp-server',
      purpose: typeof args.purpose === 'string' ? args.purpose : 'unspecified',
      issuedAt: now().toISOString(),
    }))
    .registerTool({
      name: 'demo.echo',
      title: '回显结构化信息',
      description: '回显输入内容，用于验证新 MCP 工具的注册和参数传递。',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async args => ({ echo: String(args.message || '') }))
    .registerResource({
      uri: 'demo://integration-guide',
      name: 'MCP 接入提示',
      description: 'Demo MCP 服务端提供的静态接入信息',
      mimeType: 'text/markdown',
    }, async () => ({
      uri: 'demo://integration-guide',
      mimeType: 'text/markdown',
      text: '新能力应注册为具有稳定名称、明确输入 Schema 和结构化返回值的 MCP Tool。',
    }));
}
