const MAX_BODY = 256 * 1024;

export function createMcpHttpMiddleware(dispatch, { token = '' } = {}) {
  return async function mcpMiddleware(request, response, next) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/mcp') return next();
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); return response.end(); }
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(JSON.stringify({ error: 'Unauthorized MCP client' }));
    }
    try {
      const body = await readJson(request, MAX_BODY);
      const result = await dispatch(body, { request });
      if (result === null) { response.writeHead(202); return response.end(); }
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(result));
    } catch (error) {
      const status = error.code === 'BODY_TOO_LARGE' ? 413 : 400;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: status === 413 ? 'Request too large' : 'Invalid JSON request' }));
    }
  };
}

export async function readJson(request, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) { const error = new Error('Body too large'); error.code = 'BODY_TOO_LARGE'; throw error; }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
