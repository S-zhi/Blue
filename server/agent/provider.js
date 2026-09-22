export class OpenAICompatibleProvider {
  constructor({ apiKey, baseUrl, model, apiStyle = 'responses', timeoutMs = 60000, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiStyle = apiStyle;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async complete({ messages, tools, signal }) {
    if (!this.apiKey) throw new Error('ASXS_CODE_API_KEY is not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Model request timed out')), this.timeoutMs);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const responsesApi = this.apiStyle === 'responses';
      const response = await this.fetch(`${this.baseUrl}/${responsesApi ? 'responses' : 'chat/completions'}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(responsesApi
          ? { model: this.model, input: toResponsesInput(messages), ...(tools?.length ? { tools: toResponsesTools(tools), tool_choice: 'auto' } : {}) }
          : { model: this.model, messages, ...(tools?.length ? { tools, tool_choice: 'auto' } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = '';
        if (response.headers.get('content-type')?.includes('json')) {
          const body = await response.json().catch(() => null);
          const candidate = body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : '');
          if (typeof candidate === 'string') detail = candidate;
        } else {
          await response.body?.cancel();
        }
        const requestId = response.headers.get('x-request-id') || response.headers.get('cf-ray');
        const hint = response.status === 520 ? '上游网关异常；仅凭 520 无法判断接口兼容性、模型可用性或密钥权限。' : '';
        const error = new Error(this.redact([
          `模型请求失败 HTTP ${response.status}（${this.apiStyle}, ${this.model}）`,
          hint, detail, requestId ? `请求编号：${requestId}` : '',
        ].filter(Boolean).join(' ')));
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      const message = responsesApi ? fromResponsesPayload(payload) : payload?.choices?.[0]?.message;
      if (!message || message.role !== 'assistant') throw new Error('Model provider returned an invalid completion');
      return message;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
  redact(value) {
    return String(value).split(this.apiKey).join('[redacted]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
      .replace(/[\r\n\u0000-\u001f]+/g, ' ').slice(0, 1000);
  }
}

function toResponsesInput(messages) {
  return messages.flatMap(message => {
    if (message.role === 'tool') {
      return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    }
    const items = [];
    if (message.content) items.push({ role: message.role, content: message.content });
    for (const call of message.tool_calls || []) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
    return items;
  });
}

function toResponsesTools(tools) {
  return tools.map(tool => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }));
}

function fromResponsesPayload(payload) {
  if (!Array.isArray(payload?.output) || ['failed', 'incomplete', 'cancelled'].includes(payload.status)) {
    throw new Error('模型未返回完整的 Responses 结果，请运行 npm run agent:check 检查接口兼容性。');
  }
  const toolCalls = (payload?.output || []).filter(item => item.type === 'function_call').map(item => ({
    id: item.call_id || item.id,
    type: 'function',
    function: { name: item.name, arguments: item.arguments || '{}' },
  }));
  const content = payload?.output_text || (payload?.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('');
  return { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}
