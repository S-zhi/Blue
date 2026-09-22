const DEFAULT_BASE_URL = 'https://api.adjez.sbs/v1';
const DEFAULT_MODEL = 'gpt-5.6-terra';

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('AGENT_MODEL_BASE_URL must use HTTPS outside localhost');
  }
  return url.toString().replace(/\/$/, '');
}

export function getAgentConfig(env = process.env) {
  const apiStyle = String(env.AGENT_MODEL_API || 'responses').trim();
  if (!['responses', 'chat-completions'].includes(apiStyle)) throw new Error('AGENT_MODEL_API must be responses or chat-completions');
  return {
    apiKey: String(env.ASXS_CODE_API_KEY || '').trim(),
    baseUrl: normalizeBaseUrl(env.AGENT_MODEL_BASE_URL),
    model: String(env.AGENT_MODEL || DEFAULT_MODEL).trim(),
    apiStyle,
    timeoutMs: Math.min(120000, Math.max(5000, Number(env.AGENT_MODEL_TIMEOUT_MS || 60000))),
    maxSteps: Math.min(16, Math.max(1, Number(env.AGENT_MAX_STEPS || 8))),
    maxConcurrent: Math.min(8, Math.max(1, Number(env.AGENT_MAX_CONCURRENT || 2))),
    mcpUrl: String(env.MCP_SERVER_URL || '').trim(),
    mcpToken: String(env.MCP_CLIENT_TOKEN || '').trim(),
    demoSecret: String(env.MCP_DEMO_SECRET || 'demo-secret-not-for-production'),
  };
}
