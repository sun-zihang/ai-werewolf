import {
  WerewolfGame,
  type EnginePlayer,
  type EngineSnapshot,
  type PaceKey,
  resolvePace,
} from "../server/lib/engine/engine.js";
import { decide, type AiProfileRuntime } from "../server/lib/ai/middleware.js";
import type { DecisionInput, DecisionOutput, GameEvent, GameMode } from "../server/lib/types.js";
import type { Env } from "./env.js";
import { decryptSecret } from "./webcrypto.js";

/**
 * 无状态对局驱动器：把「常驻进程 + 内存引擎」换成「回合快照 + 决策日志重放」。
 *
 * 为什么这样设计
 *  - Cloudflare Workers 没有常驻内存，而本项目的引擎是一个长跑的 async 状态机；
 *  - Durable Objects 在当前账号 token 下不可用，只能靠 D1；
 *  - 直接把引擎改写成显式状态机代价极大且容易和现有玩法逻辑分叉。
 *
 * 于是：每次前端轮询触发一次 stepGame()
 *  1. 读取「本回合起点快照」并 restore 引擎；
 *  2. 重放本回合已记录的决策日志（纯 CPU，不发网络请求），把引擎推回上次中断的位置；
 *  3. 继续往前跑，最多做 budget 次「真实决策」（调用 LLM），然后抛出让出信号；
 *  4. 把新事件 + 新日志落库；回合跑完则写新快照并清空该回合的日志游标。
 *
 * 重放只回溯到「当前回合起点」，所以单次 CPU 开销与回合内决策数（约 20~30）成正比，
 * 不会随对局长度增长。
 *
 * 不变式（改代码时务必遵守）：
 *  引擎里所有 emit 必须在每一次重放中无条件发生，只有「日志消费」才允许分支。
 *  否则 seq 会错位，事件流会撕裂。
 */

class YieldBudget extends Error {}
class PendingHumanSignal extends Error {}

/** 日志条目：决策结果 + 可选的附带系统提示（重放时一并补发，保证 seq 对齐） */
interface JournalEntry {
  out: DecisionOutput;
  note?: string;
}

interface PendingInfo {
  round: number;
  idx: number;
  seat: number;
  action: string;
  label: string;
  deadline: number;
}

interface RuntimeRow {
  game_id: number;
  snapshot: string;
  max_seq: number;
  pace: string;
  paused: number;
  pending_json: string | null;
  lock_until: number;
}

interface SessionRow {
  id: number;
  mode: string;
  assignment: string;
  status: string;
}

interface MappingRow {
  seat: number;
  profile_id: number;
  role: string;
  team: string;
  alive: number;
  thinking_level: string;
  is_human: number;
  human_name: string | null;
}

interface ProfileRow {
  id: number;
  name: string;
  provider: string;
  model: string;
  base_url_override: string | null;
  api_key_enc: string | null;
  thinking_level: string;
  avatar_style: string | null;
}

const LOCK_MS = 30_000;

/** 节奏 → 单次推进允许的真实决策数。前端每 2s 轮询一次，据此换算出观感节奏 */
function budgetFor(pace: string, override?: string): number {
  const n = Number(override);
  if (Number.isFinite(n) && n > 0) return Math.min(12, Math.floor(n));
  if (pace === "fast") return 4;
  if (pace === "normal") return 2;
  return 1;
}

function humanTimeoutFor(pace: string): number {
  if (pace === "fast") return 45_000;
  if (pace === "normal") return 90_000;
  return 120_000;
}

export async function getRuntime(env: Env, gameId: number): Promise<RuntimeRow | null> {
  return env.DB.prepare("SELECT * FROM game_runtime WHERE game_id=?").bind(gameId).first<RuntimeRow>();
}

export async function loadMappings(env: Env, gameId: number): Promise<MappingRow[]> {
  const r = await env.DB.prepare("SELECT * FROM game_ai_mapping WHERE game_id=? ORDER BY seat").bind(gameId).all<MappingRow>();
  return r.results ?? [];
}

export async function loadProfiles(env: Env, ids: number[]): Promise<Map<number, ProfileRow>> {
  const uniq = [...new Set(ids.filter((n) => n > 0))];
  const map = new Map<number, ProfileRow>();
  if (!uniq.length) return map;
  const placeholders = uniq.map(() => "?").join(",");
  const r = await env.DB.prepare(`SELECT * FROM ai_profiles WHERE id IN (${placeholders})`).bind(...uniq).all<ProfileRow>();
  for (const row of r.results ?? []) map.set(row.id, row);
  return map;
}

