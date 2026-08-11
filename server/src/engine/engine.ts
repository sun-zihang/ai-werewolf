import {
  DecisionInput,
  DecisionOutput,
  GameEvent,
  GameMode,
  Role,
  ROLE_LABEL,
  Team,
  ThinkingLevel,
} from "../types.js";
import { ROLE_TEAM, compositionFor, modeForPlayerCount } from "./roles.js";

export interface EnginePlayer {
  id: number; // 1-based 座位 id
  profileId: number;
  name: string;
  seat: number;
  role: Role;
  team: Team;
  alive: boolean;
  thinkingLevel: ThinkingLevel;
  avatarStyle: string;
  canVote: boolean;
  idiotFlipped: boolean;
  witchAntidote: boolean;
  witchPoison: boolean;
  speechCount: number;
  tokensUsed: number;
  votesReceived: number;
  isHuman: boolean; // 是否为真人座位（等待真人 HTTP 提交行动）
}

export type PhaseId =
  | "night_wolf"
  | "night_seer"
  | "night_witch"
  | "day_announce"
  | "day_lastwords"
  | "day_speech"
  | "day_vote"
  | "day_result"
  | "game_over";

export interface PendingDeath {
  id: number;
  cause: "wolf" | "poison" | "vote" | "hunter";
}

export interface SpeechEntry {
  playerId: number;
  content: string;
  round: number;
  phaseLabel: string;
}

export interface GameConfigResolved {
  mode: GameMode;
  assignment: string;
  playerCount: number;
  roles: Role[];
}

export interface EngineOpts {
  players: EnginePlayer[];
  mode: GameMode;
  assignment: string;
  emit: (evt: GameEvent) => void;
  decide: (input: DecisionInput) => Promise<DecisionOutput>;
  validate: (action: string, out: DecisionOutput) => string | null;
  onTokens: (playerId: number, usage: { thinkingTokens?: number; outputTokens?: number; totalTokens?: number }) => void;
  pace?: PaceProfile;
  humanTimeoutMs?: number; // 真人操作超时（毫秒），超时则由 AI 自动托管
  validateRoles?: boolean;
}

export type PaceKey = "slow" | "normal" | "fast";

export interface PaceProfile {
  night: number; // 夜间每个角色行动前的思考停顿（毫秒）
  speech: number; // 白天每人发言前的停顿
  vote: number; // 每个玩家投票前的停顿
  lastwords: number; // 遗言停顿
  hunter: number; // 猎人开枪停顿
  phaseGap: number; // 阶段切换之间的间隔
}

// 节奏档位：slow 贴近真人玩狼人杀的节奏，normal 适中，fast 快进
export const PACES: Record<PaceKey, PaceProfile> = {
  slow: { night: 4000, speech: 9000, vote: 2500, lastwords: 4500, hunter: 4000, phaseGap: 3500 },
  normal: { night: 2500, speech: 6000, vote: 1800, lastwords: 3000, hunter: 2500, phaseGap: 2200 },
  fast: { night: 1400, speech: 3000, vote: 1000, lastwords: 1800, hunter: 1500, phaseGap: 1200 },
};

export function resolvePace(input: PaceKey | number | undefined): PaceProfile {
  if (typeof input === "number") {
    // 旧版 flat speedMs：所有阶段统一使用该间隔
    return { night: input, speech: input, vote: input, lastwords: input, hunter: input, phaseGap: input };
  }
  return PACES[input ?? "slow"] ?? PACES.slow;
}

export class WerewolfGame {
  players: EnginePlayer[];
  mode: GameMode;
  assignment: string;
  round = 1;
  phase: PhaseId = "night_wolf";
  status: "created" | "running" | "paused" | "finished" | "aborted" = "created";
  winner?: Team;
  reason?: string;

  nightKillTarget?: number;
  witchSavedTarget?: number;
  witchPoisonTarget?: number;
  seerCheckResults = new Map<number, Team>();
  pendingDeaths: PendingDeath[] = [];
  speechLog: SpeechEntry[] = [];
  votes = new Map<number, number | null>();
  pendingHunter?: { id: number; cause: "wolf" | "vote" };
  pendingLastWords?: number;
  lastRoundKillTarget?: number;

  private seq = 0;
  private opts: EngineOpts;
  private running = false;
  private pausedFlag = false;
  private abortedFlag = false;
  private stopRequested = false;
  private pendingHuman?:
    | {
        playerId: number;
        requiredAction: DecisionInput["requiredAction"];
        phaseLabel: string;
        resolve: (out: DecisionOutput) => void;
        timer: ReturnType<typeof setTimeout>;
      };

