// 后端端到端验证：创建「2 AI + 1 真人」对局，真人占座后由脚本模拟提交行动，确认引擎等待/唤醒/跑完。
const BASE = process.env.BASE_URL || "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profiles = await (await fetch(`${BASE}/api/ai-profiles`)).json();
  if (profiles.length < 2) throw new Error("AI 档案不足 2 个");
  const aiIds = profiles.slice(0, 5).map((p) => p.id);

  const created = await (
    await fetch(`${BASE}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_ids: aiIds, human_count: 1, mode: "auto", assignment: "random" }),
    })
  ).json();
  const gameId = created.id;
  const seat = created.humanInvites?.[0];
  if (!seat) throw new Error("未返回真人座位 token");
  console.log("创建对局 id=%d 真人座位=%d", gameId, seat.seat);

  const joined = await (
    await fetch(`${BASE}/api/games/${gameId}/seats/${seat.token}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "测试真人" }),
    })
  ).json();
  console.log("占座成功 seat=%d", joined.seat);

  await fetch(`${BASE}/api/games/${gameId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pace: "fast" }),
  });
  console.log("已开始（fast），模拟真人操作——");

  let turns = 0;
  for (let i = 0; i < 250; i++) {
    const view = await (await fetch(`${BASE}/api/games/${gameId}/seats/${seat.token}/view`)).json();
    if (view.status === "finished" || view.status === "aborted") {
      console.log("对局结束：%s, 第 %d 轮", view.status, view.round);
      break;
    }
    if (view.yourTurn) {
      turns++;
      let body = {};
      if (view.requiredAction === "day_speech" || view.requiredAction === "last_words") {
        body = { content: `真人回合#${turns}：我是好人，相信我` };
      } else if (view.requiredAction === "night_save") {
        body = {}; // 默认不救
      } else if (view.options && view.options.length) {
        const t = view.options[Math.floor(Math.random() * view.options.length)];
        body = { target_id: t.id };
      }
      const r = await (
        await fetch(`${BASE}/api/games/${gameId}/seats/${seat.token}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
      if (!r.ok) {
        console.error("提交行动失败：", r.error);
        break;
      }
      console.log("  · 真人行动 #%d %s 已提交", turns, view.requiredAction);
    }
    await sleep(350);
  }

  const events = await (await fetch(`${BASE}/api/games/${gameId}/events-list?after=0`)).json();
  const humanTurns = events.filter((e) => e.type === "human_turn").length;
  console.log("human_turn 事件数=%d, 总事件=%d", humanTurns, events.length);
  console.log(humanTurns > 0 && events.some((e) => e.type === "game_over") ? "PASS ✅" : "FAIL ❌");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