/** 用快照重建引擎（不做任何决策，仅供读取视图 / 私密信息 / 存活列表） */
export function buildEngine(
  session: SessionRow,
  mappings: MappingRow[],
  profiles: Map<number, ProfileRow>,
  snapshot: EngineSnapshot | null,
  hooks?: Partial<{
    emit: (e: GameEvent) => void;
    decide: (i: DecisionInput) => Promise<DecisionOutput>;
    humanDecide: (p: EnginePlayer, a: DecisionInput["requiredAction"], l: string) => Promise<DecisionOutput>;
  }>
): { engine: WerewolfGame; players: EnginePlayer[] } {
  const players: EnginePlayer[] = mappings.map((m) => {
    const profile = m.is_human ? undefined : profiles.get(m.profile_id);
    return {
      id: m.seat,
      profileId: m.profile_id,
      name: m.human_name ?? (m.is_human ? `真人${m.seat}` : profile?.name ?? `玩家${m.seat}`),
      seat: m.seat,
      role: m.role as EnginePlayer["role"],
      team: m.team as EnginePlayer["team"],
      alive: !!m.alive,
      thinkingLevel: (m.thinking_level ?? profile?.thinking_level ?? "medium") as EnginePlayer["thinkingLevel"],
      avatarStyle: profile?.avatar_style ?? "ink",
      canVote: true,
      idiotFlipped: false,
      witchAntidote: m.role === "witch",
      witchPoison: m.role === "witch",
      speechCount: 0,
      tokensUsed: 0,
      votesReceived: 0,
      isHuman: !!m.is_human,
    };
  });

  const engine = new WerewolfGame({
    players,
    mode: session.mode as GameMode,
    assignment: session.assignment,
    validateRoles: false, // 角色组成在建局时已校验，这里避免历史对局因规则调整而无法读取
    pace: undefined, // 无 sleep：节奏由「每次轮询推进 budget 次决策」提供
    emit: hooks?.emit ?? (() => {}),
    decide: hooks?.decide ?? (async () => ({ action: "noop" })),
    humanDecide: hooks?.humanDecide ?? (async () => ({ action: "noop" })),
    validate: () => null,
    onTokens: () => {},
  });
  if (snapshot) engine.restore(snapshot);
  return { engine, players };
}

function validateDecision(engine: WerewolfGame, action: string, out: DecisionOutput): string | null {
  if (out.target_id !== null && out.target_id !== undefined) {
    if (!Number.isInteger(out.target_id)) return "目标 id 必须是整数";
    try {
      const t = engine.byId(out.target_id);
      if (!t.alive) return "目标已死亡";
    } catch {
      return "目标不存在";
    }
  }
  if (action === "speak" || action === "last_words") {
    if (typeof out.content !== "string" || !out.content.trim()) return "发言内容不能为空";
    if (out.content.length > 300) return "发言过长";
  }
  return null;
}

/**
 * 推进一步。可被任意读接口安全地重复调用：
 * 通过 game_runtime.lock_until 做乐观互斥，同一时刻只有一个请求真正推进。
 */
export async function stepGame(env: Env, gameId: number): Promise<void> {
  const rt = await getRuntime(env, gameId);
  if (!rt || rt.paused) return;

  let snapshot: EngineSnapshot;
  try {
    snapshot = JSON.parse(rt.snapshot) as EngineSnapshot;
  } catch {
    return;
  }
  if (snapshot.status === "finished" || snapshot.status === "aborted") return;

  const now = Date.now();
  const lock = await env.DB
    .prepare("UPDATE game_runtime SET lock_until=? WHERE game_id=? AND lock_until<?")
    .bind(now + LOCK_MS, gameId, now)
    .run();
  if (!lock.meta?.changes) return; // 另一个请求正在推进

  try {
    await advance(env, gameId, rt, snapshot);
  } finally {
    await env.DB.prepare("UPDATE game_runtime SET lock_until=0 WHERE game_id=?").bind(gameId).run();
  }
}