  constructor(opts: EngineOpts) {
    this.opts = opts;
    this.players = opts.players;
    this.mode = opts.mode;
    this.assignment = opts.assignment;
    // 校验配置（测试可用 validateRoles:false 跳过）
    if (this.opts.validateRoles !== false) {
      const expected = compositionFor(this.players.length, this.mode).sort().join(",");
      const actual = this.players.map((p) => p.role).sort().join(",");
      if (expected !== actual) throw new Error("角色组成与人数配置不匹配");
    }
  }

  // ---------- 基础设施 ----------
  private emit(type: GameEvent["type"], data: Partial<GameEvent> & Record<string, unknown>) {
    const evt = {
      ...data,
      type,
      seq: ++this.seq,
      round: this.round,
      ts: Date.now(),
    } as unknown as GameEvent;
    this.opts.emit(evt);
  }

  alive(role?: Role): EnginePlayer[] {
    return this.players.filter((p) => p.alive && (!role || p.role === role));
  }

  byId(id: number): EnginePlayer {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new Error(`玩家 ${id} 不存在`);
    return p;
  }

  private async decideFor(player: EnginePlayer, requiredAction: DecisionInput["requiredAction"], phaseLabel: string): Promise<DecisionOutput> {
    if (player.isHuman) return this.waitHumanInput(player, requiredAction, phaseLabel);
    const input: DecisionInput = {
      player: { id: player.id, name: player.name, seat: player.seat, role: player.role, team: player.team, alive: player.alive },
      thinkingLevel: player.thinkingLevel,
      requiredAction,
      context: {
        round: this.round,
        phaseLabel,
        alive: this.alive().map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
        publicLog: this.publicLogLines(),
        privateInfo: this.privateInfoFor(player),
      },
    };
    this.emit("ai_thinking", { playerId: player.id, status: "start", level: player.thinkingLevel });
    const t0 = Date.now();
    const out = await this.opts.decide(input);
    const ms = Date.now() - t0;
    this.emit("ai_thinking", { playerId: player.id, status: "done", level: player.thinkingLevel, ms });
    return out;
  }

  // 真人座位：挂起等待真人通过 HTTP 提交行动；超时则由 AI 自动托管，保证对局不卡死
  private waitHumanInput(player: EnginePlayer, requiredAction: DecisionInput["requiredAction"], phaseLabel: string): Promise<DecisionOutput> {
    return new Promise((resolve) => {
      const timeout = this.opts.humanTimeoutMs ?? 90000;
      const timer = setTimeout(() => {
        if (this.pendingHuman?.playerId === player.id) {
          this.pendingHuman = undefined;
          this.emit("system", { message: `${player.name}（真人）超时未操作，已由 AI 自动托管`, secret: false });
          resolve(this.autoDecision(player, requiredAction, phaseLabel));
        }
      }, timeout);
      this.pendingHuman = {
        playerId: player.id,
        requiredAction,
        phaseLabel,
        resolve: (out) => {
          clearTimeout(timer);
          if (this.pendingHuman?.playerId === player.id) this.pendingHuman = undefined;
          resolve(out);
        },
        timer,
      };
      this.emit("human_turn", { playerId: player.id, seat: player.seat, action: requiredAction, label: phaseLabel });
    });
  }

  get pendingHumanSeat(): number | undefined {
    return this.pendingHuman?.playerId;
  }

  get pendingHumanAction(): DecisionInput["requiredAction"] | undefined {
    return this.pendingHuman?.requiredAction;
  }

  /** 真人提交行动后由 manager 调用，唤醒挂起的等待 */
  resolveHuman(out: DecisionOutput): boolean {
    if (!this.pendingHuman) return false;
    const ph = this.pendingHuman;
    this.pendingHuman = undefined;
    clearTimeout(ph.timer);
    ph.resolve(out);
    return true;
  }

