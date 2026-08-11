// 创建 Cloudflare Turnstile widget（需你的 Cloudflare API 令牌 + 账户 ID）
//
// 用法：
//   CLOUDFLARE_API_TOKEN=xxxx CLOUDFLARE_ACCOUNT_ID=yyyy \
//     node scripts/turnstile-create.mjs --name "ai-werewolf" \
//     --domain ai-werewolf.pages.dev --domain example.com --domain localhost
//
// 输出 sitekey（可公开）与 secret（务必保密）。脚本不写盘，请自行填入：
//   server/.env        -> TURNSTILE_SECRET=<secret>
//   web/.env           -> VITE_TURNSTILE_SITEKEY=<sitekey>
//   server/.env        -> TURNSTILE_HOSTNAMES=ai-werewolf.pages.dev,example.com

import { appendFileSync } from "node:fs";

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.error("缺少环境变量：请设置 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

const args = process.argv.slice(2);
function getArg(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
}

const name = getArg("--name", "ai-werewolf");
const domains = args
  .filter((a) => a.startsWith("--domain"))
  .map((_, i) => args[args.indexOf(`--domain`, i) + 1])
  .filter(Boolean);

// 始终包含本地回环，便于开发
for (const d of ["localhost", "127.0.0.1"]) {
  if (!domains.includes(d)) domains.push(d);
}

if (domains.length === 0) {
  console.error("请提供至少一个 --domain");
  process.exit(1);
}

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/turnstile/widgets`;
const resp = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name, domains, mode: "managed" }),
});

const json = await resp.json();
if (!resp.ok || !json.success) {
  console.error("创建失败：", JSON.stringify(json, null, 2));
  process.exit(1);
}

const { sitekey, secret } = json.result;
console.log("\n✅ Widget 已创建\n");
console.log("Sitekey（可公开，前端用）:");
console.log("  " + sitekey);
console.log("\nSecret（保密，仅服务端）：");
console.log("  " + secret);
console.log("\n请将以下配置写入对应文件：\n");
console.log("server/.env:");
console.log(`  TURNSTILE_SECRET=${secret}`);
console.log(`  TURNSTILE_HOSTNAMES=${domains.join(",")}\n`);
console.log("web/.env:");
console.log(`  VITE_TURNSTILE_SITEKEY=${sitekey}\n`);
console.log("（可选）覆盖 siteverify 端点：");
console.log("  TURNSTILE_SITEVERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify");

// 不主动写盘；如需自动追加到 server/.env，取消下一行注释并自行确认安全：
// appendFileSync("server/.env", `\nTURNSTILE_SECRET=${secret}\nTURNSTILE_HOSTNAMES=${domains.join(",")}\n`);
