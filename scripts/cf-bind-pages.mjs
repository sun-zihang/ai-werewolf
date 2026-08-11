/**
 * 给 Cloudflare Pages 项目绑定 D1 与服务端密钥（幂等，可重复执行）。
 *
 * 为什么不用 wrangler.toml：
 *   Pages 的 Git 集成一旦在仓库根发现 wrangler.toml，就会忽略控制台里配置的绑定与环境变量。
 *   为了不让 D1 绑定和密钥被静默清空，这里用 REST API 显式维护，配置留在控制台（单一真相源）。
 *
 * 用法（密钥只从环境变量读，不写进仓库）：
 *   CF_ACCOUNT_ID=xxx CF_API_TOKEN=xxx D1_DATABASE_ID=xxx \
 *   AWW_MASTER_KEY=<64位hex> TURNSTILE_SECRET=0x... \
 *   node scripts/cf-bind-pages.mjs
 *
 * 可选：
 *   PAGES_PROJECT=ai-werewolf           项目名
 *   TURNSTILE_HOSTNAMES=ai-werewolf.pages.dev
 *   D1_DATABASE_NAME=ai-werewolf        当未提供 D1_DATABASE_ID 时，按名字查找；找不到则创建
 */

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const PROJECT = process.env.PAGES_PROJECT || "ai-werewolf";
const D1_NAME = process.env.D1_DATABASE_NAME || "ai-werewolf";

if (!ACCOUNT || !TOKEN) {
  console.error("缺少 CF_ACCOUNT_ID / CF_API_TOKEN");
  process.exit(1);
}

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!body.success) {
    throw new Error(`${init.method || "GET"} ${path} -> HTTP ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result;
}

async function resolveD1Id() {
  if (process.env.D1_DATABASE_ID) return process.env.D1_DATABASE_ID;
  const list = await cf("/d1/database");
  const hit = (list || []).find((d) => d.name === D1_NAME);
  if (hit) {
    console.log(`复用已有 D1：${hit.name} (${hit.uuid})`);
    return hit.uuid;
  }
  const created = await cf("/d1/database", { method: "POST", body: JSON.stringify({ name: D1_NAME }) });
  console.log(`已创建 D1：${created.name} (${created.uuid})`);
  return created.uuid;
}

function envVars({ withHostnames }) {
  const vars = {};
  if (process.env.TURNSTILE_SECRET) vars.TURNSTILE_SECRET = { type: "secret_text", value: process.env.TURNSTILE_SECRET };
  if (process.env.AWW_MASTER_KEY) vars.AWW_MASTER_KEY = { type: "secret_text", value: process.env.AWW_MASTER_KEY };
  if (process.env.AWW_STEP_BUDGET) vars.AWW_STEP_BUDGET = { type: "plain_text", value: process.env.AWW_STEP_BUDGET };
  if (withHostnames && process.env.TURNSTILE_HOSTNAMES) {
    // preview 域名是 <hash>.<project>.pages.dev，白名单只对 production 有意义
    vars.TURNSTILE_HOSTNAMES = { type: "plain_text", value: process.env.TURNSTILE_HOSTNAMES };
  }
  return vars;
}

const d1Id = await resolveD1Id();
const payload = {
  deployment_configs: {
    production: { d1_databases: { DB: { id: d1Id } }, env_vars: envVars({ withHostnames: true }) },
    preview: { d1_databases: { DB: { id: d1Id } }, env_vars: envVars({ withHostnames: false }) },
  },
};

const result = await cf(`/pages/projects/${PROJECT}`, { method: "PATCH", body: JSON.stringify(payload) });
for (const name of ["production", "preview"]) {
  const cfg = result.deployment_configs?.[name] ?? {};
  console.log(
    `${name}: D1=${JSON.stringify(cfg.d1_databases)} vars=${JSON.stringify(
      Object.fromEntries(Object.entries(cfg.env_vars ?? {}).map(([k, v]) => [k, v.type]))
    )}`
  );
}
console.log("绑定完成。注意：Pages 需要重新部署一次才会生效。");