  /** 真人超时的默认合法决策（不调用 LLM，仅保证对局推进） */
  private autoDecision(player: EnginePlayer, requiredAction: DecisionInput["requiredAction"], _phaseLabel: string): DecisionOutput {
    const aliveOthers = this.alive().filter((p) => p.id !== player.id);
    switch (requiredAction) {
      case "night_kill": {
        const targets = aliveOthers.filter((p) => p.team !== "wolf");
        const t = targets[Math.floor(Math.random() * targets.length)];
        return t ? { action: "night_kill", target_id: t.id } : { action: "night_kill" };
      }
      case "night_check": {
        const checked = new Set(this.seerCheckResults.keys());
        const targets = aliveOthers.filter((p) => !checked.has(p.id));
        const t = targets[Math.floor(Math.random() * targets.length)];
        return t ? { action: "night_check", target_id: t.id } : { action: "night_check" };
      }
      case "night_save":
        return this.nightKillTarget !== undefined ? { action: "night_save", target_id: this.nightKillTarget } : { action: "night_save" };
      case "night_poison":
        return { action: "night_poison" };
      case "day_speech":
        return { action: "day_speech", content: "（真人超时，由 AI 自动托管）我是好人，请大家相信我。" };
      case "day_vote": {
        const targets = aliveOthers.filter((p) => p.canVote);
        const t = targets[Math.floor(Math.random() * targets.length)];
        return t ? { action: "day_vote", target_id: t.id } : { action: "day_vote" };
      }
      case "last_words":
        return { action: "last_words", content: "（真人超时，由 AI 自动托管）" };
      case "hunter_shot": {
        const t = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
        return t ? { action: "hunter_shot", target_id: t.id } : { action: "hunter_shot" };
      }
      default:
        return { action: requiredAction };
    }
  }

  private publicLogLines(): string[] {
    const lines: string[] = [];
    for (const s of this.speechLog.slice(-40)) {
      const name = this.byId(s.playerId).name;
      lines.push(`第${s.round}天 ${name}：${s.content}`);
    }
    return lines;
  }

  privateInfoFor(p: EnginePlayer): string[] {
    const info: string[] = [];
    if (p.role === "werewolf") {
      const mates = this.players.filter((x) => x.role === "werewolf" && x.alive);
      if (mates.length > 1) info.push(`你的狼同伴：${mates.map((m) => `${m.seat}号 ${m.name}`).join("、")}`);
    }
    if (p.role === "seer") {
      for (const [id, team] of this.seerCheckResults) {
        const t = this.byId(id);
        info.push(`你查验过 ${t.seat}号 ${t.name}：${team === "wolf" ? "是狼人" : "不是狼人"}`);
      }
    }
    if (p.role === "witch") {
      info.push(`你还有${p.witchAntidote ? "一瓶解药" : "无解药"}${p.witchPoison ? "、一瓶毒药" : "、无毒药"}`);
      if (this.nightKillTarget !== undefined) {
        const t = this.byId(this.nightKillTarget);
        info.push(`昨夜狼人刀了 ${t.seat}号 ${t.name}`);
      }
    }
    if (p.role === "hunter") {
      info.push(`你被刀或票出局时可开枪（被毒则不能）`);
    }
    return info;
  }

  private validateOut(action: string, out: DecisionOutput): string | null {
    return this.opts.validate(action, out);
  }

  // ---------- 主流程 ----------
  async run() {
    if (this.status === "finished" || this.status === "aborted") return;
    this.status = "running";
    this.running = true;
    this.emit("game_started", { mode: this.mode, assignment: this.assignment, secret: false });
    try {
      while (this.running && !this.abortedFlag) {
        await this.waitIfPaused();
        const over = await this.playRound();
        if (over) break;
      }
    } finally {
      this.running = false;
    }
  }

  pause() {
    if (this.status === "running") {
      this.status = "paused";
      this.pausedFlag = true;
    }
  }

  resume() {
    if (this.status === "paused") {
      this.status = "running";
      this.pausedFlag = false;
    }
  }

  abort() {
    this.abortedFlag = true;
    if (this.status !== "finished") this.status = "aborted";
    if (this.pendingHuman) {
      clearTimeout(this.pendingHuman.timer);
      const ph = this.pendingHuman;
      this.pendingHuman = undefined;
      ph.resolve({ action: "abort_skip" });
    }
  }

  private async waitIfPaused() {
    while (this.pausedFlag && !this.abortedFlag) {
      await sleep(200);
    }
  }

  private async tick(category: keyof PaceProfile) {
    await this.waitIfPaused();
    const ms = this.opts.pace?.[category];
    if (ms) await sleep(ms);
  }

