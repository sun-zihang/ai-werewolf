// 端到端校验：通过公网 Cloudflare Tunnel 地址开一局，
// 用「轮询 events-list」路径（抗 SSE 缓冲）实时收集事件，确认上帝视角夜间行动可达。
const BASE = process.env.BASE_URL ?? "https://induced-characterization-theta-classic.trycloudflare.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const names = ["小灰", "月影", "青苔", "阿狸", "白露"];
  const ids = [];
  for (const n of names) {
    const r = await fetch(`${BASE}/api/ai-profiles`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n, provider: "local", model: "local-engine", thinking_level: "medium", description: `${n} 规则引擎` }),
    });
    ids.push((await r.json()).id);
  }
  console.log("创建本地 AI:", ids.join(","));

  const g = await fetch(`${BASE}/api/games`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ai_ids: ids, mode: "standard", assignment: "random" }),
  });
  const gameId = (await g.json()).id;
  console.log("对局 #" + gameId);

  await fetch(`${BASE}/api/games/${gameId}/start`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pace: process.env.PACE ?? "fast" }),
  });

  // 轮询 events-list（模拟前端 2s 轮询，这里用 1s 更灵敏），观察实时增量
  const types = {};
  let secretSeen = 0;
  let firstSeenAt = null;
  const t0 = Date.now();
  let after = 0;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${BASE}/api/games/${gameId}/events-list?after=${after}`);
    const evts = await res.json();
    if (evts.length) {
      if (firstSeenAt === null) firstSeenAt = Date.now() - t0;
      for (const e of evts) {
        types[e.type] = (types[e.type] ?? 0) + 1;
        if (e.secret) secretSeen++;
        after = Math.max(after, e.seq);
      }
    }
    const st = await (await fetch(`${BASE}/api/games/${gameId}`)).json();
    if (st.status === "finished") { console.log(`对局于第 ${i + 1} 次轮询后结束`); break; }
    await sleep(1000);
  }
  console.log("首个事件到达延迟:", firstSeenAt === null ? "无" : firstSeenAt + "ms");
  console.log("事件类型统计:", JSON.stringify(types));
  console.log("上帝视角机密事件(夜间行动)数量:", secretSeen);
  if (secretSeen > 0) console.log("✅ 上帝视角实时事件流通过公网隧道（轮询路径）正常");
  else console.log("⚠️ 未捕获到机密夜间行动事件");
}
main().catch((e) => { console.error("校验失败:", e.message); process.exitCode = 1; });
