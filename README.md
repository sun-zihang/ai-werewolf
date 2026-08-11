# AI 狼人杀网页版（全 AI 自动对局 · 支持 1–4 名真人加入 · 观战版）

在本地运行的 AI 狼人杀：从 AI 库挑选 2–12 个 AI（可来自 12 家主流大模型厂商，也可用内置本地规则引擎），自动分配狼人/村民/预言家/女巫/猎人/白痴身份，AI 全程自主发言、行动、投票，你在旁边实时观战并查看结算报告。

- 浅色纸感极简界面，无渐变 / 无玻璃拟态
- 完整规则状态机：夜间（狼刀 → 预言家查验 → 女巫救/毒）→ 白天（公布死讯 → 遗言 → 发言 → 投票 → 出局/白痴翻牌/猎人开枪）→ 胜负判定
- 三档人数模式：简易 2–4 人、标准 5–8 人、复杂 9–12 人
- 思考强度四档：低 / 中 / 高 / 特高，映射到各厂商原生思考参数
- 超时熔断、非法动作拦截重试、降级兜底；API 密钥 AES-256-GCM 加密存储

## 快速开始

需要 Node.js ≥ 22.5（内置 node:sqlite；建议 24 LTS）。

```bash
# 1. 安装依赖（根、server、web）
npm run setup

# 2. 启动开发模式（后端 3001 + 前端 5173，前端代理 /api）
npm run dev
```

打开 http://localhost:5173 即可使用。

生产模式：

```bash
npm run build   # 构建前端到 dist（仓库根目录）
npm run start   # 后端 3001 直接托管前端
# 打开 http://localhost:3001
```

首次启动会在 `data/` 生成 SQLite 数据库（`app.db`）和加密主密钥（`.masterkey`，请勿泄露/删除）。

## 接入真实 AI

1. 打开「AI 库」→「新建 AI」。
2. 选择厂商（OpenAI / Claude / Gemini / DeepSeek / 通义千问 / Kimi / 智谱 GLM / MiniMax / 豆包 / 腾讯混元 / 百度文心 / 讯飞星火），填写模型 ID 与 API 密钥（密钥仅存在本机并加密，绝不回传前端）。
3. 设置思考强度与角色偏好，保存后点「测连」验证。
4. 没有密钥也能玩：厂商选「本地规则引擎」即可。

各厂商默认模型与 API 地址已在服务端预置，可在表单「自定义 API 地址」处覆盖（兼容 OpenAI 协议的任意网关都行）。

> 思考强度说明：低=极简、中=均衡、高=深入、特高=深度推演。OpenAI o 系走 `reasoning_effort`，Gemini 走 `thinkingConfig.thinkingBudget`，通义 Qwen3 走 `enable_thinking`，其余厂商用提示词指令 + 输出 token 预算兜底。

## 玩法

- **AI 库**：卡片式管理，支持新建 / 编辑 / 复制 / 删除 / 测连 / JSON 与 CSV 批量导入导出 / 按名称·厂商·强度筛选 / 查看详情与历史对局。
- **新建对局**：多选 AI，自动或手动定档，随机 / 强度匹配 / 按偏好分配角色，支持全局思考强度覆盖与预设阵容保存。
- **观战**：实时座位盘 + 事件时间线（SSE 推送，隧道下自动切换轮询兜底），上帝视角可看所有身份与夜间行动；对局结束显示结算报告（胜方、MVP、发言数、token 用量）。
- **真人模式**：新建对局时可选「真人玩家数量 0–4」。真人角色随机分配（开局后才知道阵营），房主生成邀请链接发给朋友，多设备打开即可上桌；轮到真人时引擎挂起等待，真人提交刀人/查验/救人/下毒/发言/投票/遗言，超时自动托管不卡局。
- **历史**：全部对局记录，点击可回放事件时间线。

## 规则约定（标准变体）

