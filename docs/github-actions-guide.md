# GitHub Actions 语法入门

GitHub Actions 用 YAML 描述自动化流程。把工作流文件放在仓库的 `.github/workflows/` 目录下，GitHub 会根据触发条件创建运行实例。最重要的层级只有三层：

```text
workflow（工作流）
└── jobs（任务，可并行或按依赖执行）
    └── steps（步骤，按顺序执行）
```

## 1. 第一个可运行的工作流

在项目中创建 `.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  test-and-build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build application
        run: npm run build
```

这个例子会在 `main` 分支收到推送或 Pull Request 时运行，也可以在 Actions 页面手动运行。对当前项目来说，`npm ci`、`npm test` 和 `npm run build` 就是最基本的持续集成检查。

## 2. 顶层语法

### `name`

工作流在 Actions 页面显示的名称：

```yaml
name: Frontend CI
```

### `on`：什么时候运行

`on` 定义触发事件。常用事件如下：

```yaml
on:
  push:                         # 推送代码
    branches: [main, develop]
    paths:
      - "src/**"
      - "package-lock.json"
  pull_request:                 # Pull Request 发生变化
    branches: [main]
  workflow_dispatch:            # Actions 页面提供“Run workflow”按钮
  schedule:                     # 定时触发，时间使用 UTC
    - cron: "30 1 * * 1-5"
```

常用筛选项是 `branches`、`branches-ignore`、`paths`、`paths-ignore`、`tags` 和 `tags-ignore`。例如，只在文档变化时运行：

```yaml
on:
  push:
    paths:
      - "docs/**"
      - "README.md"
```

### `permissions`：令牌权限

工作流会使用 `GITHUB_TOKEN` 访问 GitHub API。建议在顶层默认只读，需要写入时再对具体任务开放：

```yaml
permissions:
  contents: read

jobs:
  release:
    permissions:
      contents: write
```

常见权限包括 `contents`、`issues`、`pull-requests`、`actions` 和 `packages`，值通常是 `read`、`write` 或 `none`。

## 3. `jobs`：定义任务

每个任务有一个自定义 ID。ID 只能用于 YAML 引用，不会直接显示成任务名称：

```yaml
jobs:
  lint:
    name: Lint source code
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint
```

常用字段：

| 字段 | 作用 |
| --- | --- |
| `name` | Actions 页面显示的任务名称 |
| `runs-on` | 运行环境，例如 `ubuntu-latest`、`windows-latest`、`macos-latest` |
| `needs` | 等待其他任务成功后再运行 |
| `if` | 按条件决定是否运行 |
| `env` | 任务级环境变量 |
| `defaults.run` | 统一设置 shell 或工作目录 |
| `strategy.matrix` | 为多组参数生成多个任务实例 |
| `timeout-minutes` | 超时后自动取消，避免任务无限运行 |
| `concurrency` | 取消同一分支上过期的运行 |

任务默认可以并行。使用 `needs` 建立依赖关系：

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh
```

如果 `test` 失败，`deploy` 默认会被跳过。即使前置任务失败也要执行清理时，可以写 `if: ${{ always() }}`。

## 4. `steps`：定义步骤

一个步骤使用 Action 或执行 shell 命令，二者选其一：

```yaml
steps:
  - name: Use an existing action
    uses: actions/checkout@v4

  - name: Run a command
    run: npm test
    working-directory: ./frontend
    env:
      NODE_ENV: test
```

Action 的参数放在 `with` 下，命令的环境变量放在 `env` 下：

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    registry-url: https://registry.npmjs.org
```

步骤可以通过 `id` 暴露输出：

```yaml
- id: version
  run: echo "value=1.2.3" >> "$GITHUB_OUTPUT"

- run: echo "version is ${{ steps.version.outputs.value }}"
```

几个常用的 Runner 文件：

```bash
echo "API_URL=https://example.com" >> "$GITHUB_ENV"  # 后续步骤可读取
echo "$HOME/.local/bin" >> "$GITHUB_PATH"            # 加入后续步骤 PATH
echo "### Build result" >> "$GITHUB_STEP_SUMMARY"    # 写入任务摘要
```

`GITHUB_ENV` 只影响后续步骤，不会改变当前步骤的 shell 环境。跨任务传值需要使用 Job Outputs，见下文。

## 5. 表达式与上下文

表达式通常写在 `${{ }}` 中：

```yaml
- name: Print branch
  run: echo "branch=${{ github.ref_name }}"

- name: Run only on main
  if: ${{ github.ref == 'refs/heads/main' }}
  run: ./deploy.sh
```

`if` 字段可以省略 `${{ }}`，下面两种写法等价：

```yaml
if: github.ref == 'refs/heads/main'
if: ${{ github.ref == 'refs/heads/main' }}
```

常用上下文：

| 上下文 | 示例 | 内容 |
| --- | --- | --- |
| `github` | `github.sha`、`github.actor`、`github.event_name` | 事件和仓库信息 |
| `env` | `env.NODE_ENV` | 工作流、任务或步骤的环境变量 |
| `vars` | `vars.DEPLOY_ENV` | Repository/Environment Variables |
| `secrets` | `secrets.NPM_TOKEN` | 加密密钥 |
| `steps` | `steps.meta.outputs.tag` | 当前任务之前步骤的输出 |
| `needs` | `needs.test.result` | 依赖任务的结果和输出 |
| `matrix` | `matrix.node` | 当前矩阵实例的参数 |
| `runner` | `runner.os` | Runner 的系统信息 |
| `inputs` | `inputs.environment` | 手动或可复用工作流的输入 |

