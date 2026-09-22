import { AGENT_SYSTEM_PROMPT } from './system-prompt.js';

export const MCP_GATEWAY_TOOL = Object.freeze({
  type: 'function',
  function: {
    name: 'mcp',
    description: '唯一的业务能力入口。动态发现并调用 MCP 工具或读取 MCP 资源。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_tools', 'call_tool', 'list_resources', 'read_resource'] },
        name: { type: 'string', description: 'call_tool 时使用的 MCP 工具名' },
        arguments: { type: 'object', description: 'call_tool 时传给 MCP 工具的参数' },
        uri: { type: 'string', description: 'read_resource 时使用的 MCP 资源 URI' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
});

export class McpAgent {
  constructor({ provider, mcp, systemPrompt = AGENT_SYSTEM_PROMPT, maxSteps = 8 }) {
    this.provider = provider;
    this.mcp = mcp;
    this.systemPrompt = systemPrompt;
    this.maxSteps = maxSteps;
  }

  async run(input, { signal } = {}) {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: input },
    ];
    const calls = [];
    const artifacts = [];
    for (let step = 0; step < this.maxSteps; step++) {
      signal?.throwIfAborted();
      const message = await this.provider.complete({ messages, tools: [MCP_GATEWAY_TOOL], signal });
      messages.push(message);
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!toolCalls.length) {
        return { output: textContent(message.content), steps: step + 1, calls, artifacts };
      }
      for (const call of toolCalls) {
        signal?.throwIfAborted();
        if (call?.type !== 'function' || call.function?.name !== 'mcp') {
          throw new Error('Model attempted to call a tool outside the MCP gateway');
        }
        const args = parseToolArguments(call.function.arguments);
        const result = await this.#executeMcp(args);
        if (args.action === 'call_tool' && args.name === 'demo.get_secret' && !result.isError && typeof result.structuredContent?.secret === 'string') {
          artifacts.push({ type: 'demo-secret', value: result.structuredContent.secret });
        }
        calls.push({ action: args.action, target: args.name || args.uri || null });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: 'mcp',
          content: limitToolResult(JSON.stringify(result)),
        });
      }
    }
    throw new Error(`Agent exceeded the ${this.maxSteps}-step limit`);
  }

  async #executeMcp(args) {
    switch (args.action) {
      case 'list_tools': return { tools: await this.mcp.listTools() };
      case 'call_tool':
        if (!args.name) throw new Error('mcp call_tool requires name');
        return this.mcp.callTool(args.name, args.arguments || {});
      case 'list_resources': return { resources: await this.mcp.listResources() };
      case 'read_resource':
        if (!args.uri) throw new Error('mcp read_resource requires uri');
        return this.mcp.readResource(args.uri);
      default: throw new Error(`Unsupported MCP gateway action: ${args.action}`);
    }
  }
}

function parseToolArguments(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); }
  catch { throw new Error('Model returned invalid JSON arguments for mcp'); }
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(item => item?.type === 'text').map(item => item.text).join('');
  return '';
}

function limitToolResult(text, max = 64 * 1024) {
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}