- 猎人被刀或被票出局可开枪，被毒不能开枪
- 白痴被票出局翻牌免死，此后失去投票权但可继续发言；白痴夜晚被刀正常死亡
- 女巫解药/毒药各一瓶，首夜可自救，可同一夜救+毒；狼刀与毒同目标时只记一次死亡
- 平票无人出局（平安日）；狼人数量 ≥ 好人存活数时狼人获胜，狼人全灭时好人获胜


## GitHub Pages 部署

> ⚠️ GitHub Pages 只能托管静态文件，无法运行 Node/SQLite 后端。因此 Pages 上部署的是**前端界面**，游戏引擎仍需在你自己的机器上运行（或把后端部署到任意可访问的服务器）。

线上预览：<https://sun-zihang.github.io/ai-werewolf/>

### 静态界面如何连上后端

- 本地完整使用：直接 `npm run start` 访问 http://localhost:3001（无需 Pages）。
- 在 Pages 上连后端（推荐，免重建）：打开线上站点，点右上角 **⚙ 后端**，填入你自托管的后端地址（如 `http://192.168.x.x:3001` 或 Docker/CloudBase 分配的域名），保存即生效，设置保存在浏览器本地。
- 在 Pages 上联调本机后端（构建期固定）：本机运行 `npm run start`（若需手机/其他机器访问，加 `--host`），然后在仓库 Actions 的「Build web」步骤把 `VITE_API_BASE` 设为你的后端地址（如 `http://192.168.x.x:3001`）后重新构建部署。
- 未配置后端时，Pages 界面会显示「后端未连接」提示，AI 库与对局功能不可用。

### 发布流程（已配置好）

1. 代码推送到 `main`。
2. GitHub Actions 自动执行 `.github/workflows/pages.yml`：安装 web 依赖 → 构建 `dist` → 部署到 GitHub Pages。
3. 手动重新部署：仓库 Actions → Deploy to GitHub Pages → Run workflow。

## 无需隧道的部署（生产推荐）

Cloudflare Tunnel 只是「把本机运行的服务临时暴露到公网」的便捷手段，**不是必须的**。下面四种方式都能拿到固定公网地址，其中**方式零（Cloudflare Pages Functions + D1）不需要任何服务器、不需要开着电脑**，是当前线上使用的方案。

### 方式零：Cloudflare Pages Functions + D1（Serverless，当前线上方案）

前端和后端跑在同一个 Pages 项目里，一个域名搞定：`https://ai-werewolf.pages.dev`（`/api/*` 走 Functions，其余走静态资源）。

它解决的核心矛盾是：**引擎是长跑的 async 状态机，而 Workers 没有常驻内存**。做法不是把引擎改写成显式状态机（代价大、易与玩法逻辑分叉），而是「**回合快照 + 决策日志重放**」：

| 阶段 | 动作 |
| --- | --- |
| 1 | 读 `game_runtime.snapshot`（**回合起点**快照）并 `engine.restore()` |
| 2 | 重放 `game_journal` 里本回合已记录的决策（纯 CPU，不发网络请求），把引擎推回上次中断处 |
| 3 | 继续往前跑，最多做 `budget` 次**真实 LLM 决策**，然后抛让出信号 |
| 4 | 新事件写 `game_events`、新决策写 `game_journal`；**整回合跑完**才推进快照 |

- **谁来驱动**：前端本来就每 2s 轮询一次，这些 GET 接口（`/api/games/:id`、`events-list`、`seats/:token/view`）顺带调用 `stepGame()`。没人看的对局自然停在原地，不烧配额。
- **节奏映射**：`fast → 4` / `normal → 2` / `slow → 1` 次真实决策每轮询，用「每次推进多少」代替原来的 `sleep`。
- **重放成本**：只回溯到当前回合起点，CPU 开销 ∝ 回合内决策数（约 20–30），**不随对局长度增长**。
- **真人玩家**：`humanDecide` 钩子先无条件发 `human_turn` 事件，再依次查决策日志 → `human_inbox` → 超时（`fast 45s / normal 90s / slow 120s`，超时转 AI 托管）→ 否则抛 `PendingHumanSignal` 让出，保持回合起点快照不变。提交的行动按 `(round, idx)` 存收件箱，天然幂等。
- **互斥**：`game_runtime.lock_until`（30s 乐观锁），同一时刻只有一个请求真正推进，多标签页/SSE+轮询并发都安全。

