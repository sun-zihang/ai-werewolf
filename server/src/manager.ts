import { EventEmitter } from "node:events";
import { Db } from "./db.js";
import {
  AiProfilePublic,
  DecisionInput,
  DecisionOutput,
  GameConfigInput,
  GameEvent,
  GameMode,
  GameReport,
  PlayerView,
  Role,
  ROLE_LABEL,
  Team,
  ThinkingLevel,
} from "./types.js";
import { compositionFor, ROLE_COMPLEXITY, ROLE_TEAM } from "./engine/roles.js";
import { WerewolfGame, EnginePlayer, resolveMode, PaceKey, PaceProfile, resolvePace } from "./engine/engine.js";
import { decryptSecret } from "./crypto.js";
import { decide, AiProfileRuntime } from "./ai/middleware.js";

interface RunningGame {
  gameId: number;
  engine: WerewolfGame;
  events: GameEvent[];
  emitter: EventEmitter;
  pace: PaceProfile;
}

const running = new Map<number, RunningGame>();
const LEVEL_SCORE: Record<ThinkingLevel, number> = { paper: 0, medium: 1, high: 2, extra: 3 };

export function listRunning(): number[] {
  return [...running.keys()];
}

// ---------- 档案查询 ----------
function getProfileRow(db: Db, id: number): any {
  return db.prepare("SELECT * FROM ai_profiles WHERE id = ?").get(id);
}

