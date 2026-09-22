# 双分支合并预演（2026-09-22）

状态：**已完成离线冲突解决和验证；尚未改变当前分支或创建合并提交。**
正式 Git 合并受自动审批服务 503/超时/连接中断阻塞。此目录保存可供检查的准备结果。

- 当前分支：codex/vedio，复核提交 8f7a7196ae213ff404cf41cd02397424ab76cd97。该提交相对原预演提交 9ceab5d 仅新增 merge-review/ 辅助文件，业务代码未变化。
- 待合入：codex/voice，提交 5b3000936ed75a05273f1a892a1526d7375f1911。
- 共同基线：d658346b68b4ee58787f515a7e6d95c61a34bc35。
- 离线副本：/tmp/blue-merge-review.c1iPfL（未复制 .env，未调用真实模型、TTS 或远程 MCP）。
- 验证：69 项测试中 67 通过、0 失败、2 项端口测试因沙箱限制跳过；Vite 构建及语法检查通过。

## 冲突处理

保留 TTS 配置、试听命令、网页播放控件、PCM 协议修复及播放时暂停麦克风的行为。
保留 Agent/MCP 配置、演示/诊断命令、后端 API、最终识别结果交给 Agent、统一逐字字幕、麦克风不可用时的文字输入。

服务端和 Vite 同时挂载语音 BFF 与 Agent Platform。字幕统一交给 Conversation/SubtitleWriter，避免两套逻辑互相覆盖；保留 tts:start/tts:end 的暂停和恢复逻辑。
MCP 协议版本这一处采用 codex/voice 所用的 2025-11-25，业务 Registry、Dispatcher 与 Client 全部保留。

10 个冲突解决文件位于 resolved/：
- .env.example
- README.md
- src/style.css
- docs/voice-asr.md
- src/voice/session.js
- server/mcp/protocol.js
- package.json
- server/start.js
- vite.config.js
- src/voice/index.js

index.html 及新增 Agent/Conversation 文件由 Git 正常自动合并，不使用整分支 ours/theirs 覆盖。

## 本机执行

先阅读 resolved/ 中的文件。默认命令只预检查，不修改源代码或 Git 历史：

```bash
node merge-review/merge-voice.mjs
```

确认后，在当前项目目录执行：

```bash
node merge-review/merge-voice.mjs --apply
```

脚本要求待合入分支仍停在上述提交；当前分支必须是复核提交本身或其后代，且业务代码及 resolved/ 解决文件与复核提交一致。仅本说明和执行脚本的修改不会阻断检查；其他工作区修改仍会停止合并。
执行内容：开始本地 merge --no-commit、应用已验证的 10 份解决文件、运行测试与构建、暂存已解决路径及辅助脚本和说明更新、创建本地合并提交。**不修改 .env，不推送远程。** 辅助目录已经由 8f7a719 提交纳入版本控制。
任一步失败立即停止，不重置或丢弃文件，便于继续人工处理。
