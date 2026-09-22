import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoRegistry } from './demo-registry.js';
import { createMcpDispatcher } from './protocol.js';
import { LocalMcpTransport, McpClient } from './client.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
try { process.loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const registry = createDemoRegistry({ secret: process.env.MCP_DEMO_SECRET });
const client = new McpClient(new LocalMcpTransport(createMcpDispatcher(registry)));
console.log(JSON.stringify({
  tools: (await client.listTools()).map(tool => tool.name),
  secretResult: await client.callTool('demo.get_secret', { purpose: 'MCP client demo' }),
}, null, 2));
