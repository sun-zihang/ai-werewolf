// Cloudflare Turnstile 一条龙配置脚本
// 1) 创建 widget   2) 写 server/.env + web/.env
// 3) 将 VITE_TURNSTILE_SITEKEY 设为 Pages 构建环境变量  4) 触发 Pages 重新部署
//
// 用法：
//   CLOUDFLARE_API_TOKEN=xxxx CLOUDFLARE_ACCOUNT_ID=yyyy \
//     node scripts/turnstile-create.mjs --name "ai-werewolf" \
//     --domain ai-werewolf.pages.dev --domain localhost [--no-pages] [--no-deploy]
//
// 注意：secret 只写入 server/.env（已被 gitignore）。脚本不回传任何远端。

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !accountId) {
  console.error("缺少环境变量：请设置 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};
const hasFlag = (f) => args.includes(f);

const name = getArg("--name", "ai-werewolf");
const pagesProject = getArg("--pages-project", "ai-werewolf");
const noPages = hasFlag("--no-pages");
const noDeploy = hasFlag("--no-deploy");

const domains = args
  .map((a, i) => (a === "--domain" ? args[i + 1] : null))
  .filter(Boolean);
for (const d of ["localhost", "127.0.0.1"]) if (!domains.includes(d)) domains.push(d);
if (domains.length === 0) { console.error("请提供至少一个 --domain"); process.exit(1); }

const api = (method, p, body) =>
  fetch(`https://api.cloudflare.com/client/v4${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: j.success, json: j };
  });

// 1) 创建 widget
console.log("① 创建 Turnstile widget …");
const created = await api("POST", `/accounts/${accountId}/challenges/widgets`, {
  name,
  domains,
  mode: "managed",
});
if (!created.ok) {
  console.error("❌ 创建失败：", JSON.stringify(created.json.errors ?? created.json, null, 2));
  process.exit(1);
}
const { sitekey, secret } = created.json.result;
console.log("   ✅ sitekey:", sitekey);

// 2) 写 env 文件
const serverEnv = path.join(ROOT, "server", ".env");
const webEnv = path.join(ROOT, "web", ".env");
const svLines = `\n# Cloudflare Turnstile\nTURNSTILE_SECRET=${secret}\nTURNSTILE_HOSTNAMES=${domains.join(",")}\n`;
const wvLines = `\n# Cloudflare Turnstile\nVITE_TURNSTILE_SITEKEY=${sitekey}\n`;

if (existsSync(serverEnv)) appendFileSync(serverEnv, svLines);
else writeFileSync(serverEnv, svLines.replace(/^\n/, ""));
if (existsSync(webEnv)) appendFileSync(webEnv, wvLines);
else writeFileSync(webEnv, wvLines.replace(/^\n/, ""));
console.log("   ✅ 写入 server/.env 与 web/.env");

// 3) Pages 构建环境变量
if (!noPages) {
  console.log("② 设置 Pages 构建环境变量 VITE_TURNSTILE_SITEKEY …");
  const envResp = await api("PATCH", `/accounts/${accountId}/pages/projects/${pagesProject}/env`, {
    production: { VITE_TURNSTILE_SITEKEY: sitekey },
    preview: { VITE_TURNSTILE_SITEKEY: sitekey },
  });
  if (!envResp.ok) {
    console.error("   ⚠️ Pages 环境变量设置失败：", JSON.stringify(envResp.json.errors ?? envResp.json, null, 2));
  } else {
    console.log("   ✅ Pages 环境变量已设置");
  }

  // 4) 触发部署
  if (!noDeploy) {
    console.log("③ 触发 Pages 重新部署 …");
    const dep = await api("POST", `/accounts/${accountId}/pages/projects/${pagesProject}/deployments`, {});
    if (!dep.ok) {
      console.error("   ⚠️ 部署触发失败：", JSON.stringify(dep.json.errors ?? dep.json, null, 2));
      console.error("   请到 Cloudflare 控制台手动「创建部署」或推送一次提交。");
    } else {
      const d = dep.json.result;
      console.log("   ✅ 部署已触发，ID:", d?.id ?? "(n/a)");
      console.log("   状态:", d?.status ?? "(n/a)", " 环境:", d?.environment ?? "(n/a)");
    }
  }
}

console.log("\n🎉 完成。");
console.log("   - 前端站点（生产）将在部署完成后加载 Turnstile。");
console.log("   - 后端需在你自托管的服务中使用 server/.env 的 TURNSTILE_SECRET（CloudBase/Docker 部署时请同步填入）。");
console.log("   - 若 Pages 部署未自动生效，请到控制台确认 VITE_TURNSTILE_SITEKEY 已出现在构建环境变量中。");