> ⚠️ 改引擎时必须遵守的不变式：**所有 `emit` 必须在每一次重放里无条件发生，只有「日志消费」才允许分支**。否则 `seq` 会错位、事件流撕裂。`npm run test:driver` 就是专门守这条不变式的。

代码位置与验证：

```
worker/env.ts        # Env 绑定 + 精简 D1 类型（不引 @cloudflare/workers-types 全量依赖）
worker/schema.ts     # D1 建表（幂等，每 isolate 一次）
worker/webcrypto.ts  # Web Crypto AES-256-GCM，密文格式与 Node 版逐字节兼容
worker/driver.ts     # 无状态驱动核心：stepGame / advance / buildEngine / finalizeGame
worker/games.ts      # 建局 / 开局 / 状态 / 事件 / 战报 / 真人座位
worker/profiles.ts   # AI 档案 / 预设 / provider
worker/turnstile.ts  # Turnstile 服务端校验（与 server/src/turnstile.ts 同逻辑）
functions/api/[[route]].ts  # Pages Functions 入口：原生 Request/Response 手写路由（零依赖）
server/lib/          # engine/ai/types 的编译产物，Node 服务与 Workers 共用同一份真相源
```

```bash
npm run build:lib          # 把 engine/ai/types 编译到 server/lib（Workers 侧 import 真实 .js）
npm run typecheck:functions # 类型检查 functions/ + worker/
npm run test:driver        # 用 node:sqlite 模拟 D1，本机跑完整对局，逐条断言 seq 连续/无重复/无回退
BUDGET=1 npm run test:driver # 把重放次数拉到最大再压一遍
```

`server/tsconfig.lib.json` 里有两处**故意的**设置，别"顺手修好"：

- `"types": []` —— 不引 `@types/node`。这样 `engine/` 和 `ai/` 里一旦出现 `node:*` / `process` / `Buffer`，编译就会当场失败。这是保护 Workers 侧可复用性的静态护栏，也让 `build:lib` 不再依赖 `server/node_modules`。
- `"lib": ["ES2023", "WebWorker"]` —— `WebWorker` 恰好等于 Workers 的全局面（`fetch` / `AbortController` / `setTimeout` / `ReadableStream` 都在其中），同时排除 `document` / `window` 这类两端都没有的东西。用 `DOM` 会放进不存在的 API，用纯 `ES2023` 则连 `fetch` 都找不到。

`npm run build:lib` 走的是 `scripts/build-lib.mjs` 而不是直接调 `tsc`，因为 Pages 构建容器可能带着 `NODE_ENV=production` 执行 `npm install`，从而跳过 devDependencies 里的 typescript。该脚本会区分两类失败：**找不到 tsc** → 警告并回落到仓库中已提交的 `server/lib`；**tsc 报类型错误** → 硬失败让部署红掉（带着旧引擎产物静默上线，比构建失败难查得多）。

云端资源（已配置好，无需重复操作）：

- D1 数据库 `ai-werewolf`，绑定变量名 `DB`（production 与 preview 都绑同一个库）
- Pages 环境变量：`AWW_MASTER_KEY`（密钥加密主密钥，secret）、`TURNSTILE_SECRET`（secret）、`TURNSTILE_HOSTNAMES`
- 可选 `AWW_STEP_BUDGET`：覆盖单次推进的真实决策数上限（调试用）
- 部署方式：推 `main` 分支即由 Pages 自动构建（`npm run build` → 根 `dist`），Functions 由 Pages 内置 esbuild 打包

> **注意**：不要在仓库根加 `wrangler.toml`。Pages 的 Git 集成一旦发现它，就会**忽略控制台里配置的绑定与环境变量**，D1 与密钥会全部丢失。绑定用 `scripts/cf-bind-pages.mjs` 或控制台维护。

#### 本地构建注意

