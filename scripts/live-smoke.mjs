#!/usr/bin/env node
/**
 * 线上烟测：对已部署的 Cloudflare Pages Functions + D1 做真实 HTTP 验证。
 *
 * 和 scripts/driver-smoke.ts 的分工：
 *   driver-smoke  用 node:sqlite 模拟 D1，在本机验证「快照+重放」的 seq 不变式（快、可断点）
 *   live-smoke    打真实 HTTPS，验证部署产物：路由、D1 绑定、密钥加密、Turnstile 拦截、轮询推进
 *
 * 用法：
 *   node scripts/live-smoke.mjs                          # 默认打 https://ai-werewolf.pages.dev
 *   BASE=https://xxx.pages.dev node scripts/live-smoke.mjs
 */
const BASE = (process.env.BASE || "https://ai-werewolf.pages.dev").replace(/\/$/, "");
const API = `${BASE}/api`;

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? `  → ${detail}` : ""}`);
  }
}
function info(msg) {
  console.log(`  · ${msg}`);
}
function stage(msg) {
  console.log(`\n[${msg}]`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON（例如被 SPA fallback 兜走时会拿到 HTML）*/
  }
  return { status: res.status, json, text, headers: res.headers };
}

const run = async () => {
  console.log(`线上烟测 → ${BASE}`);

  // ---------- [1] 路由与运行时 ----------
  stage("1] 路由与运行时");
  const health = await req("GET", "/health");
  ok(health.status === 200, "GET /api/health 返回 200", `status=${health.status}`);
  ok(health.json?.ok === true, "health.ok === true", health.text.slice(0, 120));
  ok(
    health.json?.runtime === "cloudflare-pages",
    "runtime 是 cloudflare-pages（说明没被 SPA fallback 兜走）",
    `runtime=${health.json?.runtime}`,
  );
  ok(health.json?.driver === "d1-poll", "driver 是 d1-poll", `driver=${health.json?.driver}`);

  const providers = await req("GET", "/providers");
  ok(Array.isArray(providers.json) && providers.json.length > 0, "GET /api/providers 返回非空数组");
  ok(
    providers.json?.some((p) => p.id === "local"),
    "provider 列表含内置 local 引擎（无需 API Key 即可跑通）",
  );

  // ---------- [2] Turnstile 拦截 ----------
  // 生产已配置 TURNSTILE_SECRET，因此不带 token 的受保护写接口必须被拒。
  // 这条一旦失效，等于任何人都能刷 AI 档案，是真金白银的风险。
  stage("2] Turnstile 拦截（受保护写接口不带 token 必须被拒）");
  const noToken = await req("POST", "/ai-profiles", {
    name: "烟测-应当被拒",
    providerId: "local",
    model: "local",
  });
  ok(
    noToken.status === 403,
    "POST /api/ai-profiles 无 Turnstile token → 403",
    `status=${noToken.status} body=${noToken.text.slice(0, 160)}`,
  );

  // ---------- [3] D1 读路径 ----------
  stage("3] D1 读路径（建表 + 查询真的连上了库）");
  const profiles = await req("GET", "/ai-profiles");
  ok(profiles.status === 200, "GET /api/ai-profiles 返回 200", `status=${profiles.status}`);
  ok(Array.isArray(profiles.json), "档案列表是数组（说明 D1 已建表且可查）", profiles.text.slice(0, 160));
  info(`当前线上档案数：${Array.isArray(profiles.json) ? profiles.json.length : "?"}`);

  const presets = await req("GET", "/presets");
  ok(presets.status === 200 && Array.isArray(presets.json), "GET /api/presets 返回数组");

  const games = await req("GET", "/games");
  ok(games.status === 200 && Array.isArray(games.json), "GET /api/games 返回数组");

  // ---------- [4] 全 AI 对局：建局 → 开局 → 轮询推进 ----------
  // 这一段是整个烟测里唯一能验证「真实 Workers 运行时能不能扛住重放」的部分。
  // driver-smoke 证明了逻辑正确，但证明不了 Workers 的 CPU 时限够用——只有打真环境才知道。
  //
  // 生产环境开了 Turnstile，写接口会 403，本段自动跳过。
  // 要真正跑通请打 preview 环境（preview 不配 TURNSTILE_SECRET 时 guard 放行）：
  //   BASE=https://<hash>.ai-werewolf.pages.dev node scripts/live-smoke.mjs
  stage("4] 全 AI 对局（真实 Workers + 真实 D1 跑到终局）");
  const createdProfileIds = [];
  let localProfiles = (Array.isArray(profiles.json) ? profiles.json : []).filter(
    (p) => (p.providerId ?? p.provider_id) === "local",
  );
  info(`线上已有 local 档案：${localProfiles.length} 个`);

  let blockedByTurnstile = false;
  for (let i = localProfiles.length; i < 6; i++) {
    const r = await req("POST", "/ai-profiles", {
      name: `烟测-local-${Date.now()}-${i}`,
      providerId: "local",
      model: "local",
      thinkingLevel: "low",
    });
    if (r.status === 403) {
      blockedByTurnstile = true;
      break;
    }
    if (r.status === 200 || r.status === 201) {
      const id = r.json?.id;
      if (id) {
        createdProfileIds.push(id);
        localProfiles.push({ id, providerId: "local" });
      }
    } else {
      ok(false, `创建第 ${i + 1} 个 local 档案`, `status=${r.status} body=${r.text.slice(0, 160)}`);
      break;
    }
  }

  if (blockedByTurnstile) {
    info("写接口被 Turnstile 拦截（生产环境的预期行为）→ 跳过对局推进验证");
    info("要实测请打 preview 环境；逻辑正确性另由 `npm run test:driver` 覆盖");
  } else if (localProfiles.length < 6) {
    ok(false, "凑齐 6 个 local 档案", `只有 ${localProfiles.length} 个`);
  } else {
    ok(true, `凑齐 6 个 local 档案（本次新建 ${createdProfileIds.length} 个）`);

    const seats = localProfiles.slice(0, 6).map((p) => ({ profileId: p.id, isHuman: false }));
    const created = await req("POST", "/games", { pace: "fast", seats });
    ok(
      (created.status === 200 || created.status === 201) && created.json?.id,
      "POST /api/games 建局成功",
      `status=${created.status} body=${created.text.slice(0, 200)}`,
    );

    if (created.json?.id) {
      const gid = created.json.id;
      const started = await req("POST", `/games/${gid}/start`);
      ok(started.status === 200, "POST /api/games/:id/start 开局成功", started.text.slice(0, 200));

      // 模拟前端 2s 轮询：每次 GET 顺带把引擎往前推
      let lastSeq = -1;
      let seqOk = true;
      const seen = new Set();
      let dupSeq = false;
      let finished = false;
      let evCount = 0;
      let polls = 0;
      let serverError = null;
      const t0 = Date.now();

      for (let i = 0; i < 60; i++) {
        await sleep(2000);
        polls++;
        const list = await req("GET", `/games/${gid}/events-list`);
        if (list.status >= 500) {
          serverError = `轮询第 ${polls} 次 → HTTP ${list.status}: ${list.text.slice(0, 200)}`;
          break;
        }
        const events = list.json?.events ?? (Array.isArray(list.json) ? list.json : []);
        if (Array.isArray(events)) {
          evCount = events.length;
          for (const e of events) {
            if (typeof e.seq !== "number") continue;
            if (e.seq < lastSeq) seqOk = false;
            if (seen.has(e.seq)) dupSeq = true;
            seen.add(e.seq);
            lastSeq = Math.max(lastSeq, e.seq);
          }
          if (events.some((e) => e.type === "game_over")) {
            finished = true;
            break;
          }
        }
      }

      ok(!serverError, "轮询期间没有 5xx（Workers 未因 CPU 超时/异常挂掉）", serverError ?? "");
      ok(evCount > 0, "轮询能拿到事件（stepGame 在真实 Workers 里跑起来了）", `events=${evCount}`);
      ok(seqOk, "线上事件 seq 单调不回退");
      ok(!dupSeq, "线上事件 seq 无重复（重放没有把事件写两遍）");
      ok(
        seen.size === 0 || seen.size === lastSeq - Math.min(...seen) + 1,
        "线上事件 seq 连续无空洞",
        `count=${seen.size} range=${seen.size ? `${Math.min(...seen)}..${lastSeq}` : "-"}`,
      );
      ok(finished, "对局在 60 次轮询内走到终局", `polls=${polls} events=${evCount} lastSeq=${lastSeq}`);
      info(`轮询 ${polls} 次，事件 ${evCount} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      if (finished) {
        const report = await req("GET", `/games/${gid}/report`);
        ok(
          report.status === 200 && report.json?.winner,
          "战报可读且有 winner",
          report.text.slice(0, 200),
        );
        const players = report.json?.players;
        ok(Array.isArray(players) && players.length === 6, "战报含 6 名玩家", `players=${players?.length}`);
      }
    }
  }

  // ---------- [5] CORS ----------
  // GitHub Pages 镜像是跨域访问这个后端的，缺了 CORS 头它就废了。
  stage("5] CORS 预检");
  const pre = await fetch(`${API}/health`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://sun-zihang.github.io",
      "Access-Control-Request-Method": "POST",
    },
  });
  ok(pre.status === 204 || pre.status === 200, "OPTIONS 预检返回 2xx", `status=${pre.status}`);
  ok(
    !!pre.headers.get("access-control-allow-origin"),
    "预检响应带 Access-Control-Allow-Origin",
    `headers=${[...pre.headers.keys()].join(",")}`,
  );

  // ---------- [6] 清理 ----------
  // 只删本次自己建的档案，绝不碰线上已有数据。
  if (createdProfileIds.length > 0) {
    stage("6] 清理本次新建的测试档案");
    let removed = 0;
    for (const id of createdProfileIds) {
      const r = await req("DELETE", `/ai-profiles/${id}`);
      if (r.status === 200) removed++;
    }
    ok(removed === createdProfileIds.length, `删除 ${createdProfileIds.length} 个测试档案`, `实际删除 ${removed}`);
  }

  // ---------- 汇总 ----------
  console.log(`\n${fail === 0 ? "全部通过 ✅" : `有 ${fail} 项未通过 ❌`}（通过 ${pass} / 共 ${pass + fail}）`);
  if (fail > 0) {
    console.log("未通过项：");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
};

run().catch((e) => {
  console.error("\n烟测异常中断：", e);
  process.exit(1);
});