  /** 执行一轮（夜间 + 白天），返回是否终局 */
  private async playRound(): Promise<boolean> {
    this.phase = "night_wolf";
    this.emit("phase", { phase: "night_wolf", label: `第 ${this.round} 夜 · 狼人行动` });
    await this.tick("phaseGap");
    await this.nightWolf();
    if (this.checkGameOver()) return true;

    this.phase = "night_seer";
    this.emit("phase", { phase: "night_seer", label: `第 ${this.round} 夜 · 预言家查验` });
    await this.tick("phaseGap");
    await this.nightSeer();

    this.phase = "night_witch";
    this.emit("phase", { phase: "night_witch", label: `第 ${this.round} 夜 · 女巫行动` });
    await this.tick("phaseGap");
    await this.nightWitch();

    // 结算夜间死亡
    this.resolveNightDeaths();
    if (this.checkGameOver()) return true;

    // 白天
    this.phase = "day_announce";
    this.emit("phase", { phase: "day_announce", label: `第 ${this.round} 天 · 公布死讯` });
    await this.tick("phaseGap");
    await this.announceNight();

    // 遗言（夜间死者 + 猎人开枪）
    if (this.pendingLastWords !== undefined || this.pendingHunter) {
      this.phase = "day_lastwords";
      this.emit("phase", { phase: "day_lastwords", label: "遗言 · 猎人结算" });
      await this.tick("phaseGap");
      await this.processLastWordsAndHunter();
      if (this.checkGameOver()) return true;
    }

    this.phase = "day_speech";
    this.emit("phase", { phase: "day_speech", label: `第 ${this.round} 天 · 自由发言` });
    await this.tick("phaseGap");
    await this.daySpeech();

    this.phase = "day_vote";
    this.emit("phase", { phase: "day_vote", label: `第 ${this.round} 天 · 投票` });
    await this.tick("phaseGap");
    await this.dayVote();
    if (this.checkGameOver()) return true;

    this.phase = "day_result";
    this.emit("phase", { phase: "day_result", label: "投票结果" });
    await this.tick("phaseGap");
    await this.dayResult();
    if (this.checkGameOver()) return true;

    this.round += 1;
    return false;
  }

  // ---------- 夜间 ----------
  private async nightWolf() {
    const wolves = this.alive("werewolf");
    const choices: { id: number; target: number | null }[] = [];
    for (const w of wolves) {
      await this.tick("night");
      const out = await this.decideFor(w, "night_kill", "狼人刀人");
      const err = this.validateOut("kill", out);
      let target: number | null = null;
      if (!err && typeof out.target_id === "number" && out.target_id !== null) {
        target = out.target_id;
        if (this.byId(target).alive && target !== w.id) {
          choices.push({ id: w.id, target });
        } else {
          this.emit("system", { message: `${w.name}（狼人）提交了非法刀人目标，按空刀处理`, secret: true });
        }
      }
      this.emit("night_action", { playerId: w.id, action: "kill", targetId: target ?? undefined, role: "werewolf", secret: true });
    }
    // 多数决；平票取座位靠前者；全空刀则无人死亡
    if (choices.length) {
      const counts = new Map<number, number>();
      for (const c of choices) counts.set(c.target!, (counts.get(c.target!) ?? 0) + 1);
      let best: number | null = null;
      let bestCount = 0;
      for (const [tid, n] of counts) {
        if (n > bestCount) {
          best = tid;
          bestCount = n;
        }
      }
      this.nightKillTarget = best ?? undefined;
      this.lastRoundKillTarget = best ?? undefined;
    } else {
      this.nightKillTarget = undefined;
    }
  }

  private async nightSeer() {
    const seer = this.alive("seer")[0];
    if (!seer) return;
    await this.tick("night");
    const out = await this.decideFor(seer, "night_check", "预言家查验");
    const err = this.validateOut("check", out);
    let target: number | null = null;
    if (!err && typeof out.target_id === "number" && out.target_id !== null) {
      const t = this.byId(out.target_id);
      if (t.alive && t.id !== seer.id) target = t.id;
    }
    if (target !== null) {
      const t = this.byId(target);
      this.seerCheckResults.set(target, t.team);
      this.emit("night_action", { playerId: seer.id, action: "check", targetId: target, role: "seer", secret: true, content: `${t.name} 是${t.team === "wolf" ? "狼人" : "好人"}` });
    } else {
      this.emit("night_action", { playerId: seer.id, action: "check", role: "seer", secret: true, content: "（查验失败，跳过）" });
    }
  }

