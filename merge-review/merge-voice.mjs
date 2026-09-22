import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const expectedHead = '8f7a7196ae213ff404cf41cd02397424ab76cd97';
const expectedIncoming = '5b3000936ed75a05273f1a892a1526d7375f1911';
const helperFiles = ['merge-review/README.md', 'merge-review/merge-voice.mjs'];
const sourcePaths = ['.', ...helperFiles.map(file => ':(exclude)' + file)];
const files = [
  ".env.example",
  "README.md",
  "src/style.css",
  "docs/voice-asr.md",
  "src/voice/session.js",
  "server/mcp/protocol.js",
  "package.json",
  "server/start.js",
  "vite.config.js",
  "src/voice/index.js"
];
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Git command failed: ' + args.join(' '));
  return result.stdout.trim();
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('命令失败，已停止，未自动提交：' + [command, ...args].join(' '));
}
try {
  if (git('branch', '--show-current') !== 'codex/vedio') throw new Error('请切换到 codex/vedio；脚本不会自动切换分支。');
  if (git('rev-parse', 'codex/voice') !== expectedIncoming) {
    throw new Error('待合入分支提交已变化，请重新核查解决方案，禁止套用旧结果。');
  }
  git('merge-base', '--is-ancestor', expectedHead, 'HEAD');
  const changedSources = git('diff', '--name-only', expectedHead, 'HEAD', '--', ...sourcePaths);
  if (changedSources) {
    throw new Error('当前分支的业务代码或解决文件已变化，请重新核查：\n' + changedSources);
  }
  const inProgress = spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root, encoding: 'utf8' });
  if (inProgress.status === 0) throw new Error('已有合并正在进行；为保护手工修改，脚本不会覆盖，请先处理该次合并。');
  const status = git('status', '--porcelain=v1', '--untracked-files=normal', '--', ...sourcePaths);
  const changes = status.split('\n').filter(Boolean);
  if (changes.length) throw new Error('工作区存在其他修改，请先保留/提交这些修改再执行。');
  const content = new Map(files.map(file => [file, readFileSync(new URL('./resolved/' + file, import.meta.url), 'utf8')]));
  for (const [file, text] of content) {
    if (/^([<=>])\1{6}/m.test(text)) throw new Error('解决文件仍含冲突标记：' + file);
  }
  console.log('预检查通过：codex/voice → codex/vedio，保留 TTS + ASR + Agent/MCP。');
  if (!process.argv.includes('--apply')) {
    console.log('当前仅预检查，未修改源代码或 Git 历史。');
    console.log('执行 node merge-review/merge-voice.mjs --apply 开始合并、解决冲突、测试并创建本地合并提交；不推送远程。');
    process.exit(0);
  }
  const merge = spawnSync('git', ['merge', '--no-commit', '--no-ff', 'codex/voice'], { cwd: root, stdio: 'inherit' });
  if (![0, 1].includes(merge.status) || git('rev-parse', 'MERGE_HEAD') !== expectedIncoming) {
    throw new Error('Git 未进入预期的合并状态，已停止。');
  }
  const conflicts = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
  if (conflicts.some(file => !files.includes(file))) throw new Error('出现未预演的冲突，已停止，不覆盖这些文件。');
  // All paths are an explicit allowlist; .env is not among them.
  for (const [file, text] of content) writeFileSync(path.join(root, file), text);
  run('npm', ['test']);
  run('npm', ['run', 'build']);
  run('git', ['diff', '--check']);
  run('git', ['add', '--', ...files, ...helperFiles]);
  if (git('diff', '--name-only', '--diff-filter=U')) throw new Error('仍有未解决冲突，未提交。');
  run('git', ['commit', '-m', 'Merge codex/voice into codex/vedio preserving TTS and Agent/MCP']);
  console.log('本地合并完成：' + git('rev-parse', '--short', 'HEAD') + '；未推送远程。已包含合并辅助脚本和说明更新。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
