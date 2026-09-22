import { fileURLToPath } from 'node:url';
import { getAgentConfig } from './config.js';
import { OpenAICompatibleProvider } from './provider.js';

try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = getAgentConfig();
if (!config.apiKey) { console.error('ASXS_CODE_API_KEY 未配置。'); process.exitCode = 1; }
else {
  const probeTool = { type: 'function', function: { name: 'diagnostic_echo', description: 'Echo a diagnostic message.', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } } };
  for (const apiStyle of ['responses', 'chat-completions']) {
    const provider = new OpenAICompatibleProvider({ ...config, apiStyle, timeoutMs: 20000 });
    for (const withTools of [false, true]) {
      const label = `${apiStyle} / ${withTools ? '工具调用' : '普通回答'}`;
      try {
        const message = await provider.complete({
          messages: [{ role: 'user', content: withTools ? 'Call diagnostic_echo with message OK. Do not answer directly.' : 'Reply only OK.' }],
          tools: withTools ? [probeTool] : [],
        });
        const valid = withTools ? message.tool_calls?.some(call => call.function?.name === 'diagnostic_echo') : Boolean(message.content);
        console.log(`${label}: ${valid ? '通过' : '未返回预期内容'}`);
        if (!valid) process.exitCode = 1;
      } catch (error) {
        console.error(`${label}: ${provider.redact(error.message)}`);
        process.exitCode = 1;
      }
    }
  }
}