  private async nightWitch() {
    const witch = this.alive("witch")[0];
    if (!witch) return;
    // 解药
    if (witch.witchAntidote && this.nightKillTarget !== undefined) {
      await this.tick("night");
      const out = await this.decideFor(witch, "night_save", "女巫救人");
      const err = this.validateOut("save", out);
      let target: number | null = null;
      if (!err && typeof out.target_id === "number" && out.target_id !== null) {
        target = out.target_id;
      }
      if (target !== null && target === this.nightKillTarget) {
        this.witchSavedTarget = target;
        witch.witchAntidote = false;
        this.emit("night_action", { playerId: witch.id, action: "save", targetId: target, role: "witch", secret: true, content: `救了 ${this.byId(target).name}` });
      } else {
        this.emit("night_action", { playerId: witch.id, action: "none", role: "witch", secret: true, content: "解药未使用" });
      }
    } else if (witch.witchAntidote) {
      this.emit("night_action", { playerId: witch.id, action: "none", role: "witch", secret: true, content: "昨夜无人被刀" });
    }
    // 毒药
    if (witch.witchPoison) {
      await this.tick("night");
      const out = await this.decideFor(witch, "night_poison", "女巫下毒");
      const err = this.validateOut("poison", out);
      let target: number | null = null;
      if (!err && typeof out.target_id === "number" && out.target_id !== null) {
        const t = this.byId(out.target_id);
        if (t.alive && t.id !== witch.id) target = t.id;
      }
      if (target !== null) {
        this.witchPoisonTarget = target;
        witch.witchPoison = false;
        this.emit("night_action", { playerId: witch.id, action: "poison", targetId: target, role: "witch", secret: true, content: `毒了 ${this.byId(target).name}` });
      } else {
        this.emit("night_action", { playerId: witch.id, action: "none", role: "witch", secret: true, content: "毒药未使用" });
      }
    }
  }

  private resolveNightDeaths() {
    const died: PendingDeath[] = [];
    const seen = new Set<number>();
    const push = (id: number, cause: "wolf" | "poison") => {
      if (seen.has(id)) return; // 刀与毒同目标时只记一次（毒优先）
      seen.add(id);
      died.push({ id, cause });
    };
    if (this.witchPoisonTarget !== undefined) push(this.witchPoisonTarget, "poison");
    if (this.nightKillTarget !== undefined && this.witchSavedTarget !== this.nightKillTarget) {
      push(this.nightKillTarget, "wolf");
    }
    this.pendingDeaths = died;
  }

  private async announceNight() {
    const died = this.pendingDeaths.filter((d) => this.byId(d.id).alive);
    if (!died.length) {
      this.emit("system", { message: "昨夜是平安夜，无人死亡。", secret: false });
      return;
    }
    for (const d of died) {
      this.byId(d.id).alive = false;
      this.emit("death", { playerId: d.id, cause: d.cause, revealRole: false });
    }
    // 狼刀死+被毒同时存在时，若猎人被毒则不能开枪；若被刀则可开枪
    const hunterDied = died.find((d) => this.byId(d.id).role === "hunter");
    if (hunterDied) {
      if (hunterDied.cause === "poison") {
        this.emit("system", { message: `${this.byId(hunterDied.id).name}（猎人）被毒身亡，无法开枪。`, secret: false });
      } else {
        this.pendingHunter = { id: hunterDied.id, cause: "wolf" as const };
      }
    }
    // 遗言：第一个死亡的玩家（若有多个，取座位最前）
    const first = [...died].sort((a, b) => this.byId(a.id).seat - this.byId(b.id).seat)[0];
    if (first) this.pendingLastWords = first.id;
  }

  private async processLastWordsAndHunter() {
    if (this.pendingLastWords !== undefined) {
      const p = this.byId(this.pendingLastWords);
      await this.tick("lastwords");
      const out = await this.decideFor(p, "last_words", "遗言");
      const content = typeof out.content === "string" && out.content.trim() ? out.content.trim() : "（没有遗言）";
      this.emit("last_words", { playerId: p.id, content });
    }
    if (this.pendingHunter) {
      const h = this.byId(this.pendingHunter.id);
      await this.tick("hunter");
      const out = await this.decideFor(h, "hunter_shot", "猎人开枪");
      const err = this.validateOut("shoot", out);
      let target: number | null = null;
      if (!err && typeof out.target_id === "number" && out.target_id !== null) {
        const t = this.byId(out.target_id);
        if (t.alive && t.id !== h.id) target = t.id;
      }
      if (target !== null) {
        const t = this.byId(target);
        t.alive = false;
        this.emit("hunter_shot", { playerId: h.id, targetId: target, content: out.content });
        this.emit("death", { playerId: target, cause: "hunter", revealRole: false });
      } else {
        this.emit("hunter_shot", { playerId: h.id, content: "（未开枪）" });
      }
    }
    this.pendingHunter = undefined;
    this.pendingLastWords = undefined;
  }

