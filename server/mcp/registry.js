import { McpError, MCP_ERROR } from './errors.js';

function assertName(name) {
  if (!/^[a-z][a-z0-9_.-]{1,79}$/i.test(name)) throw new Error(`Invalid MCP name: ${name}`);
}

export class McpRegistry {
  #tools = new Map();
  #resources = new Map();

  registerTool(definition, handler) {
    assertName(definition?.name);
    if (this.#tools.has(definition.name)) throw new Error(`Duplicate MCP tool: ${definition.name}`);
    if (typeof handler !== 'function') throw new TypeError('MCP tool handler must be a function');
    this.#tools.set(definition.name, {
      definition: {
        name: definition.name,
        title: definition.title,
        description: definition.description || '',
        inputSchema: definition.inputSchema || { type: 'object', additionalProperties: false },
        annotations: definition.annotations,
      },
      handler,
    });
    return this;
  }

  registerResource(definition, reader) {
    if (!definition?.uri || !definition?.name) throw new Error('MCP resource requires uri and name');
    if (this.#resources.has(definition.uri)) throw new Error(`Duplicate MCP resource: ${definition.uri}`);
    if (typeof reader !== 'function') throw new TypeError('MCP resource reader must be a function');
    this.#resources.set(definition.uri, { definition: { ...definition }, reader });
    return this;
  }

  listTools() { return [...this.#tools.values()].map(item => item.definition); }
  listResources() { return [...this.#resources.values()].map(item => item.definition); }

  async callTool(name, args = {}, context = {}) {
    const entry = this.#tools.get(name);
    if (!entry) throw new McpError(MCP_ERROR.INVALID_PARAMS, `Unknown MCP tool: ${name}`);
    const result = await entry.handler(args && typeof args === 'object' ? args : {}, context);
    if (result?.content) return result;
    return {
      content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
      structuredContent: result ?? null,
    };
  }

  async readResource(uri, context = {}) {
    const entry = this.#resources.get(uri);
    if (!entry) throw new McpError(MCP_ERROR.INVALID_PARAMS, `Unknown MCP resource: ${uri}`);
    const result = await entry.reader(context);
    return { contents: Array.isArray(result) ? result : [result] };
  }
}
