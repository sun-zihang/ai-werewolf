/**
 * 无状态驱动器离线冒烟：用 node:sqlite 实现一个最小 D1 shim，
 * 在本机把 worker/ 里的整套逻辑（建局 → 开局 → 反复 stepGame → 终局 → 战报）跑完。
 *
 * 为什么必须有这一步：
 *   「回合快照 + 决策日志重放」的正确性依赖一个隐式不变式 —— 每次重放时 emit 顺序必须完全一致。
 *   一旦 emit 被条件分支包住，seq 就会错位、事件流撕裂。这类 bug 在生产上表现为「事件重复/丢失」，
 *   非常难查。所以在部署前必须本地跑一遍，逐条断言 seq 连续、无重复、无回退。
 *
 * 运行：server/node_modules/.bin/tsx scripts/driver-smoke.ts
 */
import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result, Env } from "../worker/env.js";
import { ensureSchema } from "../worker/schema.js";
import { createGame, startGame, getGameState, getGameEvents, getReport, getHumanView, submitHumanAction, joinHumanSeat } from "../worker/games.js";
import { stepGame } from "../worker/driver.js";

// ---------- D1 shim over node:sqlite ----------

class Stmt implements D1PreparedStatement {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Stmt(this.db, this.sql, values);
  }

  private norm(): unknown[] {
    // node:sqlite 不接受 boolean / undefined，统一归一化
    return this.args.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v));
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.norm() as never[])) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (colName ? (row[colName] as T) : (row as T)) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...(this.norm() as never[])) as T[];
    return { results: rows, success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const r = this.db.prepare(this.sql).run(...(this.norm() as never[]));
    return {
      results: [],
      success: true,
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid), duration: 0 },
    };
  }
}

class FakeD1 implements D1Database {
  constructor(private db: DatabaseSync) {}
  prepare(query: string): D1PreparedStatement {
    return new Stmt(this.db, query);
  }
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const out: D1Result<T>[] = [];
    this.db.exec("BEGIN");
    try {
      for (const s of statements) out.push((await s.run()) as D1Result<T>);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return out;
  }
  async exec(query: string) {
    this.db.exec(query);
    return { count: 1, duration: 0 };
  }
}

