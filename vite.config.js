import { defineConfig, loadEnv } from 'vite';
import { attachAsrServer } from './server/asr.js';
import { getConfig } from './server/config.js';
import { getAgentConfig } from './server/agent/config.js';
import { createAgentPlatform } from './server/agent/platform.js';

export default defineConfig(({ mode }) => {
  // These values stay in the Node process; nothing is placed in Vite `define`.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const config = getConfig(env);
  const agentConfig = getAgentConfig(env);
  function attach(server) {
    if (!server.httpServer) throw new Error('ASR requires an HTTP server');
    const bridge = attachAsrServer(server.httpServer, config);
    const agentPlatform = createAgentPlatform(agentConfig);
    server.middlewares.use(agentPlatform.middleware);
    server.middlewares.use(bridge.middleware);
    server.httpServer.once('close', bridge.close);
  }
  return {
    plugins: [{ name: 'blue-server-platform', configureServer: attach, configurePreviewServer: attach }],
    server: {
      host: '127.0.0.1', strictPort: true,
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/server/**'] },
    },
    preview: { host: '127.0.0.1', strictPort: true },
  };
});
