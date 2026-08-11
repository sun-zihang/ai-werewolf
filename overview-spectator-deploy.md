# AI 狼人杀 · 实时观战（上帝视角）+ 公网部署 总览

## 做了什么

### 1. 上帝视角实时观战（人类观战可实时跟进）
- **新增「实时观战」大厅** (`LivePage`)：顶部导航新增入口，每 3 秒自动刷新，列出所有「进行中 / 已暂停」的对局，一键「进入观战」。人类无需知道对局 URL 即可发现并实时跟进。
- **观战页增强** (`SpectatePage`)：
  - SSE 连接状态指示：实时 / 连接中 / 重连中（圆点 + 文案）。
  - 上帝视角开启时显示「全知」徽标，明确此刻可见全部身份与夜间行动。
  - 新增「复制观战链接」按钮，方便把观战地址分享给他人（配合公网隧道尤其有用）。
- **抗 Cloudflare SSE 缓冲**：实测发现公网 Tunnel 会缓冲 SSE 流（25s 内收不到事件），已新增 `GET /api/games/:id/events-list` 增量事件接口，前端改为「SSE + 2s 轮询双通道、按 seq 去重」，隧道下时间线依然实时。

### 2. Cloudflare Tunnel 公网公开
- 已在本机启动完整应用（后端 3001 + 前端），并通过 `cloudflared` quick tunnel 暴露到公网。
- 公网地址（已验证可访问、SSE/API 正常）：
  **https://induced-characterization-theta-classic.trycloudflare.com**
- 端到端校验通过：公网开一局，首事件延迟 ~428ms，含 5 条上帝视角机密夜间行动，时间线实时刷新。

### 3. 同步到 GitHub Pages + GitHub 仓库
- 提交 `cbf48ba`（观战大厅 + 上帝视角）与 `b743bf3`（抗 SSE 缓冲修复）已推送到 `main`。
- GitHub Pages 工作流两次均 `success`，静态前端已上线：
  **https://sun-zihang.github.io/ai-werewolf/**
- 注：Pages 仅托管前端；完整功能（AI 库 / 对局 / 实时观战）走上面的 Tunnel 地址。

## 关键文件
- `web/src/pages/LivePage.tsx`（新增）— 实时观战大厅
- `web/src/pages/SpectatePage.tsx` — 上帝视角 + 连接状态 + 分享 + 双通道实时
- `web/src/api.ts` — `subscribeEvents` 状态回调 + `getEvents`
- `server/src/routes/games.ts` — 新增 `events-list` 增量接口
- `scripts/validate-tunnel.mjs`（新增）— 公网隧道端到端校验

## 在你自己的机器上运行
```bash
npm run setup          # 安装依赖
npm run start          # 启动完整应用（http://localhost:3001）
npm run tunnel         # 另开终端：公网暴露（quick tunnel，地址随机；需管理员权限做一次性 DNS 切换）
```
GitHub Pages 改动只需 `git push` 到 `main` 即自动部署。