常用函数：

```yaml
if: ${{ success() }}             # 前置步骤全部成功
if: ${{ failure() }}             # 之前有步骤失败
if: ${{ always() }}              # 无论前面结果如何
if: ${{ cancelled() }}           # 工作流被取消
if: ${{ startsWith(github.ref, 'refs/tags/') }}
if: ${{ contains(github.event.pull_request.labels.*.name, 'release') }}
```

字符串和 JSON 处理常用 `format()`、`toJSON()`、`fromJSON()`。不要把密钥拼进 URL、命令参数或日志；即使 GitHub 会尝试掩码，也不应主动打印敏感值。

## 6. 环境变量、变量和密钥

普通配置可以用 `env`：

```yaml
env:
  NODE_ENV: test

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      API_MODE: mock
    steps:
      - run: echo "${NODE_ENV} / ${API_MODE}"
```

在仓库的 **Settings → Secrets and variables → Actions** 中分别创建：

- **Variables**：非敏感配置，用 `${{ vars.NAME }}` 读取。
- **Secrets**：令牌、密码等敏感信息，用 `${{ secrets.NAME }}` 读取。

```yaml
- name: Publish package
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
  run: npm publish
```

来自 Fork 的 Pull Request 通常拿不到仓库 Secrets。不要为了让不受信任的代码读取密钥而改用 `pull_request_target`；该事件会在目标仓库上下文中运行，配置不当可能执行恶意代码。

## 7. Matrix：一次测试多组环境

`matrix` 会根据参数组合展开多个任务：

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest]
        node: [20, 22]
        exclude:
          - os: macos-latest
            node: 20
        include:
          - os: ubuntu-latest
            node: 22
            experimental: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm test
```

上面的配置会生成不同系统和 Node.js 版本的任务。`fail-fast: false` 表示一组失败时不取消其他组；`max-parallel` 可以限制并发数。

## 8. 缓存和构建产物

`actions/setup-node` 已支持 npm 缓存：

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
```

这会根据 `package-lock.json` 生成缓存键。缓存依赖下载内容，不等于保存 `dist`；要在任务之间或运行结束后保存文件，使用 Artifact：

```yaml
- name: Upload build output
  uses: actions/upload-artifact@v4
  with:
    name: blue-dist
    path: dist/
    retention-days: 7
```

另一个任务可以下载：

```yaml
- uses: actions/download-artifact@v4
  with:
    name: blue-dist
    path: dist/
```

## 9. Job Outputs：任务之间传值

步骤输出先写入 `$GITHUB_OUTPUT`，再从任务的 `outputs` 暴露：

```yaml
jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      tag: ${{ steps.meta.outputs.tag }}
    steps:
      - id: meta
        run: echo "tag=v$(date +%Y%m%d)" >> "$GITHUB_OUTPUT"

  release:
    needs: prepare
    runs-on: ubuntu-latest
    steps:
      - run: echo "release tag: ${{ needs.prepare.outputs.tag }}"
```

## 10. 手动运行和可复用工作流

### 手动输入

给 `workflow_dispatch` 定义输入：

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Deploy environment
        required: true
        type: choice
        options: [staging, production]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploy to ${{ inputs.environment }}"
```

### 可复用工作流

被调用的工作流使用 `workflow_call`：

```yaml
# .github/workflows/reusable-build.yml
on:
  workflow_call:
    inputs:
      node-version:
        required: true
        type: string

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
      - run: npm ci && npm run build
```

调用方在 `jobs` 层使用 `uses`：

```yaml
jobs:
  build:
    uses: ./.github/workflows/reusable-build.yml
    with:
      node-version: "22"
```

可复用工作流的 `uses` 是任务级语法，不能和同一个任务的 `runs-on`、`steps` 混用。

## 11. 让同一分支只保留最新运行

前端项目经常会连续推送多次，可以取消过期运行：

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

部署工作流通常不应随意取消正在进行的发布；可以只对 Pull Request 的检查启用这一设置。

## 12. 当前项目的推荐 CI 文件

如果只想为 BLUE 增加基础检查，可以直接使用下面的版本：

```yaml
name: BLUE CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: blue-ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: Test and build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@v4
        if: ${{ success() }}
        with:
          name: blue-dist
          path: dist/
```

## 13. 常见问题

1. **缩进错误**：YAML 只使用空格，不要使用 Tab；同一级字段必须对齐。
2. **忘记安装依赖**：`npm test` 前使用 `npm ci`，它会按照 `package-lock.json` 安装干净环境。
3. **把 `${{ }}` 和 shell 变量混淆**：`${{ github.sha }}` 在工作流解析阶段替换；`$HOME`、`$NODE_ENV` 由 Runner 的 shell 读取。
4. **服务进程阻塞任务**：`npm start` 会持续运行服务器，不适合作为普通 CI 的最后一步；如果要做端到端检查，需要在后台启动并设置健康检查和清理步骤。
5. **权限过大**：默认使用 `contents: read`，发布、创建 Release 等操作再单独申请写权限。
6. **密钥不可用**：Fork 的 Pull Request 通常没有仓库 Secrets；检查事件类型和仓库设置，不要把密钥写进 YAML。
7. **Action 版本不稳定**：生产工作流至少固定到主版本（如 `@v4`），对高要求项目可以固定到完整 commit SHA，并定期升级。

排查失败运行时，先看失败步骤的完整日志，再检查事件触发条件、Runner 系统、权限、Secrets 和工作目录。GitHub Actions 的表达式文档与各个 Action 的 README 是最准确的字段来源。
