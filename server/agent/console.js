import { createInterface } from 'node:readline';

export async function runConsole({ agent, input = process.stdin, output = process.stdout, initial = '', once = false }) {
  const abort = new AbortController();
  const run = async text => {
    try {
      const result = await agent.run(text, { signal: abort.signal });
      output.write(`\n${result.output || '模型未返回文字。'}\n\n`);
    } catch (error) { output.write(`\n执行未完成：${error.message}\n可以输入下一条指令，或输入 /exit 退出。\n`); }
  };
  if (once) { if (initial) await run(initial); return; }
  const lines = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  const iterator = lines[Symbol.asyncIterator]();
  let closed = false;
  lines.once('close', () => { closed = true; });
  const prompt = () => { if (!closed) lines.prompt(); };
  lines.on('SIGINT', () => { abort.abort(); lines.close(); });
  output.write('Agent + MCP 已就绪。连续输入指令；/exit 或 Ctrl+C 退出。\n');
  try {
    if (initial) await run(initial);
    lines.setPrompt('你 > '); prompt();
    for await (const line of iterator) {
      const text = line.trim();
      if (text === '/exit' || text === '/quit') break;
      if (text) await run(text);
      if (!abort.signal.aborted) prompt();
    }
  } finally { lines.close(); }
}