async function advance(env: Env, gameId: number, rt: RuntimeRow, snapshot: EngineSnapshot): Promise<void> {
  const session = await env.DB.prepare("SELECT id, mode, assignment, status FROM game_sessions WHERE id=?").bind(gameId).first<SessionRow>();
  if (!session) return;
  const mappings = await loadMappings(env, gameId);
  const profiles = await loadProfiles(env, mappings.map((m) => m.profile_id));

  const round = snapshot.round;
  const journalRes = await env.DB
    .prepare("SELECT idx, payload FROM game_journal WHERE game_id=? AND round=? ORDER BY idx")
    .bind(gameId, round)
    .all<{ idx: number; payload: string }>();
  const journal: JournalEntry[] = (journalRes.results ?? []).map((r) => JSON.parse(r.payload) as JournalEntry);

  const inboxRes = await env.DB
    .prepare("SELECT idx, payload FROM human_inbox WHERE game_id=? AND round=?")
    .bind(gameId, round)
    .all<{ idx: number; payload: string }>();
  const inbox = new Map<number, DecisionOutput>();
  for (const r of inboxRes.results ?? []) inbox.set(r.idx, JSON.parse(r.payload) as DecisionOutput);

  const prevPending: PendingInfo | null = rt.pending_json ? (JSON.parse(rt.pending_json) as PendingInfo) : null;
  const pace = rt.pace;
  const budget = budgetFor(pace, env.AWW_STEP_BUDGET);
  const humanTimeoutMs = humanTimeoutFor(pace);

  const newEvents: GameEvent[] = [];
  const newJournal: { idx: number; payload: string }[] = [];
  let cursor = 0;
  let spent = 0;
  let pending: PendingInfo | null = null;
  let maxSeq = rt.max_seq;

  let engineRef!: WerewolfGame;

  const runtimeFor = (p: EnginePlayer): AiProfileRuntime => {
    const row = profiles.get(p.profileId);
    return {
      id: p.profileId,
      provider: row?.provider ?? "local",
      model: row?.model ?? "local-engine",
      base_url_override: row?.base_url_override ?? undefined,
      api_key_enc: row?.api_key_enc ?? null,
      thinking_level: p.thinkingLevel,
    };
  };

  /** 消费一条日志（含补发附带提示），没有则返回 null */
  const takeJournal = (): DecisionOutput | null => {
    if (cursor >= journal.length) return null;
    const entry = journal[cursor];
    cursor += 1;
    if (entry.note) engineRef.systemNote(entry.note);
    return entry.out;
  };

  const pushJournal = (out: DecisionOutput, note?: string) => {
    const entry: JournalEntry = note ? { out, note } : { out };
    newJournal.push({ idx: cursor, payload: JSON.stringify(entry) });
    journal.push(entry);
    cursor += 1;
    if (note) engineRef.systemNote(note);
  };

  const built = buildEngine(session, mappings, profiles, null, {
    emit: (e) => {
      if (e.seq > rt.max_seq) {
        newEvents.push(e);
        if (e.seq > maxSeq) maxSeq = e.seq;
      }
    },
    decide: async (input) => {
      const fromLog = takeJournal();
      if (fromLog) return fromLog;
      if (spent >= budget) throw new YieldBudget();
      const p = built.players.find((x) => x.id === input.player.id)!;
      const out = await decide({
        profile: runtimeFor(p),
        input,
        validate: (o) => validateDecision(engineRef, input.requiredAction, o),
        decryptKey: (enc) => decryptSecret(env, enc),
        onTokens: (usage) => {
          p.tokensUsed += usage.totalTokens ?? 0;
        },
      });
      spent += 1;
      pushJournal(out);
      return out;
    },
    humanDecide: async (player, requiredAction, phaseLabel) => {
      // 到达真人决策点时无条件补发 human_turn：重放时 seq 相同会被过滤，保证事件流不撕裂
      engineRef.emitHumanTurn(player, requiredAction, phaseLabel);
      const fromLog = takeJournal();
      if (fromLog) return fromLog;

      const submitted = inbox.get(cursor);
      if (submitted) {
        pushJournal(submitted);
        return submitted;
      }

      const sameSlot = prevPending && prevPending.round === round && prevPending.idx === cursor;
      const deadline = sameSlot ? prevPending!.deadline : Date.now() + humanTimeoutMs;
      if (sameSlot && Date.now() > deadline) {
        const auto = engineRef.autoDecisionFor(player, requiredAction, phaseLabel);
        pushJournal(auto, `${player.name}（真人）超时未操作，已由 AI 自动托管`);
        return auto;
      }
      pending = { round, idx: cursor, seat: player.seat, action: requiredAction, label: phaseLabel, deadline };
      throw new PendingHumanSignal();
    },
  });
  engineRef = built.engine;
  engineRef.restore(snapshot);

  let roundOver = false;
  let interrupted = false;
  try {
    roundOver = await engineRef.runOneRound();
  } catch (e) {
    if (e instanceof YieldBudget || e instanceof PendingHumanSignal) {
      interrupted = true;
    } else {
      // 未预期的异常：记一条系统事件并中止，避免对局悄悄卡死
      const msg = (e as Error)?.message ?? String(e);
      engineRef.systemNote(`推进异常，对局已中止：${msg}`.slice(0, 200));
      engineRef.abort();
      roundOver = true;
    }
  }

  const stmts = [];
  for (const e of newEvents) {
    stmts.push(
      env.DB.prepare("INSERT OR IGNORE INTO game_events (game_id, seq, payload) VALUES (?, ?, ?)").bind(gameId, e.seq, JSON.stringify(e))
    );
  }
  for (const j of newJournal) {
    stmts.push(
      env.DB.prepare("INSERT OR IGNORE INTO game_journal (game_id, round, idx, payload) VALUES (?, ?, ?, ?)").bind(gameId, round, j.idx, j.payload)
    );
  }

  // 中途让出时保持「回合起点快照」不变，只追加日志；回合跑完才推进快照
  const nextSnapshot = interrupted ? snapshot : engineRef.snapshot();
  const finished = nextSnapshot.status === "finished" || nextSnapshot.status === "aborted";
  stmts.push(
    env.DB
      .prepare("UPDATE game_runtime SET snapshot=?, max_seq=?, pending_json=?, updated_at=? WHERE game_id=?")
      .bind(JSON.stringify(nextSnapshot), maxSeq, pending ? JSON.stringify(pending) : null, Date.now(), gameId)
  );
  stmts.push(
    env.DB.prepare("UPDATE game_sessions SET status=?, rounds=?, winner=?, reason=? WHERE id=?").bind(
      finished ? (nextSnapshot.status === "finished" ? "finished" : "aborted") : "running",
      nextSnapshot.round,
      nextSnapshot.winner ?? null,
      nextSnapshot.reason ?? null,
      gameId
    )
  );
  if (finished) {
    stmts.push(env.DB.prepare("UPDATE game_sessions SET finished_at=datetime('now') WHERE id=? AND finished_at IS NULL").bind(gameId));
  }

  await env.DB.batch(stmts);
  if (finished) await finalizeGame(env, gameId, nextSnapshot);
  void roundOver;
}

