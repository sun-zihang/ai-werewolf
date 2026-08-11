import { compositionFor, ROLE_COMPLEXITY, ROLE_TEAM } from "../server/lib/engine/roles.js";
import { resolveMode, type EnginePlayer, type EngineSnapshot } from "../server/lib/engine/engine.js";
import type { GameConfigInput, GameEvent, GameReport, PlayerView, Role, ThinkingLevel } from "../server/lib/types.js";
import type { Env } from "./env.js";
import { randomHex } from "./webcrypto.js";
import { buildEngine, getRuntime, loadMappings, loadProfiles, type MappingRow, type SessionRow } from "./driver.js";

const LEVEL_SCORE: Record<string, number> = { paper: 0, medium: 1, high: 2, extra: 3 };

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- 建局 ----------

interface SourceLike {
  id: number;
  name: string | null;
  thinking_level: string;
  avatar_style: string | null;
  role_preference: string;
  isHuman: boolean;
}

function assignRoles(sources: SourceLike[], roles: Role[], assignment: string, overrides: Record<string, ThinkingLevel>): EnginePlayer[] {
  const seatOrder = sources.map((p, i) => ({ p, seat: i + 1 }));
  const build = (p: SourceLike, seat: number, role: Role): EnginePlayer => ({
    id: seat,
    profileId: p.isHuman ? 0 : p.id,
    name: p.isHuman ? `真人${seat}` : p.name ?? `玩家${seat}`,
    seat,
    role,
    team: ROLE_TEAM[role],
    alive: true,
    thinkingLevel: (p.isHuman ? "medium" : overrides[String(p.id)] ?? p.thinking_level ?? "medium") as ThinkingLevel,
    avatarStyle: p.isHuman ? "ink" : p.avatar_style ?? "ink",
    canVote: true,
    idiotFlipped: false,
    witchAntidote: role === "witch",
    witchPoison: role === "witch",
    speechCount: 0,
    tokensUsed: 0,
    votesReceived: 0,
    isHuman: p.isHuman,
  });

  const roleList = [...roles];
  if (assignment === "strength") {
    const sortedRoles = [...roles].sort((a, b) => ROLE_COMPLEXITY[b] - ROLE_COMPLEXITY[a]);
    const sortedPlayers = [...seatOrder].sort(
      (a, b) =>
        LEVEL_SCORE[overrides[String(b.p.id)] ?? b.p.thinking_level ?? "medium"] -
        LEVEL_SCORE[overrides[String(a.p.id)] ?? a.p.thinking_level ?? "medium"]
    );
    return sortedPlayers.map(({ p, seat }, i) => build(p, seat, sortedRoles[i] ?? "villager"));
  }
  if (assignment === "preference") {
    const result = new Map<number, Role>();
    const pool = [...roleList];
    const byPref = seatOrder.map(({ p, seat }) => ({ p, seat, prefs: safeJson<Role[]>(p.role_preference, []) }));
    for (const item of byPref) {
      const pref = item.prefs.find((r) => pool.includes(r));
      if (pref) {
        result.set(item.seat, pref);
        pool.splice(pool.indexOf(pref), 1);
      }
    }
    shuffle(pool);
    for (const item of byPref) if (!result.has(item.seat)) result.set(item.seat, pool.pop()!);
    return seatOrder.map(({ p, seat }) => build(p, seat, result.get(seat)!));
  }
  shuffle(roleList);
  return seatOrder.map(({ p, seat }, i) => build(p, seat, roleList[i]));
}

