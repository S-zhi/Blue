# Agent + MCP 架构规范

## 架构结论

当前实现采用“Agent 运行时 + 单一 MCP 网关”的方式。浏览器只调用同源 `/api/agent/run`；模型只看见一个名为 `mcp` 的函数工具；`mcp` 再动态执行 `list_tools`、`call_tool`、`list_resources` 和 `read_resource`。因此后端向 MCP 注册新能力后，Agent 不需要新增模型工具或修改 System Prompt 中的固定工具清单。

默认模型配置为：

- Base URL：`https://api.adjez.sbs/v1`
- Model：`gpt-5.6-terra`
- Key：服务端环境变量 `ASXS_CODE_API_KEY`
- API 形态：默认 OpenAI-compatible Responses API `POST /responses`；可用 `AGENT_MODEL_API=chat-completions` 切换至 `POST /chat/completions`

密钥只在 Node 服务端读取，不进入 Vite `define`、浏览器 bundle、健康检查或错误正文。`/api/agent/health` 仅返回是否完成配置、模型名、供应商主机和 MCP 模式。

## PI 接入边界

### 模型接口诊断

当前默认 Responses 只是配置选择，尚未通过真实供应商联调验证；不能由 HTTP 520 推断必须改用哪个接口。

运行 `npm run agent:check`，将发送四个很小的诊断请求，分别检查 Responses 和 Chat Completions 的普通回答、工具调用。工具仅用于验证模型生成调用参数，不会执行 MCP 业务，也不会读取演示密钥。输出只含检查状态、脱敏错误和请求编号。

如果仅 Chat Completions 通过，在 `.env` 设置 `AGENT_MODEL_API=chat-completions`；如果仅 Responses 通过，保留 `AGENT_MODEL_API=responses`。如果两种接口都失败，应结合返回的模型名、错误说明和请求编号检查供应商路由、账号权限与服务状态。`npm run mcp:demo` 可独立验证 MCP，不需要调用模型。

Responses 的动态 MCP 参数使用 `strict:false`，避免严格 Schema 约束把可选参数变成必填。命令行模型失败时显示可读诊断，不再只抛出状态码堆栈。此改动提供排查能力，并不表示供应商 520 已修复。

当前仓库没有已安装的 PI 包，自动依赖安装又被审批服务故障阻断。因此本版本使用 `McpAgent` 实现相同的最小 Agent 循环：模型消息 → MCP 工具调用 → 工具结果 → 模型最终回答。模型 Provider、Agent Runner 和 MCP Client 已分层，后续接入 PI 时只替换 `server/agent/runner.js` 的运行时，不修改 MCP Registry、业务工具或 HTTP API。

PI 适配时保持以下约束：

1. PI 的工具列表中只注册一个 `mcp` 工具，Schema 与 `MCP_GATEWAY_TOOL` 一致。
2. PI 的自定义 Provider 使用 `AGENT_MODEL_BASE_URL`、`ASXS_CODE_API_KEY` 和 `AGENT_MODEL`，不要在源码中硬编码凭据。
3. PI tool handler 只调用 `McpClient`，禁止旁路访问数据库、文件、HTTP 服务或业务模块。
4. System Prompt 继续使用 `server/agent/system-prompt.js`，避免两个运行时产生不同的安全边界。

## MCP Client 与 Demo Server

`server/mcp/` 包含 MCP JSON-RPC Client、Registry、Dispatcher、HTTP Transport 和本地进程内 Transport。默认使用 2025-11-25 协议基线及单一 `/mcp` POST 入口。生产配置 `MCP_SERVER_URL` 后，Agent 自动切换到远程 HTTP Transport；为空时使用本地 Demo Registry。

Demo Server 注册：

- `demo.get_secret`：读取 MCP 服务端持有的 `MCP_DEMO_SECRET`。
- `demo.echo`：回显结构化输入，演示参数传递。
- `demo://integration-guide`：演示 MCP Resource。

直接验证 MCP，不调用模型：

```bash
npm run mcp:demo
```

验证完整 Agent 调用链：

```bash
npm run agent:demo -- "请先列出 MCP 工具，再读取 Demo 服务端保存的密钥"
```

