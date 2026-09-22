import { MCP_PROTOCOL_VERSION } from './protocol.js';

export class LocalMcpTransport {
  constructor(dispatch, context = {}) { this.dispatch = dispatch; this.context = context; }
  send(message) { return this.dispatch(message, this.context); }
}

export class HttpMcpTransport {
  constructor(url, { token, fetchImpl = fetch } = {}) {
    this.url = url;
    this.token = token;
    this.fetch = fetchImpl;
  }
  async send(message) {
    const response = await this.fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`MCP transport failed with HTTP ${response.status}`);
    if (response.status === 202) return null;
    return response.json();
  }
}

export class McpClient {
  #nextId = 1;
  #initialized = false;
  constructor(transport, { name = 'blue-agent-client', version = '0.1.0' } = {}) {
    this.transport = transport;
    this.clientInfo = { name, version };
  }
  async initialize() {
    if (this.#initialized) return this.server;
    const result = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: this.clientInfo,
    }, false);
    await this.notify('notifications/initialized');
    this.#initialized = true;
    this.server = result;
    return result;
  }
  async listTools() { await this.initialize(); return (await this.request('tools/list')).tools || []; }
  async callTool(name, args = {}) { await this.initialize(); return this.request('tools/call', { name, arguments: args }); }
  async listResources() { await this.initialize(); return (await this.request('resources/list')).resources || []; }
  async readResource(uri) { await this.initialize(); return this.request('resources/read', { uri }); }
  async request(method, params, initialize = true) {
    if (initialize && method !== 'initialize') await this.initialize();
    const id = this.#nextId++;
    const response = await this.transport.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    if (!response || response.id !== id) throw new Error(`Invalid MCP response for ${method}`);
    if (response.error) throw new Error(`MCP ${method} failed: ${response.error.message}`);
    return response.result;
  }
  notify(method, params) {
    return this.transport.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }
}
