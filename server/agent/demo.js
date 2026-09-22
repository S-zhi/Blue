import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentConfig } from './config.js';
import { createAgentPlatform } from './platform.js';
import { runConsole } from './console.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
try { process.loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const args = process.argv.slice(2);
const once = args.includes('--once');
const input = args.filter(arg => arg !== '--once').join(' ');
const config = getAgentConfig();
const platform = createAgentPlatform(config);
await runConsole({ agent: platform.agent, initial: input || (once ? '请通过 MCP 读取演示密钥' : ''), once });