/** 对局结束：回写座位战绩与档案累计统计 */
export async function finalizeGame(env: Env, gameId: number, snap: EngineSnapshot): Promise<void> {
  const winnerTeam = snap.winner;
  const aliveWinners = snap.players.filter((p) => p.alive && p.team === winnerTeam);
  const mvpId = aliveWinners.length ? [...aliveWinners].sort((a, b) => b.speechCount - a.speechCount)[0].id : null;

  const stmts = [];
  for (const p of snap.players) {
    const win = winnerTeam && p.team === winnerTeam ? 1 : 0;
    const mvp = p.id === mvpId ? 1 : 0;
    stmts.push(
      env.DB
        .prepare("UPDATE game_ai_mapping SET alive=?, win=?, mvp=?, speech_count=?, tokens_used=? WHERE game_id=? AND seat=?")
        .bind(p.alive ? 1 : 0, win, mvp, p.speechCount, p.tokensUsed, gameId, p.seat)
    );
    if (p.profileId > 0) {
      stmts.push(
        env.DB
          .prepare(
            "UPDATE ai_profiles SET stats_play_count=stats_play_count+1, stats_win_count=stats_win_count+?, stats_mvp_count=stats_mvp_count+?, total_tokens_used=total_tokens_used+?, updated_at=datetime('now') WHERE id=?"
          )
          .bind(win, mvp, p.tokensUsed, p.profileId)
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

export { budgetFor, humanTimeoutFor, resolvePace };
export type { PaceKey, PendingInfo, RuntimeRow, SessionRow, MappingRow, ProfileRow };
