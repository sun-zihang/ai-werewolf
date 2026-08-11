import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
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
export function createGame(db: Db, input: GameConfigInput): { id: number; humanInvites: { seat: number; token: string }[] } {
  const humanCount = Math.min(4, Math.max(0, Math.floor(input.human_count ?? 0)));
  const ids = [...new Set(input.ai_ids)];
  const total = ids.length + humanCount;
  if (total < 2 || total > 12) throw new Error("总人数（含真人）需在 2-12 之间");
  const profiles = ids.map((id) => {
    const row = getProfileRow(db, id);
    if (!row) throw new Error(`AI 档案 ${id} 不存在`);
    return row;
  });
  const assignment = input.assignment ?? "random";
  const mode = resolveMode(total, input.mode);
  const roles = compositionFor(total, mode);
  // 真人与 AI 一起参与角色随机分配（真人角色随机，开局后才知道）
  const sources: any[] = [
    ...profiles.map((p) => ({ ...p, isHuman: false })),
    ...Array.from({ length: humanCount }, () => ({
      id: 0,
      name: null,
      thinking_level: "medium",
      avatar_style: "ink",
      role_preference: "[]",
      isHuman: true,
    })),
  ];
  const players = assignRoles(sources, roles, assignment, input.overrides ?? {});

  const config = JSON.stringify({ ...input, human_count: humanCount, mode, resolvedRoles: players.map((p) => p.role) });
  const info = db
    .prepare("INSERT INTO game_sessions (config_json, status, mode, assignment) VALUES (?, 'created', ?, ?)")
    .run(config, mode, assignment);
  const gameId = Number(info.lastInsertRowid);

  const ins = db.prepare(
    "INSERT INTO game_ai_mapping (game_id, profile_id, seat, role, team, alive, thinking_level, is_human, human_token, human_name) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)"
  );
  const humanInvites: { seat: number; token: string }[] = [];
  for (const p of players) {
    const token = p.isHuman ? randomBytes(8).toString("hex") : null;
    if (token) humanInvites.push({ seat: p.seat, token });
    ins.run(gameId, p.profileId, p.seat, p.role, ROLE_TEAM[p.role], p.thinkingLevel, p.isHuman ? 1 : 0, token, null);
  }
  return { id: gameId, humanInvites };
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
    profileId: p.isHuman ? 0 : p.id,
    name: p.isHuman ? `真人${seat}` : p.name,
    seat,
    role,
    team: ROLE_TEAM[role],
    alive: true,
    thinkingLevel: p.isHuman ? "medium" : (overrides[String(p.id)] ?? p.thinking_level ?? "medium"),
    avatarStyle: p.isHuman ? "ink" : (p.avatar_style ?? "ink"),
    canVote: true,
    idiotFlipped: false,
    witchAntidote: role === "witch",
    witchPoison: role === "witch",
    speechCount: 0,
    tokensUsed: 0,
    votesReceived: 0,
    isHuman: !!p.isHuman,
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
  // 真人操作超时：真人节奏给 2 分钟，适中 90s，快进 45s
  const humanTimeoutMs = paceProfile.night >= 4000 ? 120000 : paceProfile.night >= 2500 ? 90000 : 45000;
  if (running.has(gameId)) return;
  const session: any = db.prepare("SELECT * FROM game_sessions WHERE id = ?").get(gameId);
  if (!session) throw new Error("对局不存在");
  if (session.status === "finished" || session.status === "aborted") throw new Error("对局已结束");

  const mappings: any[] = db
    .prepare("SELECT * FROM game_ai_mapping WHERE game_id = ? ORDER BY seat")
    .all(gameId);
  const players: EnginePlayer[] = mappings.map((m) => {
    const profile = m.is_human ? null : getProfileRow(db, m.profile_id);
    return {
      id: m.seat,
      profileId: m.profile_id,
      name: m.human_name ?? (m.is_human ? `真人${m.seat}` : profile?.name ?? `玩家${m.seat}`),
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
      isHuman: !!m.is_human,
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
    humanTimeoutMs,
    decide: async (input: DecisionInput): Promise<DecisionOutput> => {
      const p = players.find((x) => x.id === input.player.id)!;
      const profile = runtime(p);
      const out = await decide({
        profile,
        input,
        decryptKey: (enc) => decryptSecret(enc),
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
      // 结束一段时间后从内存移除（默认 60s，测试可用 AWW_CLEANUP_MS 加速）
      const cleanupMs = Number(process.env.AWW_CLEANUP_MS) || 60_000;
      setTimeout(() => {
        if (running.get(gameId) === rg) running.delete(gameId);
      }, cleanupMs);
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
    const ep = engine?.byId(m.seat);
    return {
      id: m.seat,
      profileId: m.is_human ? null : m.profile_id,
      name: m.human_name ?? (m.is_human ? `真人${m.seat}` : (getProfileRow(db, m.profile_id)?.name ?? `玩家${m.seat}`)),
      seat: m.seat,
      role: m.role,
      team: m.team,
      alive: ep ? ep.alive : !!m.alive,
      thinkingLevel: ep ? ep.thinkingLevel : (m.thinking_level ?? "medium"),
      avatarStyle: ep ? ep.avatarStyle : "ink",
      isHuman: !!m.is_human,
      humanName: m.human_name ?? null,
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


// ---------- 真人座位：占座 / 视图 / 行动 ----------
function humanSeats(db: Db, gameId: number): { seat: number; name: string | null; joined: boolean }[] {
  const rows: any[] = db.prepare("SELECT seat, human_name FROM game_ai_mapping WHERE game_id=? AND is_human=1 ORDER BY seat").all(gameId);
  return rows.map((r) => ({ seat: r.seat, name: r.human_name ?? null, joined: !!r.human_name }));
}

export function joinHumanSeat(db: Db, gameId: number, token: string, name: string): { seat: number } {
  const m: any = db.prepare("SELECT * FROM game_ai_mapping WHERE game_id=? AND human_token=?").get(gameId, token);
  if (!m) throw new Error("座位不存在或链接无效");
  const clean = (name ?? "").toString().trim().slice(0, 12) || `真人${m.seat}`;
  db.prepare("UPDATE game_ai_mapping SET human_name=? WHERE id=?").run(clean, m.id);
  return { seat: m.seat };
}

// 该角色在玩家视角下能否看到这条事件（上帝视角的私密事件需按角色过滤）
function visibleToHuman(e: GameEvent, p: EnginePlayer): boolean {
  if (!e.secret) return true;
  if (e.type === "night_action") {
    if (e.role === "werewolf" && p.role === "werewolf") return true; // 狼人可见狼刀
    if ((e.playerId as number) === p.id) return true; // 自己的行动结果
    return false;
  }
  return false;
}

export function getHumanView(db: Db, gameId: number, token: string): any {
  const m: any = db.prepare("SELECT * FROM game_ai_mapping WHERE game_id=? AND human_token=?").get(gameId, token);
  if (!m) throw new Error("座位不存在或链接无效");
  const humans = humanSeats(db, gameId);
  // 全部玩家 seat → 显示名映射，供前端把事件里的 playerId/targetId 解析成名字
  const allMappings: any[] = db.prepare("SELECT seat, human_name, is_human, profile_id FROM game_ai_mapping WHERE game_id=? ORDER BY seat").all(gameId);
  const nameMap: Record<number, string> = {};
  for (const am of allMappings) {
    nameMap[am.seat] = am.human_name ?? (am.is_human ? `真人${am.seat}` : (getProfileRow(db, am.profile_id)?.name ?? `玩家${am.seat}`));
  }
  const base = {
    gameId,
    seat: m.seat,
    isHuman: true as const,
    joined: !!m.human_name,
    myName: m.human_name ?? null,
    humans,
    nameMap,
    privateInfo: [] as string[],
    yourTurn: false,
    requiredAction: undefined as string | undefined,
    options: [] as { id: number; name: string; seat: number }[],
    timeline: [] as GameEvent[],
  };
  const rg = running.get(gameId);
  if (!rg) {
    const session: any = db.prepare("SELECT * FROM game_sessions WHERE id=?").get(gameId);
    if (!session) throw new Error("对局不存在");
    return {
      ...base,
      status: session.status,
      round: session.rounds ?? 0,
      phase: session.status === "finished" || session.status === "aborted" ? "game_over" : "pending",
      role: undefined,
      winner: session.winner ?? null,
      reason: session.reason ?? null,
    };
  }
  const engine = rg.engine;
  const p = engine.byId(m.seat);
  const myTurn = engine.pendingHumanSeat === m.seat;
  const requiredAction = myTurn ? engine.pendingHumanAction : undefined;
  const needsTarget = !!requiredAction && ["night_kill", "night_check", "night_poison", "day_vote", "hunter_shot", "night_save"].includes(requiredAction);
  let options: { id: number; name: string; seat: number }[] = [];
  if (myTurn && needsTarget) {
    if (requiredAction === "night_save") {
      const k = engine.nightKillTarget;
      options = k !== undefined ? [{ id: k, name: engine.byId(k).name, seat: engine.byId(k).seat }] : [];
    } else {
      options = engine.alive().filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name, seat: x.seat }));
    }
  }
  const timeline = (getGameEvents(db, gameId, 0) as GameEvent[])
    .filter((e) => visibleToHuman(e, p))
    .map((e) => (e.secret ? { ...e, secret: false } : e));
  return {
    ...base,
    status: engine.status,
    round: engine.round,
    phase: engine.phase,
    role: engine.status === "created" ? undefined : p.role,
    privateInfo: engine.status === "created" ? [] : engine.privateInfoFor(p),
    yourTurn: myTurn,
    requiredAction,
    options,
    timeline,
    winner: engine.winner ?? null,
    reason: engine.reason ?? null,
  };
}

export function submitHumanAction(db: Db, gameId: number, token: string, body: any): { ok: boolean } {
  const rg = running.get(gameId);
  if (!rg) throw new Error("对局未在进行中");
  const engine = rg.engine;
  const m: any = db.prepare("SELECT * FROM game_ai_mapping WHERE game_id=? AND human_token=?").get(gameId, token);
  if (!m) throw new Error("座位不存在或链接无效");
  if (engine.pendingHumanSeat !== m.seat) throw new Error("当前不是你的操作回合");
  const out: DecisionOutput = {
    action: engine.pendingHumanAction ?? "",
    target_id: body?.target_id ?? null,
    content: body?.content ?? undefined,
  };
  engine.resolveHuman(out);
  return { ok: true };
}

export { ROLE_LABEL };