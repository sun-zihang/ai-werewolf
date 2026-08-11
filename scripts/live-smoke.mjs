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

  // 本次烟测自己建的档案 id，末尾统一清理；绝不碰线上已有数据
  const createdProfileIds = [];

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
  // 断言方向取决于该环境是否真的配了密钥（health.turnstile 只是布尔位，不泄漏密钥）：
  //   配了（生产）→ 不带 token 的受保护写接口必须 403。这条一旦失效，
  //                 等于任何人都能刷 AI 档案，是真金白银的风险。
  //   没配（预览/本地）→ guard 按设计放行，此时断言 403 反而是错的。
  const turnstileOn = health.json?.turnstile === true;
  stage(`2] Turnstile（该环境 turnstile=${turnstileOn ? "on" : "off"}）`);

  // 注意字段名：接口用 snake_case（provider / thinking_level），不是 camelCase。
  // 曾经这里写成 providerId，返回的是 400「不支持的厂商」而不是 403——
  // 参数校验在 guard 之后，写错参数会让这条断言"因为别的原因"通过，白测。
  const probeName = `烟测-turnstile-probe-${Date.now()}`;
  const noToken = await req("POST", "/ai-profiles", {
    name: probeName,
    provider: "local",
    model: "local-engine",
  });
  if (turnstileOn) {
    ok(
      noToken.status === 403,
      "无 Turnstile token 的 POST /api/ai-profiles → 403",
      `status=${noToken.status} body=${noToken.text.slice(0, 160)}`,
    );
  } else {
    ok(
      noToken.status === 201 || noToken.status === 200,
      "未配密钥时 guard 按设计放行（预览/本地环境不该挡用户）",
      `status=${noToken.status} body=${noToken.text.slice(0, 160)}`,
    );
    // 放行路径下这次探测真的建了一条档案，登记下来供末尾清理
    if (noToken.json?.id) createdProfileIds.push(noToken.json.id);
  }

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
  let localProfiles = (Array.isArray(profiles.json) ? profiles.json : []).filter(
    (p) => p.provider === "local",
  );
  info(`线上已有 local 档案：${localProfiles.length} 个`);

  let blockedByTurnstile = false;
  for (let i = localProfiles.length; i < 6; i++) {
    const r = await req("POST", "/ai-profiles", {
      name: `烟测-local-${Date.now()}-${i}`,
      provider: "local",
      model: "local-engine",
      thinking_level: "medium",
    });
    if (r.status === 403) {
      blockedByTurnstile = true;
      break;
    }
    if (r.status === 200 || r.status === 201) {
      const id = r.json?.id;
      if (id) {
        createdProfileIds.push(id);
        localProfiles.push({ id, provider: "local" });
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

    // createGame 的入参是 ai_ids + human_count（不是 seats 数组）
    const created = await req("POST", "/games", {
      pace: "fast",
      ai_ids: localProfiles.slice(0, 6).map((p) => p.id),
      human_count: 0,
      assignment: "random",
    });
    ok(
      (created.status === 200 || created.status === 201) && created.json?.id,
      "POST /api/games 建局成功",
      `status=${created.status} body=${created.text.slice(0, 200)}`,
    );

    if (created.json?.id) {
      const gid = created.json.id;
      const started = await req("POST", `/games/${gid}/start`);
      ok(started.status === 200, "POST /api/games/:id/start 开局成功", started.text.slice(0, 200));

      // 模拟前端 2s 轮询：每次 GET 顺带把引擎往前推。
      //
      // events-list 每次返回的是**全量**事件，所以不能跨轮询累积比较 seq
      // （第二轮又从 seq 1 开始，会被误判成「回退 + 重复」）。
      // 这里分两层校验：
      //   单快照内：seq 严格递增、无重复、无空洞
      //   跨快照间：前一次快照必须是后一次的**前缀**
      // 第二条才是重放架构真正的命门——一旦重放把已落库的事件改写或重写，
      // 前缀就会破，而单看某一次快照是完全看不出来的。
      const digest = (e) => `${e.seq}|${e.type}|${JSON.stringify(e.payload ?? e.data ?? null)}`;

      let snapshotOk = true;
      let snapshotErr = "";
      let prefixOk = true;
      let prefixErr = "";
      let prevDigests = [];
      let finished = false;
      let evCount = 0;
      let lastSeq = -1;
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
        if (!Array.isArray(events)) continue;

        evCount = events.length;

        // ① 单快照自洽
        for (let k = 1; k < events.length; k++) {
          const a = events[k - 1].seq;
          const b = events[k].seq;
          if (typeof a !== "number" || typeof b !== "number") continue;
          if (b <= a) {
            snapshotOk = false;
            snapshotErr ||= `轮询 ${polls}：seq ${a} → ${b} 未严格递增`;
          } else if (b !== a + 1) {
            snapshotOk = false;
            snapshotErr ||= `轮询 ${polls}：seq ${a} → ${b} 之间有空洞`;
          }
        }
        if (events.length) lastSeq = events[events.length - 1].seq;

        // ② 跨快照前缀一致
        const digests = events.map(digest);
        for (let k = 0; k < prevDigests.length; k++) {
          if (digests[k] !== prevDigests[k]) {
            prefixOk = false;
            prefixErr ||= `轮询 ${polls}：第 ${k} 条事件被改写\n      旧: ${prevDigests[k]?.slice(0, 110)}\n      新: ${digests[k]?.slice(0, 110)}`;
            break;
          }
        }
        if (digests.length < prevDigests.length) {
          prefixOk = false;
          prefixErr ||= `轮询 ${polls}：事件数从 ${prevDigests.length} 缩到 ${digests.length}（事件被删了）`;
        }
        prevDigests = digests;

        if (events.some((e) => e.type === "game_over")) {
          finished = true;
          break;
        }
      }

      ok(!serverError, "轮询期间没有 5xx（Workers 未因 CPU 超时/异常挂掉）", serverError ?? "");
      ok(evCount > 0, "轮询能拿到事件（stepGame 在真实 Workers 里跑起来了）", `events=${evCount}`);
      ok(snapshotOk, "每次快照内 seq 严格递增、无重复、无空洞", snapshotErr);
      ok(prefixOk, "前一次快照始终是后一次的前缀（重放没有改写已落库事件）", prefixErr);
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
