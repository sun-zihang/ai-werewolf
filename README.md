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

Cloudflare Tunnel 只是「把本机运行的服务临时暴露到公网」的便捷手段，**不是必须的**。后端是一个标准 Node 服务（Express + node:sqlite），用 Docker 部署到任意云厂商/服务器即可获得固定公网地址，前端与后端同容器、同域名，天然无需隧道、无跨域、无需 GitHub Pages 也能跑完整应用。

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