  // ---------- 白天 ----------
  private async daySpeech() {
    const speakers = [...this.alive()].sort((a, b) => a.seat - b.seat);
    for (const p of speakers) {
      await this.tick("speech");
      const out = await this.decideFor(p, "day_speech", "发言");
      const content = typeof out.content === "string" && out.content.trim() ? out.content.trim().slice(0, 300) : "（沉默）";
      p.speechCount += 1;
      this.speechLog.push({ playerId: p.id, content, round: this.round, phaseLabel: "发言" });
      this.emit("speech", { playerId: p.id, content, level: p.thinkingLevel });
    }
  }

  private async dayVote() {
    const voters = this.alive().filter((p) => p.canVote);
    this.votes.clear();
    for (const v of voters) {
      await this.tick("vote");
      const out = await this.decideFor(v, "day_vote", "投票");
      const err = this.validateOut("vote", out);
      let target: number | null = null;
      if (!err && typeof out.target_id === "number" && out.target_id !== null) {
        const t = this.byId(out.target_id);
        if (t.alive && t.id !== v.id) target = t.id;
      }
      this.votes.set(v.id, target);
      this.emit("vote", { playerId: v.id, targetId: target, reveal: false });
    }
    const counts = new Map<number, number>();
    for (const [, t] of this.votes) {
      if (t !== null) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = entries[0];
    const tie = entries.length > 1 && entries[1][1] === top[1];
    const eliminatedId = !tie && top && top[1] > 0 ? top[0] : null;
    const publicCounts: Record<number, number> = {};
    for (const [id, n] of counts) publicCounts[id] = n;
    this.emit("vote_result", { counts: publicCounts, eliminatedId, tie });
    if (eliminatedId !== null) {
      this.voteEliminatedId = eliminatedId;
    }
  }

  private voteEliminatedId?: number;

  private async dayResult() {
    const id = this.voteEliminatedId;
    this.voteEliminatedId = undefined;
    if (id === undefined) {
      this.emit("system", { message: "平票或无人投票，今天无人出局（平安日）。", secret: false });
      return;
    }
    const p = this.byId(id);
    p.votesReceived += 1;
    if (p.role === "idiot") {
      // 白痴翻牌：免死、失去投票权、可继续发言
      p.canVote = false;
      p.idiotFlipped = true;
      this.emit("idiot_flip", { playerId: id });
      this.emit("system", { message: `${p.name} 是白痴，翻牌免死，从今往后失去投票权。`, secret: false });
      return;
    }
    p.alive = false;
    this.emit("death", { playerId: id, cause: "vote", revealRole: false });
    if (p.role === "hunter") {
      this.pendingHunter = { id, cause: "vote" };
      this.pendingLastWords = id;
      await this.processLastWordsAndHunter();
    } else {
      this.pendingLastWords = id;
      await this.processLastWordsAndHunter();
    }
  }

  // ---------- 胜负 ----------
  checkGameOver(): boolean {
    if (this.status === "finished") return true;
    const wolves = this.alive("werewolf").length;
    const goods = this.alive().filter((p) => p.team === "good").length;
    if (wolves === 0) {
      this.winner = "good";
      this.reason = "所有狼人已出局，好人阵营获胜。";
      this.status = "finished";
      this.phase = "game_over";
      this.emit("game_over", { winner: "good", reason: this.reason, secret: false });
      return true;
    }
    if (wolves >= goods) {
      this.winner = "wolf";
      this.reason = `狼人数量（${wolves}）不少于好人（${goods}），狼人阵营获胜。`;
      this.status = "finished";
      this.phase = "game_over";
      this.emit("game_over", { winner: "wolf", reason: this.reason, secret: false });
      return true;
    }
    return false;
  }

  get state() {
    return {
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        role: p.role,
        team: p.team,
        alive: p.alive,
        canVote: p.canVote,
        idiotFlipped: p.idiotFlipped,
        thinkingLevel: p.thinkingLevel,
        avatarStyle: p.avatarStyle,
        votesReceived: p.votesReceived,
      })),
      round: this.round,
      phase: this.phase,
      status: this.status,
      winner: this.winner ?? null,
      reason: this.reason ?? null,
    };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function resolveMode(n: number, mode: "auto" | GameMode | undefined | null): GameMode {
  if (mode == null || mode === "auto") return modeForPlayerCount(n);
  return mode;
}

export { ROLE_LABEL };