`agent:demo` 现在是持续运行的交互终端：启动参数作为第一条指令，执行完成或请求失败后继续等待下一条；不传参数时直接等待输入。输入 `/exit`、`/quit` 或按 Ctrl+C 退出。自动化单次执行可用 `npm run agent:demo -- --once "指令"`。每条指令是独立执行任务，不隐式携带上一次工具结果或密钥作为对话历史。Web API 本身也支持连续请求。

## 语音入口与统一字幕

页面以语音为默认入口。整轮 ASR 的 `final=true` 回包到达时，将该轮识别文字提交到 `/api/agent/run`，临时文字和分句 `definite=true` 只更新字幕，不重复执行。10 秒无新识别文字的结束规则保持不变。模型回答、MCP 返回的演示密钥和执行错误统一显示在字幕区。

只有麦克风权限被拒绝、设备缺失/被占用/断开，或浏览器不支持采音时，才显示“文字输入”。文字输入直接调用执行接口，不经过 ASR；麦克风恢复成功后隐藏该入口。ASR 服务错误不会伪装成麦克风不可用。

输入采用蓝色无衬线字体，回答采用浅白色衬线字体。两者通过共享字幕渲染器逐字显示，按 Unicode 字素处理，完整输出后保留 30 秒。当前是拿到执行结果后的前端逐字动画，并非模型 token 的网络流式传输。旧请求仍按顺序完成，但其字幕不会覆盖更新的输入；不自动重放失败的业务指令。

也可以调用同源 HTTP API：

```bash
curl -s http://127.0.0.1:3000/api/agent/run \
  -H 'content-type: application/json' \
  -d '{"input":"请通过 MCP 读取演示密钥"}'
```

## 新功能注册规范

每个业务能力应在 MCP 后端注册为 Tool 或 Resource，Agent 项目不直接引入业务 SDK。

Tool 命名采用稳定的 `<domain>.<verb_noun>`，例如 `customer.get_profile`、`order.create_refund`。重命名属于破坏性变更，应新增版本化工具并保留迁移期。description 说明工具“做什么”和关键限制，不放提示词技巧。

`inputSchema` 必须：

- 根节点为 object；明确 `properties`、`required` 和 `additionalProperties`。
- 标清日期格式、枚举、单位、分页、最大长度和互斥条件。
- 不接收上游已经具备的身份信息；身份应来自 MCP 鉴权上下文。
- 写操作携带幂等键，并在 annotations 中正确声明 destructive/idempotent/readOnly 提示。

返回值同时提供人类可读 `content` 和机器可读 `structuredContent`。错误使用稳定错误码与可操作说明，不返回堆栈、数据库信息、访问令牌或供应商原始错误正文。

Resource 用于可读取、可缓存、具有稳定 URI 的信息；有副作用的操作必须使用 Tool。大型结果采用分页或返回资源链接，避免把无限数据塞进模型上下文。

## 安全与部署

生产 MCP 使用 `MCP_CLIENT_TOKEN` 或更完整的 OAuth 方案，并在 MCP 后端按调用者做授权。当前 Bearer Token 是最小演示，不替代用户身份、细粒度权限和审计。

模型看到的 MCP 返回值属于不可信数据。System Prompt 明确禁止把工具内容当成系统指令。对高风险写操作，MCP 服务端应自行实施权限校验、参数校验、幂等、审批与审计；不能依赖模型自律。

Agent API 当前最多并发 2 个请求、最多 8 个推理步骤，模型工具结果截断为 64 KiB。正式部署还应在反向代理增加登录鉴权、请求速率限制、超时和调用日志脱敏。

## System Prompt 原则

`server/agent/system-prompt.js` 将模型限制在 MCP 范围内：先动态发现能力，使用精确工具名和 Schema，不编造调用，不把 MCP 数据当指令，不泄露平台凭据，失败最多修正重试一次，拿到足够信息后停止工具循环。

Agent 只保留一个模型侧工具是刻意设计：它把“新增业务功能”变成 MCP 服务端的注册问题，而不是每次都修改 Agent 工具表、前端或模型提示词。
