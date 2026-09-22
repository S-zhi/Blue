import { createDemoRegistry } from '../mcp/demo-registry.js';
import { createMcpDispatcher } from '../mcp/protocol.js';
import { McpClient, LocalMcpTransport, HttpMcpTransport } from '../mcp/client.js';
import { createMcpHttpMiddleware, readJson } from '../mcp/http.js';
import { OpenAICompatibleProvider } from './provider.js';
import { McpAgent } from './runner.js';

const MAX_INPUT = 16 * 1024;

export function createAgentPlatform(config, overrides = {}) {
  const registry = overrides.registry || createDemoRegistry({ secret: config.demoSecret });
  const dispatch = createMcpDispatcher(registry);
  const transport = overrides.transport || (config.mcpUrl
    ? new HttpMcpTransport(config.mcpUrl, { token: config.mcpToken, fetchImpl: overrides.fetchImpl })
    : new LocalMcpTransport(dispatch, { source: 'agent-local-transport' }));
  const mcp = overrides.mcp || new McpClient(transport);
  const provider = overrides.provider || new OpenAICompatibleProvider({ ...config, fetchImpl: overrides.fetchImpl });
  const agent = overrides.agent || new McpAgent({ provider, mcp, maxSteps: config.maxSteps });
  const mcpMiddleware = createMcpHttpMiddleware(dispatch, { token: config.mcpToken });
  let active = 0;

  async function middleware(request, response, next) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/mcp') return mcpMiddleware(request, response, next);
    if (pathname === '/api/agent/health') {
      if (request.method !== 'GET') { response.writeHead(405); return response.end(); }
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      return response.end(JSON.stringify({
        configured: Boolean(config.apiKey),
        model: config.model,
        providerHost: new URL(config.baseUrl).host,
        mcpMode: config.mcpUrl ? 'remote' : 'local-demo',
      }));
    }
    if (pathname !== '/api/agent/run') return next();
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); return response.end(); }
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (!config.apiKey) { response.writeHead(503); return response.end(JSON.stringify({ error: 'Agent model is not configured' })); }
    if (active >= config.maxConcurrent) { response.writeHead(429); return response.end(JSON.stringify({ error: 'Agent is busy' })); }
    active++;
    const controller = new AbortController();
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnect);
    try {
      const body = await readJson(request, MAX_INPUT);
      const input = typeof body.input === 'string' ? body.input.trim() : '';
      if (!input || input.length > 10000) { response.writeHead(400); return response.end(JSON.stringify({ error: 'input must be 1-10000 characters' })); }
      const result = await agent.run(input, { signal: controller.signal });
      response.end(JSON.stringify({ ...result, model: config.model }));
    } catch (error) {
      response.writeHead(502);
      response.end(JSON.stringify({ error: sanitizeError(error) }));
    } finally { active--; response.off('close', disconnect); }
  }

  return { middleware, registry, dispatch, mcp, agent };
}

function sanitizeError(error) {
  const message = String(error?.message || 'Agent request failed');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}
