import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { attachVoiceServer } from './voice.js';
import { getConfig } from './config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
try { process.loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const dist = path.join(root, 'dist');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
let bridge;
const server = createServer((request, response) => {
  bridge.middleware(request, response, async () => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith('/api/') || pathname.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(404); return response.end();
      }
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(dist, relative);
      if (!file.startsWith(dist + path.sep) || !(await stat(file)).isFile()) { response.writeHead(404); return response.end(); }
      const body = await readFile(file);
      response.setHeader('Content-Type', `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
});
bridge = attachVoiceServer(server, getConfig());
const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => console.log(`BLUE voice BFF listening on http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { bridge.close(); server.close(); });
