# 对局节奏改造：分阶段 + 真人节奏档位

## 背景
原逻辑用单一固定延时 `speedMs`（默认 450ms）控制每一步之间的停顿，不分阶段、整局偏快，不符合"人类玩狼人杀"的从容节奏，也不利于实时观战跟进。

## 改动
把"单一速度"换成**分阶段的节奏档位**：夜晚 / 发言 / 投票 / 遗言 / 猎人 / 阶段切换 各有独立停顿，并在「新建对局」页提供节奏选择器，默认 **真人节奏**。

### 三档停顿（毫秒）
| 阶段 | 真人节奏(slow) | 适中(normal) | 快进(fast) |
|---|---|---|---|
| 夜晚行动 | 4000 | 2500 | 1400 |
| 发言 | 9000 | 6000 | 3000 |
| 投票 | 2500 | 1800 | 1000 |
| 遗言 | 4500 | 3000 | 1800 |
| 猎人开枪 | 4000 | 2500 | 1500 |
| 阶段切换 | 3500 | 2200 | 1200 |

### 涉及文件
- `server/src/engine/engine.ts`：新增 `PaceKey`/`PaceProfile`/`PACES`/`resolvePace()`；`tick(category)` 按阶段取停顿；`playRound` 每次阶段切换前加 `tick("phaseGap")`。
- `server/src/manager.ts` + `server/src/routes/games.ts`：`startGame` 接收 `pace` 档位或数字（旧 `speed_ms` 仍兼容），默认 `"slow"`。
- `web/src/api.ts` + `web/src/pages/NewGamePage.tsx`：新增「对局节奏」下拉（真人节奏/适中/快进），默认真人节奏。
- `scripts/probe-pace.mjs`：计时探针，校验节奏间隔。

## 验证
- **真人节奏计时**（本地探针）：`game_started → 首个夜间行动 = 7513ms`（≈ phaseGap3500 + night4000）；相邻夜间行动间隔 `7520ms` → 真人节奏生效。
- **公网隧道端到端**（fast 档）：完整跑完一局，上帝视角夜间行动实时到达，秘密封装事件正常。
- GitHub Pages 已重新部署并上线节奏选择器；Cloudflare Tunnel 公网地址同步提供。

## 提交
- `1627184` 节奏分阶段 + 真人节奏档位
- `75efbc8` 校验脚本改用 pace 参数

## 公网访问
- Cloudflare Tunnel：https://induced-characterization-theta-classic.trycloudflare.com （沙箱运行，重启会变；本机用 `npm run tunnel`）
- GitHub Pages：https://sun-zihang.github.io/ai-werewolf/