export async function createGame(env: Env, input: GameConfigInput): Promise<{ id: number; humanInvites: { seat: number; token: string }[] }> {
  const humanCount = Math.min(4, Math.max(0, Math.floor(input.human_count ?? 0)));
  const ids = [...new Set(input.ai_ids ?? [])];
  const total = ids.length + humanCount;
  if (total < 2 || total > 12) throw new Error("总人数（含真人）需在 2-12 之间");

  const profiles = await loadProfiles(env, ids);
  const sources: SourceLike[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (!row) throw new Error(`AI 档案 ${id} 不存在`);
    sources.push({
      id: row.id,
      name: row.name,
      thinking_level: row.thinking_level,
      avatar_style: row.avatar_style,
      role_preference: (row as unknown as { role_preference?: string }).role_preference ?? "[]",
      isHuman: false,
    });
  }
  for (let i = 0; i < humanCount; i++) {
    sources.push({ id: 0, name: null, thinking_level: "medium", avatar_style: "ink", role_preference: "[]", isHuman: true });
  }

  const assignment = input.assignment ?? "random";
  const mode = resolveMode(total, input.mode);
  const roles = compositionFor(total, mode);
  const players = assignRoles(sources, roles, assignment, (input.overrides ?? {}) as Record<string, ThinkingLevel>);

  const config = JSON.stringify({ ...input, human_count: humanCount, mode, resolvedRoles: players.map((p) => p.role) });
  const ins = await env.DB
    .prepare("INSERT INTO game_sessions (config_json, status, mode, assignment) VALUES (?, 'created', ?, ?)")
    .bind(config, mode, assignment)
    .run();
  const gameId = Number(ins.meta.last_row_id);

  const humanInvites: { seat: number; token: string }[] = [];
  const stmts = players.map((p) => {
    const token = p.isHuman ? randomHex(8) : null;
    if (token) humanInvites.push({ seat: p.seat, token });
    return env.DB
      .prepare(
        "INSERT INTO game_ai_mapping (game_id, profile_id, seat, role, team, alive, thinking_level, is_human, human_token, human_name) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)"
      )
      .bind(gameId, p.profileId, p.seat, p.role, ROLE_TEAM[p.role], p.thinkingLevel, p.isHuman ? 1 : 0, token);
  });
  await env.DB.batch(stmts);
  return { id: gameId, humanInvites };
}

// ---------- 开局 ----------

export async function startGame(env: Env, gameId: number, pace: string): Promise<void> {
  const session = await env.DB.prepare("SELECT id, mode, assignment, status FROM game_sessions WHERE id=?").bind(gameId).first<SessionRow>();
  if (!session) throw new Error("对局不存在");
  if (session.status === "finished" || session.status === "aborted") throw new Error("对局已结束");
  const existing = await getRuntime(env, gameId);
  if (existing) return; // 幂等：已开局

  const mappings = await loadMappings(env, gameId);
  const profiles = await loadProfiles(env, mappings.map((m) => m.profile_id));

  const events: GameEvent[] = [];
  const { engine } = buildEngine(session, mappings, profiles, null, { emit: (e) => events.push(e) });
  engine.markStarted(); // 发出 game_started（seq=1）
  const snapshot = engine.snapshot();
  const maxSeq = events.length ? events[events.length - 1].seq : 0;

  const cleanPace = ["slow", "normal", "fast"].includes(pace) ? pace : "slow";
  await env.DB.batch([
    ...events.map((e) =>
      env.DB.prepare("INSERT OR IGNORE INTO game_events (game_id, seq, payload) VALUES (?, ?, ?)").bind(gameId, e.seq, JSON.stringify(e))
    ),
    env.DB
      .prepare("INSERT OR REPLACE INTO game_runtime (game_id, snapshot, max_seq, pace, paused, pending_json, lock_until, updated_at) VALUES (?, ?, ?, ?, 0, NULL, 0, ?)")
      .bind(gameId, JSON.stringify(snapshot), maxSeq, cleanPace, Date.now()),
    env.DB.prepare("UPDATE game_sessions SET status='running', started_at=datetime('now') WHERE id=?").bind(gameId),
  ]);
}

export async function controlGame(env: Env, gameId: number, action: "pause" | "resume" | "abort"): Promise<void> {
  const rt = await getRuntime(env, gameId);
  if (!rt) return;
  if (action === "pause") {
    await env.DB.prepare("UPDATE game_runtime SET paused=1 WHERE game_id=?").bind(gameId).run();
    await env.DB.prepare("UPDATE game_sessions SET status='paused' WHERE id=?").bind(gameId).run();
    return;
  }
  if (action === "resume") {
    await env.DB.prepare("UPDATE game_runtime SET paused=0 WHERE game_id=?").bind(gameId).run();
    await env.DB.prepare("UPDATE game_sessions SET status='running' WHERE id=?").bind(gameId).run();
    return;
  }
  const snap = safeJson<EngineSnapshot | null>(rt.snapshot, null);
  if (snap) {
    snap.status = "aborted";
    snap.phase = "game_over";
    await env.DB.prepare("UPDATE game_runtime SET snapshot=?, paused=0, pending_json=NULL WHERE game_id=?").bind(JSON.stringify(snap), gameId).run();
  }
  await env.DB.prepare("UPDATE game_sessions SET status='aborted', finished_at=datetime('now') WHERE id=?").bind(gameId).run();
}

// ---------- 读取 ----------