// ---------- 断言工具 ----------

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const db = new DatabaseSync(":memory:");
  const env: Env = {
    DB: new FakeD1(db),
    AWW_MASTER_KEY: "49c3fd6092cd59dc4e44c38d45d9f294f941d66d5f8c521716f307e83c4da9b1",
    // 故意设小，强制多次让出 + 重放，这样才能真正检验重放不变式。
    // 用 BUDGET=1 跑一遍可把重放次数拉到最大（每次轮询只做 1 个真实决策）。
    AWW_STEP_BUDGET: process.env.BUDGET ?? "3",
  };

  console.log("\n[1] 建表");
  await ensureSchema(env);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: Record<string, unknown>) => r.name as string);
  check("9 张表齐全", tables.length >= 9, tables.join(","));

  console.log("\n[2] 造 6 个本地规则引擎档案（无需 API Key）");
  for (let i = 1; i <= 6; i++) {
    db.prepare(
      "INSERT INTO ai_profiles (name, provider, model, thinking_level, language_style, avatar_style) VALUES (?, 'local', 'local-engine', 'medium', '自然', 'ink')"
    ).run(`本地${i}`);
  }
  const ids = db.prepare("SELECT id FROM ai_profiles ORDER BY id").all().map((r: Record<string, unknown>) => r.id as number);
  check("档案 6 个", ids.length === 6);

  console.log("\n[3] 全 AI 对局：建局 → 开局 → 轮询推进到终局");
  const created = await createGame(env, { ai_ids: ids, mode: "standard", assignment: "random" } as never);
  check("createGame 返回 id", created.id > 0, JSON.stringify(created));
  await startGame(env, created.id, "fast");

  const seen: number[] = [];
  let after = 0;
  let polls = 0;
  const started = Date.now();
  while (polls < 400) {
    polls += 1;
    await stepGame(env, created.id);
    const batch = await getGameEvents(env, created.id, after);
    for (const e of batch) {
      seen.push(e.seq);
      after = e.seq;
    }
    const state = (await getGameState(env, created.id)) as Record<string, unknown>;
    if (state.status === "finished" || state.status === "aborted") break;
  }
  const state = (await getGameState(env, created.id)) as Record<string, unknown>;
  check(`对局在 ${polls} 次轮询内结束`, state.status === "finished", String(state.status));
  check("有胜负结果", typeof state.winner === "string" && !!state.winner, JSON.stringify(state.winner));

  // 关键不变式校验
  const sorted = [...seen].sort((a, b) => a - b);
  check("事件 seq 单调递增（无回退）", seen.every((v, i) => i === 0 || v > seen[i - 1]));
  check("事件 seq 无重复", new Set(seen).size === seen.length, `${seen.length} vs ${new Set(seen).size}`);
  check("事件 seq 连续无空洞", sorted.every((v, i) => v === sorted[0] + i), `first=${sorted[0]} last=${sorted[sorted.length - 1]} n=${sorted.length}`);
  const dbSeqs = db
    .prepare("SELECT seq FROM game_events WHERE game_id=? ORDER BY seq")
    .all(created.id)
    .map((r: Record<string, unknown>) => r.seq as number);
  check("落库事件数 == 拉取事件数", dbSeqs.length === seen.length, `${dbSeqs.length} vs ${seen.length}`);
  check("有 game_over 事件", (await getGameEvents(env, created.id, 0)).some((e) => e.type === "game_over"));
  console.log(`  · 事件总数 ${seen.length}，回合 ${state.round}，耗时 ${Date.now() - started}ms`);

  console.log("\n[4] 战报");
  const report = await getReport(env, created.id);
  check("战报含 6 名玩家", Array.isArray(report.players) && report.players.length === 6, String((report.players as unknown[])?.length));
  check("战报有 winner", !!report.winner, String(report.winner));
  const statRow = db.prepare("SELECT stats_play_count, stats_win_count FROM ai_profiles WHERE id=?").get(ids[0]) as Record<string, unknown>;
  check("档案战绩已累加", Number(statRow.stats_play_count) === 1, JSON.stringify(statRow));

  console.log("\n[5] 真人局：占座 → 视角 → 提交行动 → 推进");
  // 角色随机分配，真人有概率首夜就被刀而从未轮到行动。重开几局直到覆盖到「真人行动」路径，
  // 否则这个用例会随机漏测（而不是发现 bug）。
  let h!: { id: number; humanInvites: { seat: number; token: string }[] };
  let token = "";
  let humanActed = 0;
  let hv: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 8 && humanActed === 0; attempt++) {
    h = await createGame(env, { ai_ids: ids.slice(0, 5), human_count: 1, mode: "standard", assignment: "random" } as never);
    token = h.humanInvites[0].token;
    await joinHumanSeat(env, h.id, token, "阿黄");
    await startGame(env, h.id, "fast");
    humanActed = 0;
    for (let i = 0; i < 400; i++) {
      await stepGame(env, h.id);
      const view = (await getHumanView(env, h.id, token)) as Record<string, unknown>;
      if (view.status === "finished" || view.status === "aborted") break;
      if (view.yourTurn) {
        const options = (view.options as { id: number }[] | undefined) ?? [];
        const action = String(view.requiredAction ?? "");
        const body: Record<string, unknown> =
          action === "speak" || action === "last_words"
            ? { action, content: "我是好人，听我说完。" }
            : { action, target_id: options.length ? options[0].id : null };
        await submitHumanAction(env, h.id, token, body);
        humanActed += 1;
      }
    }
    hv = (await getHumanView(env, h.id, token)) as Record<string, unknown>;
  }
  check("发出 1 个真人邀请", h.humanInvites.length === 1, JSON.stringify(h.humanInvites));
  check(`真人提交 ${humanActed} 次行动被接受`, humanActed > 0);
  check("真人局也能走到终局", hv.status === "finished", String(hv.status));
  const hSeqs = db
    .prepare("SELECT seq FROM game_events WHERE game_id=? ORDER BY seq")
    .all(h.id)
    .map((r: Record<string, unknown>) => r.seq as number);
  check("真人局事件 seq 连续", hSeqs.every((v, i) => v === hSeqs[0] + i), `n=${hSeqs.length}`);
  check("真人局姓名生效", JSON.stringify(hv).includes("阿黄"));

  console.log("\n[6] 真人超时托管（不提交任何行动）");
  // 同样重开几局，确保真的走到「等待真人 → 超时 → AI 托管」这条路径
  let t!: { id: number; humanInvites: { seat: number; token: string }[] };
  let timedOut = false;
  for (let attempt = 0; attempt < 8 && !timedOut; attempt++) {
    t = await createGame(env, { ai_ids: ids.slice(0, 5), human_count: 1, mode: "standard", assignment: "random" } as never);
    await joinHumanSeat(env, t.id, t.humanInvites[0].token, "闷葫芦");
    await startGame(env, t.id, "fast");
    for (let i = 0; i < 400; i++) {
      await stepGame(env, t.id);
      const row = db.prepare("SELECT pending_json, snapshot FROM game_runtime WHERE game_id=?").get(t.id) as Record<string, unknown>;
      const snap = JSON.parse(String(row.snapshot)) as { status: string };
      if (snap.status === "finished" || snap.status === "aborted") break;
      if (row.pending_json) {
        // 手动把 deadline 拨到过去，模拟等待超时（而不是真的睡 45s）
        const pending = JSON.parse(String(row.pending_json)) as { deadline: number };
        pending.deadline = Date.now() - 1000;
        db.prepare("UPDATE game_runtime SET pending_json=? WHERE game_id=?").run(JSON.stringify(pending), t.id);
        timedOut = true;
      }
    }
  }
  const tState = (await getGameState(env, t.id)) as Record<string, unknown>;
  check("曾进入等待真人状态", timedOut);
  check("超时托管后对局仍能终局", tState.status === "finished", String(tState.status));
  const autoNote = (await getGameEvents(env, t.id, 0)).some((e) => JSON.stringify(e).includes("自动托管"));
  check("有「自动托管」系统提示", autoNote);
  const tSeqs = db
    .prepare("SELECT seq FROM game_events WHERE game_id=? ORDER BY seq")
    .all(t.id)
    .map((r: Record<string, unknown>) => r.seq as number);
  check("托管局事件 seq 连续", tSeqs.every((v, i) => v === tSeqs[0] + i), `n=${tSeqs.length}`);

  console.log("\n[7] 并发保护：同时 5 个 stepGame 不应把 seq 搞乱");
  const c = await createGame(env, { ai_ids: ids, mode: "standard", assignment: "random" } as never);
  await startGame(env, c.id, "fast");
  for (let i = 0; i < 200; i++) {
    await Promise.all([stepGame(env, c.id), stepGame(env, c.id), stepGame(env, c.id), stepGame(env, c.id), stepGame(env, c.id)]);
    const s = (await getGameState(env, c.id)) as Record<string, unknown>;
    if (s.status === "finished" || s.status === "aborted") break;
  }
  const cSeqs = db
    .prepare("SELECT seq FROM game_events WHERE game_id=? ORDER BY seq")
    .all(c.id)
    .map((r: Record<string, unknown>) => r.seq as number);
  const cState = (await getGameState(env, c.id)) as Record<string, unknown>;
  check("并发下仍能终局", cState.status === "finished", String(cState.status));
  check("并发下事件 seq 连续", cSeqs.every((v, i) => v === cSeqs[0] + i), `n=${cSeqs.length}`);

  console.log(`\n${failures === 0 ? "全部通过 ✅" : `${failures} 项失败 ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n驱动器冒烟异常：", e);
  process.exit(1);
});
