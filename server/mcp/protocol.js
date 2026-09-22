import { McpError, MCP_ERROR } from './errors.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25';

export function createMcpDispatcher(registry, { serverName = 'blue-agent-mcp', serverVersion = '0.1.0' } = {}) {
  return async function dispatch(message, context = {}) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return errorResponse(message?.id ?? null, new McpError(MCP_ERROR.INVALID_REQUEST, 'Invalid JSON-RPC request'));
    }
    const notification = message.id === undefined;
    try {
      let result;
      switch (message.method) {
        case 'initialize':
          result = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
            serverInfo: { name: serverName, version: serverVersion },
            instructions: 'Use tools/list before calling an unfamiliar capability.',
          };
          break;
        case 'notifications/initialized': return null;
        case 'ping': result = {}; break;
        case 'tools/list': result = { tools: registry.listTools() }; break;
        case 'tools/call':
          if (!message.params?.name) throw new McpError(MCP_ERROR.INVALID_PARAMS, 'tools/call requires params.name');
          result = await registry.callTool(message.params.name, message.params.arguments, context);
          break;
        case 'resources/list': result = { resources: registry.listResources() }; break;
        case 'resources/read':
          if (!message.params?.uri) throw new McpError(MCP_ERROR.INVALID_PARAMS, 'resources/read requires params.uri');
          result = await registry.readResource(message.params.uri, context);
          break;
        default: throw new McpError(MCP_ERROR.METHOD_NOT_FOUND, `Unknown MCP method: ${message.method}`);
      }
      return notification ? null : { jsonrpc: '2.0', id: message.id, result };
    } catch (error) {
      if (notification) return null;
      return errorResponse(message.id, error);
    }
  };
}

function errorResponse(id, error) {
  const known = error instanceof McpError;
  return {
    jsonrpc: '2.0', id,
    error: {
      code: known ? error.code : MCP_ERROR.INTERNAL_ERROR,
      message: known ? error.message : 'Internal MCP server error',
      ...(known && error.data !== undefined ? { data: error.data } : {}),
    },
  };
}