export async function getGameState(env: Env, gameId: number): Promise<Record<string, unknown>> {
  const session = await env.DB.prepare("SELECT * FROM game_sessions WHERE id=?").bind(gameId).first<Record<string, unknown>>();
  if (!session) throw new Error("对局不存在");
  const mappings = await loadMappings(env, gameId);
  const profiles = await loadProfiles(env, mappings.map((m) => m.profile_id));
  const rt = await getRuntime(env, gameId);
  const snap = rt ? safeJson<EngineSnapshot | null>(rt.snapshot, null) : null;
  const bySeat = new Map<number, EngineSnapshot["players"][number]>();
  for (const p of snap?.players ?? []) bySeat.set(p.id, p);

  const players: PlayerView[] = mappings.map((m) => {
    const sp = bySeat.get(m.seat);
    const profile = profiles.get(m.profile_id);
    return {
      id: m.seat,
      profileId: m.is_human ? null : m.profile_id,
      name: m.human_name ?? (m.is_human ? `真人${m.seat}` : profile?.name ?? `玩家${m.seat}`),
      seat: m.seat,
      role: m.role as Role,
      team: m.team as PlayerView["team"],
      alive: sp ? sp.alive : !!m.alive,
      thinkingLevel: (sp?.thinkingLevel ?? m.thinking_level ?? "medium") as ThinkingLevel,
      avatarStyle: sp?.avatarStyle ?? profile?.avatar_style ?? "ink",
      isHuman: !!m.is_human,
      humanName: m.human_name ?? null,
    };
  });

  const paused = !!rt?.paused;
  return {
    id: gameId,
    status: paused ? "paused" : snap?.status ?? session.status,
    mode: session.mode,
    assignment: session.assignment,
    round: snap?.round ?? 0,
    phase: snap?.phase ?? "pending",
    winner: snap?.winner ?? session.winner ?? null,
    reason: snap?.reason ?? session.reason ?? null,
    players,
    created_at: session.started_at ?? session.created_at,
  };
}

export async function getGameEvents(env: Env, gameId: number, afterSeq = 0): Promise<GameEvent[]> {
  const r = await env.DB
    .prepare("SELECT payload FROM game_events WHERE game_id=? AND seq>? ORDER BY seq")
    .bind(gameId, afterSeq)
    .all<{ payload: string }>();
  return (r.results ?? []).map((row) => JSON.parse(row.payload) as GameEvent);
}

export async function listGames(env: Env, profileId = 0): Promise<Record<string, unknown>[]> {
  const sql = profileId
    ? `SELECT g.*, (SELECT COUNT(*) FROM game_ai_mapping m WHERE m.game_id=g.id) AS player_count
       FROM game_sessions g WHERE g.id IN (SELECT game_id FROM game_ai_mapping WHERE profile_id=?)
       ORDER BY g.id DESC LIMIT 50`
    : `SELECT g.*, (SELECT COUNT(*) FROM game_ai_mapping m WHERE m.game_id=g.id) AS player_count
       FROM game_sessions g ORDER BY g.id DESC LIMIT 100`;
  const stmt = profileId ? env.DB.prepare(sql).bind(profileId) : env.DB.prepare(sql);
  const r = await stmt.all<Record<string, unknown>>();
  return (r.results ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    mode: row.mode,
    winner: row.winner ?? null,
    reason: row.reason ?? null,
    rounds: row.rounds,
    player_count: row.player_count,
    started_at: row.started_at,
    finished_at: row.finished_at,
  }));
}

export async function getReport(env: Env, gameId: number): Promise<GameReport> {
  const session = await env.DB.prepare("SELECT * FROM game_sessions WHERE id=?").bind(gameId).first<Record<string, unknown>>();
  if (!session) throw new Error("对局不存在");
  const r = await env.DB.prepare("SELECT * FROM game_ai_mapping WHERE game_id=? ORDER BY seat").bind(gameId).all<Record<string, unknown>>();
  const mappings = r.results ?? [];
  const profiles = await loadProfiles(env, mappings.map((m) => Number(m.profile_id)));
  const mvpSeat = mappings.find((m) => m.mvp)?.seat ?? null;
  return {
    gameId,
    winner: (session.winner as GameReport["winner"]) ?? "good",
    reason: (session.reason as string) ?? "",
    rounds: Number(session.rounds ?? 0),
    startedAt: (session.started_at as string) ?? "",
    finishedAt: (session.finished_at as string) ?? "",
    players: mappings.map((m) => ({
      id: Number(m.seat),
      name: (m.human_name as string) ?? profiles.get(Number(m.profile_id))?.name ?? `玩家${m.seat}`,
      role: m.role as Role,
      team: m.team as GameReport["players"][number]["team"],
      alive: !!m.alive,
      win: !!m.win,
      mvp: m.seat === mvpSeat,
      speechCount: Number(m.speech_count ?? 0),
      tokensUsed: Number(m.tokens_used ?? 0),
    })),
  };
}