export function profileToPublic(row: any): AiProfilePublic {
  const play = row.stats_play_count || 0;
  const win = row.stats_win_count || 0;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_label: row.provider,
    model: row.model,
    base_url_override: row.base_url_override ?? null,
    thinking_level: row.thinking_level,
    role_preference: safeJson(row.role_preference, []),
    language_style: row.language_style,
    avatar_style: row.avatar_style,
    description: row.description ?? "",
    has_key: !!row.api_key_enc,
    stats_win_rate: play > 0 ? Math.round((win / play) * 1000) / 10 : 0,
    stats_play_count: play,
    stats_mvp_count: row.stats_mvp_count || 0,
    total_tokens_used: row.total_tokens_used || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function safeJson(s: string, fallback: any): any {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// ---------- 创建对局 ----------
export function createGame(db: Db, input: GameConfigInput): number {
  const ids = [...new Set(input.ai_ids)];
  if (ids.length < 2 || ids.length > 12) throw new Error("AI 数量需在 2-12 之间");
  const profiles = ids.map((id) => {
    const row = getProfileRow(db, id);
    if (!row) throw new Error(`AI 档案 ${id} 不存在`);
    return row;
  });
  const mode = resolveMode(ids.length, input.mode);
  const roles = compositionFor(ids.length, mode);
  const players = assignRoles(profiles, roles, input.assignment, input.overrides ?? {});

  const config = JSON.stringify({ ...input, mode, resolvedRoles: players.map((p) => p.role) });
  const info = db
    .prepare("INSERT INTO game_sessions (config_json, status, mode, assignment) VALUES (?, 'created', ?, ?)")
    .run(config, mode, input.assignment);
  const gameId = Number(info.lastInsertRowid);

  const ins = db.prepare(
    "INSERT INTO game_ai_mapping (game_id, profile_id, seat, role, team, alive, thinking_level) VALUES (?, ?, ?, ?, ?, 1, ?)"
  );
  for (const p of players) {
    ins.run(gameId, p.profileId, p.seat, p.role, ROLE_TEAM[p.role], p.thinkingLevel);
  }
  return gameId;
}

function assignRoles(
  profiles: any[],
  roles: Role[],
  assignment: string,
  overrides: Record<string, ThinkingLevel>
): EnginePlayer[] {
  const seatOrder = profiles.map((p, i) => ({ p, seat: i + 1 }));
  const build = (p: any, seat: number, role: Role): EnginePlayer => ({
    id: seat,
    profileId: p.id,
    name: p.name,
    seat,
    role,
    team: ROLE_TEAM[role],
    alive: true,
    thinkingLevel: overrides[String(p.id)] ?? p.thinking_level ?? "medium",
    avatarStyle: p.avatar_style ?? "ink",
    canVote: true,
    idiotFlipped: false,
    witchAntidote: role === "witch",
    witchPoison: role === "witch",
    speechCount: 0,
    tokensUsed: 0,
    votesReceived: 0,
  });

  const roleList = [...roles];
  if (assignment === "random") {
    shuffle(roleList);
  } else if (assignment === "strength") {
    // 角色按复杂度降序，玩家按强度降序，一一对应
    const sortedRoles = [...roles].sort((a, b) => ROLE_COMPLEXITY[b] - ROLE_COMPLEXITY[a]);
    const sortedPlayers = [...seatOrder].sort(
      (a, b) => LEVEL_SCORE[overrides[String(b.p.id)] ?? b.p.thinking_level ?? "medium"] - LEVEL_SCORE[overrides[String(a.p.id)] ?? a.p.thinking_level ?? "medium"]
    );
    return sortedPlayers.map(({ p, seat }, i) => build(p, seat, sortedRoles[i] ?? "villager"));
  } else {
    // preference：按角色偏好优先分配
    const result = new Map<number, Role>();
    const pool = [...roleList];
    const byPref: { p: any; seat: number; prefs: Role[] }[] = seatOrder.map(({ p, seat }) => ({
      p,
      seat,
      prefs: safeJson(p.role_preference ?? "[]", []),
    }));
    // 第一轮：每人取第一个还剩余的偏好角色
    for (const item of byPref) {
      const pref = item.prefs.find((r: Role) => pool.includes(r));
      if (pref) {
        result.set(item.p.seat, pref);
        pool.splice(pool.indexOf(pref), 1);
      }
    }
    shuffle(pool);
    for (const item of byPref) {
      if (!result.has(item.p.seat)) {
        result.set(item.p.seat, pool.pop()!);
      }
    }
    return seatOrder.map(({ p, seat }) => build(p, seat, result.get(seat)!));
  }
  return seatOrder.map(({ p, seat }, i) => build(p, seat, roleList[i]));
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- 启动对局 ----------
export async function startGame(db: Db, gameId: number, pace: PaceKey | number = "slow"): Promise<void> {
  const paceProfile = resolvePace(pace);
  if (running.has(gameId)) return;
  const session: any = db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(gameId);
  if (!session) throw new Error("对局不存在");
  if (session.status === "finished" || session.status === "aborted") throw new Error("对局已结束");

  const mappings: any[] = db
    .prepare("SELECT * FROM game_ai_mapping WHERE game_id = ? ORDER BY seat")
    .all(gameId);
  const players: EnginePlayer[] = mappings.map((m) => {
    const profile = getProfileRow(db, m.profile_id);
    return {
      id: m.seat,
      profileId: m.profile_id,
      name: profile?.name ?? `玩家${m.seat}`,
      seat: m.seat,
      role: m.role,
      team: m.team,
      alive: !!m.alive,
      thinkingLevel: m.thinking_level ?? profile?.thinking_level ?? "medium",
      avatarStyle: profile?.avatar_style ?? "ink",
      canVote: true,
      idiotFlipped: false,
      witchAntidote: m.role === "witch",
      witchPoison: m.role === "witch",
      speechCount: 0,
      tokensUsed: 0,
      votesReceived: 0,
    };
  });

  const emitter = new EventEmitter();
  const events: GameEvent[] = [];
  const sink = (evt: GameEvent) => {
    events.push(evt);
    db.prepare("INSERT INTO game_events (game_id, seq, payload) VALUES (?, ?, ?)").run(gameId, evt.seq, JSON.stringify(evt));
    emitter.emit("event", evt);
  };

  let engine!: WerewolfGame;
  const runtime = (p: EnginePlayer): AiProfileRuntime => {
    const row = getProfileRow(db, p.profileId);
    return {
      id: p.profileId,
      provider: row?.provider ?? "local",
      model: row?.model ?? "local-engine",
      base_url_override: row?.base_url_override ?? undefined,
      api_key_enc: row?.api_key_enc ?? null,
      thinking_level: p.thinkingLevel,
    };
  };

  engine = new WerewolfGame({
    players,
    mode: session.mode as GameMode,
    assignment: session.assignment,
    emit: sink,
    pace: paceProfile,
    decide: async (input: DecisionInput): Promise<DecisionOutput> => {
      const p = players.find((x) => x.id === input.player.id)!;
      const profile = runtime(p);
      const out = await decide({
        profile,
        input,
        validate: (o) => validateDecision(engine, input.player.id, input.requiredAction, o),
        onTokens: (usage) => {
          p.tokensUsed += usage.totalTokens ?? 0;
        },
      });
      return out;
    },
    validate: (action, out) => validateDecision(engine, 0, action as any, out),
    onTokens: (playerId, usage) => {
      const p = players.find((x) => x.id === playerId);
      if (p) p.tokensUsed += usage.totalTokens ?? 0;
    },
  });

  const rg: RunningGame = { gameId, engine, events, emitter, pace: paceProfile };
  running.set(gameId, rg);

  db.prepare("UPDATE game_sessions SET status='running', started_at=datetime('now','localtime') WHERE id=?").run(gameId);

  engine.run().finally(() => {
    finalizeGame(db, gameId, rg);
    // 结束 1 分钟后从内存移除
    setTimeout(() => {
      if (running.get(gameId) === rg) running.delete(gameId);
    }, 60_000);
  });
}

function validateDecision(engine: WerewolfGame, selfId: number, action: string, out: DecisionOutput): string | null {
  if (out.target_id !== null && out.target_id !== undefined) {
    if (!Number.isInteger(out.target_id)) return "目标 id 必须是整数";
    const t = engine.byId(out.target_id);
    if (!t) return "目标不存在";
    if (!t.alive) return "目标已死亡";
  }
  if (action === "speak" || action === "last_words") {
    if (typeof out.content !== "string" || !out.content.trim()) return "发言内容不能为空";
    if (out.content.length > 300) return "发言过长";
  }
  return null;
}

// ---------- 结算 ----------
function finalizeGame(db: Db, gameId: number, rg: RunningGame) {
  const engine = rg.engine;
  const status = engine.status === "finished" ? "finished" : "aborted";
  db.prepare(
    "UPDATE game_sessions SET status=?, winner=?, reason=?, rounds=?, finished_at=datetime('now','localtime') WHERE id=?"
  ).run(status, engine.winner ?? null, engine.reason ?? null, engine.round, gameId);

  const winnerTeam = engine.winner;
  const aliveWinners = engine.players.filter((p) => p.alive && p.team === winnerTeam);
  const mvpId =
    aliveWinners.length > 0
      ? [...aliveWinners].sort((a, b) => b.speechCount - a.speechCount)[0].id
      : null;

  const upd = db.prepare(
    "UPDATE game_ai_mapping SET alive=?, win=?, mvp=?, speech_count=?, tokens_used=? WHERE game_id=? AND seat=?"
  );
  const updProfile = db.prepare(
    "UPDATE ai_profiles SET stats_play_count=stats_play_count+1, stats_win_count=stats_win_count+?, stats_mvp_count=stats_mvp_count+?, total_tokens_used=total_tokens_used+?, updated_at=datetime('now','localtime') WHERE id=?"
  );
  for (const p of engine.players) {
    const win = winnerTeam && p.team === winnerTeam ? 1 : 0;
    const mvp = p.id === mvpId ? 1 : 0;
    upd.run(p.alive ? 1 : 0, win, mvp, p.speechCount, p.tokensUsed, gameId, p.seat);
    updProfile.run(win, mvp, p.tokensUsed, p.profileId);
  }
}

// ---------- 查询 ----------
export function getGameState(db: Db, gameId: number): any {
  const session: any = db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(gameId);
  if (!session) throw new Error("对局不存在");
  const mappings: any[] = db.prepare("SELECT * FROM game_ai_mapping WHERE game_id = ? ORDER BY seat").all(gameId);
  const rg = running.get(gameId);
  const engine = rg?.engine;

  const players: PlayerView[] = mappings.map((m) => {
    const profile = getProfileRow(db, m.profile_id);
    return {
      id: m.seat,
      profileId: m.profile_id,
      name: profile?.name ?? `玩家${m.seat}`,
      seat: m.seat,
      role: m.role,
      team: m.team,
      alive: engine ? engine.byId(m.seat).alive : !!m.alive,
      thinkingLevel: engine ? engine.byId(m.seat).thinkingLevel : m.thinking_level ?? profile?.thinking_level ?? "medium",
      avatarStyle: profile?.avatar_style ?? "ink",
    };
  });

  return {
    id: gameId,
    status: engine ? engine.status : session.status,
    mode: session.mode,
    assignment: session.assignment,
    round: engine ? engine.round : 0,
    phase: engine ? engine.phase : "pending",
    winner: engine?.winner ?? session.winner ?? null,
    reason: engine?.reason ?? session.reason ?? null,
    players,
    created_at: session.started_at ?? session.created_at,
  };
}

export function getGameEvents(db: Db, gameId: number, afterSeq = 0): GameEvent[] {
  const rows: any[] = db
    .prepare("SELECT payload FROM game_events WHERE game_id = ? AND seq > ? ORDER BY seq")
    .all(gameId, afterSeq);
  return rows.map((r) => JSON.parse(r.payload));
}

export function subscribe(gameId: number, fn: (evt: GameEvent) => void): () => void {
  const rg = running.get(gameId);
  if (!rg) return () => {};
  rg.emitter.on("event", fn);
  return () => rg.emitter.off("event", fn);
}

export function isRunning(gameId: number): boolean {
  return running.has(gameId);
}

export function controlGame(gameId: number, action: "pause" | "resume" | "abort") {
  const rg = running.get(gameId);
  if (!rg) return;
  if (action === "pause") rg.engine.pause();
  else if (action === "resume") rg.engine.resume();
  else rg.engine.abort();
}

// ---------- 结算报告 ----------
export function getReport(db: Db, gameId: number): GameReport {
  const session: any = db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(gameId);
  if (!session) throw new Error("对局不存在");
  const mappings: any[] = db.prepare("SELECT * FROM game_ai_mapping WHERE game_id = ? ORDER BY seat").all(gameId);
  const mvpSeat = mappings.find((m) => m.mvp)?.seat ?? null;
  return {
    gameId,
    winner: session.winner ?? "good",
    reason: session.reason ?? "",
    rounds: session.rounds,
    startedAt: session.started_at ?? "",
    finishedAt: session.finished_at ?? "",
    players: mappings.map((m) => {
      const profile = getProfileRow(db, m.profile_id);
      return {
        id: m.seat,
        name: profile?.name ?? `玩家${m.seat}`,
        role: m.role,
        team: m.team,
        alive: !!m.alive,
        win: !!m.win,
        mvp: m.seat === mvpSeat,
        speechCount: m.speech_count,
        tokensUsed: m.tokens_used,
      };
    }),
  };
}


export { ROLE_LABEL };