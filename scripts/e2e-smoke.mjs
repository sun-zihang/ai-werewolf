// 端到端冒烟：启动服务器 → 用真实浏览器创建 AI → 开一局 → 等结束 → 校验报告与截图
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const SHOTS = path.join(root, "screenshots");
mkdirSync(SHOTS, { recursive: true });

async function waitFor(fn, timeout = 60000, interval = 500) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > timeout) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
}

let server = null;
try {
  // 启动服务器（生产模式托管 dist，即仓库根 dist）
  server = spawn(
    process.platform === "win32"
      ? `npm --prefix "${path.join(root, "server")}" run start`
      : `npm --prefix ${path.join(root, "server")} run start`,
    { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, PORT: "3001", AWW_DATA_DIR: path.join(root, "data") } }
  );

  const ok = await waitFor(async () => {
    try {
      const res = await fetch(`${BASE}/api/health`);
      return res.ok;
    } catch {
      return false;
    }
  }, 30000);
  if (!ok) throw new Error("服务器未在 30s 内就绪");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // 1. 首页
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".brand");
  console.log("✓ 首页加载，品牌：", (await page.textContent(".brand")).trim());

  // 2. 直接通过 API 创建 5 个本地 AI（UI 新建在 LibraryPage 冒烟里覆盖）
  const created = await page.evaluate(async () => {
    const names = ["小灰", "月影", "青苔", "阿狸", "白露"];
    const ids = [];
    for (const name of names) {
      const res = await fetch("/api/ai-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, provider: "local", model: "local-engine", thinking_level: "medium", description: `${name} 的规则引擎人格` }),
      });
      ids.push((await res.json()).id);
    }
    return ids;
  });
  console.log("✓ 已创建 5 个本地 AI:", created.join(","));

  // 3. AI 库页面
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".profile-grid");
  const cardCount = await page.locator(".profile-card").count();
  console.log(`✓ AI 库显示 ${cardCount} 张卡片`);
  await page.screenshot({ path: path.join(SHOTS, "1-library.png") });

  // 4. 通过 UI 新建一个 AI（表单冒烟）
  await page.click("text=新建 AI");
  await page.waitForSelector(".modal");
  await page.fill("input[placeholder='如：小灰、阿狸']", "纸牌");
  await page.selectOption(".modal select >> nth=0", "paper"); // 思考强度
  await page.fill("input[placeholder='模型 ID']", "local-engine");
  await page.click(".modal button.primary");
  await page.waitForSelector("text=纸牌");
  console.log("✓ 通过表单新建 AI「纸牌」成功");
  await page.screenshot({ path: path.join(SHOTS, "2-library-form.png") });

  // 5. 新建对局页
  await page.click("text=新建对局");
  await page.waitForSelector(".game-list");
  // 选中前 5 个 AI
  const items = page.locator(".game-item");
  for (let i = 0; i < 5; i++) await items.nth(i).click();
  await page.click("text=开始对局");
  await page.waitForURL(/\/games\/\d+/);
  const gameId = page.url().match(/games\/(\d+)/)[1];
  console.log(`✓ 已创建并启动对局 #${gameId}`);

  // 6. 观战：等待结束
  await page.waitForSelector(".seat-grid");
  await page.waitForSelector(".timeline");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, "3-spectate-running.png") });

  const finished = await waitFor(async () => {
    const txt = await page.textContent("body");
    return txt.includes("结算报告") && txt.includes("MVP");
  }, 90000);
  if (!finished) throw new Error("对局 90s 内未结束");
  console.log("✓ 对局结束，结算报告已渲染");
  await page.screenshot({ path: path.join(SHOTS, "4-spectate-finished.png"), fullPage: false });

  // 7. 历史页
  await page.click("text=历史");
  await page.waitForSelector(".history-table");
  const rows = await page.locator(".history-table tbody tr").count();
  console.log(`✓ 历史页显示 ${rows} 局记录`);
  await page.screenshot({ path: path.join(SHOTS, "5-history.png") });

  await browser.close();
  console.log("\nE2E 冒烟通过 ✅  截图已保存到 screenshots/");
} catch (e) {
  console.error("\nE2E 冒烟失败 ❌", e?.message ?? e);
  process.exitCode = 1;
} finally {
  if (server) {
    if (process.platform === "win32") {
      try { require("node:child_process").execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" }); } catch { /* already dead */ }
    } else {
      server.kill();
    }
  }
}