// 计时探针：用 slow 档开局，验证相邻夜间行动的停顿≈真人节奏（night=4000ms，phaseGap=3500ms）
const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const names = ["甲", "乙", "丙", "丁", "戊"];
  const ids = [];
  for (const n of names) {
    const r = await fetch(`${BASE}/api/ai-profiles`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, provider: "local", model: "local-engine", thinking_level: "medium" }),
    });
    ids.push((await r.json()).id);
  }
  const g = await fetch(`${BASE}/api/games`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ai_ids: ids, mode: "standard", assignment: "random" }),
  });
  const gameId = (await g.json()).id;
  console.log("对局 #" + gameId + " (slow 档)");

  await fetch(`${BASE}/api/games/${gameId}/start`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pace: "slow" }),
  });

  const marks = {}; // type -> [ts...]
  let after = 0;
  let startedTs = null;
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    const res = await fetch(`${BASE}/api/games/${gameId}/events-list?after=${after}`);
    const evts = await res.json();
    for (const e of evts) {
      after = Math.max(after, e.seq);
      if (e.type === "game_started") startedTs = e.ts;
      if (e.type === "night_action") (marks.night_action ??= []).push(e.ts);
    }
    // 抓到 3 条夜间行动即可测间隔
    if ((marks.night_action?.length ?? 0) >= 3) break;
    if (Date.now() - t0 > 40000) break;
    await sleep(200);
  }

  const na = marks.night_action ?? [];
  if (startedTs !== null && na.length >= 1) {
    const gapToFirst = na[0] - startedTs;
    console.log(`game_started → 首个夜间行动 间隔: ${gapToFirst}ms (期望≈3500ms phaseGap)`);
  }
  if (na.length >= 2) {
    const gap = na[1] - na[0];
    console.log(`相邻两次夜间行动 间隔: ${gap}ms (期望≈4000ms night)`);
    if (gap >= 3000) console.log("✅ 真人节奏生效：夜间行动之间留出了从容的思考停顿");
    else console.log("⚠️ 间隔偏短，未达真人节奏");
  } else {
    console.log("⚠️ 未在窗口内捕获到足够夜间行动");
  }
  // 收尾：中止避免占用
  await fetch(`${BASE}/api/games/${gameId}/abort`, { method: "POST" }).catch(() => {});
}
main().catch((e) => { console.error("探针失败:", e.message); process.exitCode = 1; });