// ---------- 真人座位 ----------

function visibleToHuman(e: GameEvent, role: string, seat: number): boolean {
  if (!e.secret) return true;
  if (e.type === "night_action") {
    if (e.role === "werewolf" && role === "werewolf") return true;
    if ((e.playerId as number) === seat) return true;
    return false;
  }
  return false;
}

async function mappingByToken(env: Env, gameId: number, token: string): Promise<MappingRow & { id: number }> {
  const m = await env.DB
    .prepare("SELECT * FROM game_ai_mapping WHERE game_id=? AND human_token=?")
    .bind(gameId, token)
    .first<MappingRow & { id: number }>();
  if (!m) throw new Error("座位不存在或链接无效");
  return m;
}

export async function joinHumanSeat(env: Env, gameId: number, token: string, name: string): Promise<{ seat: number }> {
  const m = await mappingByToken(env, gameId, token);
  const clean = (name ?? "").toString().trim().slice(0, 12) || `真人${m.seat}`;
  await env.DB.prepare("UPDATE game_ai_mapping SET human_name=? WHERE id=?").bind(clean, m.id).run();
  return { seat: m.seat };
}

export async function getHumanView(env: Env, gameId: number, token: string): Promise<Record<string, unknown>> {
  const session = await env.DB.prepare("SELECT id, mode, assignment, status, rounds, winner, reason FROM game_sessions WHERE id=?").bind(gameId).first<SessionRow & Record<string, unknown>>();
  if (!session) throw new Error("对局不存在");
  const m = await mappingByToken(env, gameId, token);
  const mappings = await loadMappings(env, gameId);
  const profiles = await loadProfiles(env, mappings.map((x) => x.profile_id));

  const nameMap: Record<number, string> = {};
  for (const am of mappings) {
    nameMap[am.seat] = am.human_name ?? (am.is_human ? `真人${am.seat}` : profiles.get(am.profile_id)?.name ?? `玩家${am.seat}`);
  }
  const humans = mappings.filter((x) => x.is_human).map((x) => ({ seat: x.seat, name: x.human_name ?? null, joined: !!x.human_name }));

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

  const rt = await getRuntime(env, gameId);
  const snap = rt ? safeJson<EngineSnapshot | null>(rt.snapshot, null) : null;
  if (!rt || !snap) {
    return {
      ...base,
      status: session.status,
      round: Number(session.rounds ?? 0),
      phase: session.status === "finished" || session.status === "aborted" ? "game_over" : "pending",
      role: undefined,
      winner: session.winner ?? null,
      reason: session.reason ?? null,
    };
  }

  const { engine } = buildEngine(session, mappings, profiles, snap);
  const p = engine.byId(m.seat);
  const pending = rt.pending_json ? safeJson<{ seat: number; action: string } | null>(rt.pending_json, null) : null;
  const myTurn = !!pending && pending.seat === m.seat && !rt.paused;
  const requiredAction = myTurn ? pending!.action : undefined;
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

  const timeline = (await getGameEvents(env, gameId, 0))
    .filter((e) => visibleToHuman(e, p.role, p.id))
    .map((e) => (e.secret ? { ...e, secret: false } : e));

  return {
    ...base,
    status: rt.paused ? "paused" : snap.status,
    round: snap.round,
    phase: snap.phase,
    role: snap.status === "created" ? undefined : p.role,
    privateInfo: snap.status === "created" ? [] : engine.privateInfoFor(p),
    yourTurn: myTurn,
    requiredAction,
    options,
    timeline,
    winner: snap.winner ?? null,
    reason: snap.reason ?? null,
  };
}

export async function submitHumanAction(env: Env, gameId: number, token: string, body: Record<string, unknown>): Promise<{ ok: boolean }> {
  const rt = await getRuntime(env, gameId);
  if (!rt) throw new Error("对局未在进行中");
  const m = await mappingByToken(env, gameId, token);
  const pending = rt.pending_json ? safeJson<{ round: number; idx: number; seat: number; action: string } | null>(rt.pending_json, null) : null;
  if (!pending || pending.seat !== m.seat) throw new Error("当前不是你的操作回合");

  const payload = JSON.stringify({
    action: pending.action,
    target_id: body?.target_id ?? null,
    content: body?.content ?? undefined,
  });
  // 写入收件箱：驱动器下一次推进时按 (round, idx) 精确消费，天然幂等
  await env.DB
    .prepare("INSERT OR IGNORE INTO human_inbox (game_id, round, idx, seat, payload) VALUES (?, ?, ?, ?, ?)")
    .bind(gameId, pending.round, pending.idx, m.seat, payload)
    .run();
  return { ok: true };
}