`web` 的 build 脚本用 `tsc -p tsconfig.json --noEmit` 而非 `tsc -b`：该 tsconfig 本身就是 `noEmit`，build 模式唯一的产物是 `tsconfig.tsbuildinfo`，而部分 Windows 环境（沙箱 / 杀软 / 编辑器占用）会对这个文件报 `TS5033 EPERM`，白白卡住构建。类型检查效果完全一致——真正的转译由 Vite 的 esbuild 完成，`tsc` 只负责把关类型。

同理，若本地 `vite build` 在清空 `dist` 时报删除超时（某些环境会把 `fs.rmSync` 劫持到"回收站"实现），先把旧目录改名让路即可，不用改 vite 配置：

```bash
mv dist ".dist-stale-$(date +%s)" && npm --prefix web run build
```

`.dist-stale-*/` 已在 `.gitignore` 里，确认构建无误后手动删掉即可。CI 上是全新检出、`dist` 并不存在，不会触发这条路径。

### 方式一：Docker 容器（前端+后端同镜像，单域名）

仓库已提供 `Dockerfile` / `docker-compose.yml`，镜像内后端会直接托管构建好的前端（`dist`，即仓库根 dist），一个域名搞定全部：

```bash
# 构建并启动（端口 3001，数据持久化到名为 awdata 的卷）
docker compose up -d --build
# 打开 http://<你的服务器IP或域名>:3001
```

- 数据落在容器内的 `/data`（compose 已挂卷 `awdata`），升级镜像不丢库。
- 云厂商（腾讯云轻量、阿里云、Railway、Fly.io 等）选「容器服务」上传此 Dockerfile 即可，记得把 `3001` 端口对外暴露，并设置环境变量 `AWW_DATA_DIR=/data`、挂载可写持久卷。

### 方式二：腾讯云 CloudBase 云托管（云开发容器，推荐给国内用户）

你已有 CloudBase 使用经验，云托管是长期稳定的「免隧道」方案：

```bash
# 1. 安装云开发 CLI 并登录
npm i -g @cloudbase/cli && tcb login

# 2. 在 cloudbaserc.json 填入你的 envId 后一键部署
tcb framework deploy
```

- `cloudbaserc.json` 已预置 `@cloudbase/framework-plugin-container` 配置，读 `Dockerfile`，环境变量 `AWW_DATA_DIR=/data`。
- 也可不走 CLI：CloudBase 控制台 → 云托管 → 新建服务 →「使用 Dockerfile 部署」，上传本仓库即可，平台会分配 `*.ap-shanghai.run.tcloudbase.com` 公网域名。
- 部署后该域名即为完整应用地址，真人邀请链接、AI 库、对局全部可用，无需 Cloudflare Tunnel。

### 方式三：前后端分离（前端留 GitHub Pages）

若坚持前端用 GitHub Pages、后端独立部署：

```bash
# 构建前端时把 API 指向你的容器域名
VITE_API_BASE=https://你的容器域名 npm run build
git push   # 触发 Pages 重新部署
```

后端按「方式一/二」部署，`VITE_API_BASE` 指向它即可（服务端已开启 CORS）。

> 小结：**生产环境用 Docker / CloudBase 云托管部署后端，根本不需要任何隧道**；Cloudflare Tunnel 仅用于「本机快速公网演示」。

## Cloudflare Tunnel 部署（本机公网演示用）

Cloudflare Tunnel 可以把「本机运行的后端 + 前端」整体暴露到公网，得到可公开访问的完整应用（AI 库、对局、SSE 观战全部可用）。**这是本地演示的便捷手段，生产请用上面的 Docker / CloudBase 云托管方案。**

```bash
# 1. 先启动本机应用（生产模式，端口 3001）
npm run start
# 或开发模式 npm run dev

# 2. 另开一个终端启动隧道
npm run tunnel
```

