import { DecisionInput, DecisionOutput, GameEvent, GameMode, Role, ROLE_LABEL, Team, ThinkingLevel } from "../types.js";
export interface EnginePlayer {
    id: number;
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
    isHuman: boolean;
}
export type PhaseId = "night_wolf" | "night_seer" | "night_witch" | "day_announce" | "day_lastwords" | "day_speech" | "day_vote" | "day_result" | "game_over";
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
    onTokens: (playerId: number, usage: {
        thinkingTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    }) => void;
    pace?: PaceProfile;
    humanTimeoutMs?: number;
    validateRoles?: boolean;
    /**
     * 真人座位决策钩子（可选）。
     * 常驻进程模式下不传，走内置的 waitHumanInput（Promise 挂起 + 定时器托管）；
     * 无状态模式（Cloudflare Workers 的「快照 + 日志重放」驱动）传入此钩子，
     * 由驱动器决定「读日志 / 读收件箱 / 抛出挂起信号」，从而不依赖长生命周期进程。
     */
    humanDecide?: (player: EnginePlayer, requiredAction: DecisionInput["requiredAction"], phaseLabel: string) => Promise<DecisionOutput>;
}
/** 引擎状态快照：用于无状态环境下在「回合边界」持久化并恢复对局 */
export interface EngineSnapshot {
    v: 1;
    seq: number;
    round: number;
    phase: PhaseId;
    status: "created" | "running" | "paused" | "finished" | "aborted";
    winner?: Team;
    reason?: string;
    players: EnginePlayer[];
    nightKillTarget?: number;
    witchSavedTarget?: number;
    witchPoisonTarget?: number;
    seerCheckResults: [number, Team][];
    pendingDeaths: PendingDeath[];
    speechLog: SpeechEntry[];
    votes: [number, number | null][];
    pendingHunter?: {
        id: number;
        cause: "wolf" | "vote";
    };
    pendingLastWords?: number;
    lastRoundKillTarget?: number;
    voteEliminatedId?: number;
}
export type PaceKey = "slow" | "normal" | "fast";
export interface PaceProfile {
    night: number;
    speech: number;
    vote: number;
    lastwords: number;
    hunter: number;
    phaseGap: number;
}
export declare const PACES: Record<PaceKey, PaceProfile>;
export declare function resolvePace(input: PaceKey | number | undefined): PaceProfile;
export declare class WerewolfGame {
    players: EnginePlayer[];
    mode: GameMode;
    assignment: string;
    round: number;
    phase: PhaseId;
    status: "created" | "running" | "paused" | "finished" | "aborted";
    winner?: Team;
    reason?: string;
    nightKillTarget?: number;
    witchSavedTarget?: number;
    witchPoisonTarget?: number;
    seerCheckResults: Map<number, Team>;
    pendingDeaths: PendingDeath[];
    speechLog: SpeechEntry[];
    votes: Map<number, number | null>;
    pendingHunter?: {
        id: number;
        cause: "wolf" | "vote";
    };
    pendingLastWords?: number;
    lastRoundKillTarget?: number;
    private seq;
    private opts;
    private running;
    private pausedFlag;
    private abortedFlag;
    private stopRequested;
    private pendingHuman?;
    constructor(opts: EngineOpts);
    private emit;
    alive(role?: Role): EnginePlayer[];
    byId(id: number): EnginePlayer;
    private decideFor;
    private waitHumanInput;
    get pendingHumanSeat(): number | undefined;
    get pendingHumanAction(): DecisionInput["requiredAction"] | undefined;
    /** 真人提交行动后由 manager 调用，唤醒挂起的等待 */
    resolveHuman(out: DecisionOutput): boolean;
    /** 真人超时的默认合法决策（不调用 LLM，仅保证对局推进） */
    private autoDecision;
    private publicLogLines;
    privateInfoFor(p: EnginePlayer): string[];
    private validateOut;
    run(): Promise<void>;
    pause(): void;
    resume(): void;
    abort(): void;
    private waitIfPaused;
    private tick;
    /** 执行一轮（夜间 + 白天），返回是否终局 */
    private playRound;
    private nightWolf;
    private nightSeer;
    private nightWitch;
    private resolveNightDeaths;
    private announceNight;
    private processLastWordsAndHunter;
    private daySpeech;
    private dayVote;
    private voteEliminatedId?;
    private dayResult;
    checkGameOver(): boolean;
    /** 供无状态驱动器使用：只推进一个回合，返回是否终局 */
    runOneRound(): Promise<boolean>;
    /** 供无状态驱动器使用：标记开局并发出 game_started（只在首次调用时使用） */
    markStarted(): void;
    /**
     * 供无状态驱动器补发事件。
     * 关键约束：这些补发必须在「每一次重放里都无条件发生」，否则 seq 会错位。
     * 条件性的提示（例如真人超时托管）必须随决策一起写进日志，重放时照样补发。
     */
    emitHumanTurn(player: EnginePlayer, requiredAction: DecisionInput["requiredAction"], phaseLabel: string): void;
    systemNote(message: string, secret?: boolean): void;
    /** 真人超时托管的默认合法决策（公开给驱动器，供无状态模式下写入日志） */
    autoDecisionFor(player: EnginePlayer, requiredAction: DecisionInput["requiredAction"], phaseLabel?: string): DecisionOutput;
    /** 导出快照（只在回合边界调用，保证与 playRound 的重入点对齐） */
    snapshot(): EngineSnapshot;
    /** 从快照恢复（players 数组按 seat 覆盖，保持 opts.players 引用不变以便 decide 回调查找） */
    restore(s: EngineSnapshot): void;
    get state(): {
        players: {
            id: number;
            name: string;
            seat: number;
            role: Role;
            team: Team;
            alive: boolean;
            canVote: boolean;
            idiotFlipped: boolean;
            thinkingLevel: ThinkingLevel;
            avatarStyle: string;
            votesReceived: number;
        }[];
        round: number;
        phase: PhaseId;
        status: "created" | "running" | "paused" | "finished" | "aborted";
        winner: Team | null;
        reason: string | null;
    };
}
export declare function resolveMode(n: number, mode: "auto" | GameMode | undefined | null): GameMode;
export { ROLE_LABEL };
