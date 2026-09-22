export class McpError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

export const MCP_ERROR = Object.freeze({
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});