`npm run tunnel` 会：
1. 弹一次 UAC 授权（需要管理员权限临时把 DNS 切到 223.5.5.5，因为本机 DNS 对 Cloudflare 的 SRV 记录解析异常）；
2. 用 cloudflared 建立 quick tunnel 并打印公网地址（形如 `https://xxx.trycloudflare.com`，同时写入 `%TEMP%\cfd-tunnel-url.txt`）；
3. 隧道运行期间保持窗口打开；**关闭该窗口即停止隧道并自动恢复原 DNS**。

> 说明：quick tunnel 无需 Cloudflare 账号，但地址随机、重启会变、无 uptime 保证，适合演示与临时使用。
> 若想获得固定域名（如 `ai.example.com`），需要你有 Cloudflare 账号与域名，可用命名隧道：
> `cloudflared tunnel login` → `cloudflared tunnel create ai-werewolf` → `cloudflared tunnel route dns ai-werewolf <你的域名>` →
> 再用 `cloudflared tunnel run --dns-resolver-addrs 223.5.5.5:53 ai-werewolf`（该参数可避免 DNS 问题，无需改系统 DNS）。
## 测试

```bash
npm test          # 服务端单测 + 集成（引擎、适配器、mock 完整对局）
npm run test:e2e  # Playwright 冒烟：建 AI → 开一局 → 观战到结束 → 报告（截图存 screenshots/）
```

## 目录结构

```
server/   Express + node:sqlite 后端（引擎、AI 中台、REST API、SSE）
web/      Vite + React + TypeScript 前端
scripts/  e2e-smoke.mjs 端到端冒烟
data/     运行时生成（数据库 + 主密钥），已 gitignore
```

## 安全说明

- API 密钥仅在本机加密存储，后端代理调用，前端永远拿不到明文。
- 单用户 AI 档案上限 50，单局 AI 上限 12。
- 删除档案 / 修改密钥前均有二次确认。

## Cloudflare Turnstile 人机验证

在两个「不可信用户提交」入口接入了 Turnstile，防止机器人批量创建 AI 档案 / 冒名加入对局：

- `POST /api/ai-profiles`（创建 AI 档案）→ action `create_profile`
- `POST /api/games/:id/seats/:token/join`（真人占座加入）→ action `join_game`

核心规则（canonical）：浏览器拿到 `cf-turnstile-response` 令牌 → 前端随请求体发给后端 → 后端调用 Cloudflare `siteverify` 校验 `success===true`、action 匹配、hostname 在白名单；任一不满足即 `403`。**siteverify 仅在后端调用，前端永不直接请求。**

### 1. 创建 widget（需你的 Cloudflare 令牌）

```bash
CLOUDFLARE_API_TOKEN=xxxx CLOUDFLARE_ACCOUNT_ID=yyyy \
  node scripts/turnstile-create.mjs --name "ai-werewolf" \
  --domain ai-werewolf.pages.dev --domain your-domain.com
```

脚本只打印 sitekey（可公开）与 secret（保密），不写盘。

### 2. 配置密钥

```bash
# server/.env（服务端，保密）
TURNSTILE_SECRET=<上一步的 secret>
TURNSTILE_HOSTNAMES=ai-werewolf.pages.dev,your-domain.com   # 生产不要含 localhost

# web/.env（前端，构建期注入）
VITE_TURNSTILE_SITEKEY=<上一步的 sitekey>
```

> 未配置 `TURNSTILE_SECRET` 时后端自动进入**旁路模式**（开发放行，不阻断功能）；生产务必配置，否则等于未防护。

### 3. 本地验证

```bash
node scripts/turnstile-validate.mjs
```

启动 mock siteverify + 真实后端，断言：合法令牌放行（201/200）、缺令牌 / 伪造 / action 不符 / hostname 不符均拒绝（403），并实测真实 Cloudflare 端点（官方测试密钥）。

### 代码位置

- `server/src/turnstile.ts` — `verifyTurnstile()` + `turnstileGuard()` 中间件
- `web/src/components/Turnstile.tsx` — React 封装（自动加载脚本、单令牌重置）
- `web/src/config.ts` — `TURNSTILE_SITEKEY` / `TURNSTILE_ENABLED`
