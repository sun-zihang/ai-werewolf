export type ThinkingLevel = "paper" | "medium" | "high" | "extra";
export declare const THINKING_LEVELS: ThinkingLevel[];
export type Role = "werewolf" | "villager" | "seer" | "witch" | "hunter" | "idiot";
export type Team = "wolf" | "good";
export declare const ROLES: Role[];
export declare const ROLE_LABEL: Record<Role, string>;
export declare const TEAM_LABEL: Record<Team, string>;
export type GameMode = "simple" | "standard" | "complex";
export interface AiProfileInput {
    name: string;
    provider: string;
    model: string;
    base_url_override?: string;
    api_key?: string;
    thinking_level: ThinkingLevel;
    role_preference?: Role[];
    language_style?: string;
    avatar_style?: string;
    description?: string;
}
export interface AiProfilePublic {
    id: number;
    name: string;
    provider: string;
    provider_label: string;
    model: string;
    base_url_override: string | null;
    thinking_level: ThinkingLevel;
    role_preference: Role[];
    language_style: string;
    avatar_style: string;
    description: string;
    has_key: boolean;
    stats_win_rate: number;
    stats_play_count: number;
    stats_mvp_count: number;
    total_tokens_used: number;
    created_at: string;
    updated_at: string;
}
export type GameStatus = "created" | "running" | "paused" | "finished" | "aborted";
export type RoleAssignment = "random" | "strength" | "preference";
export interface GameConfigInput {
    ai_ids: number[];
    mode: "auto" | GameMode;
    assignment: RoleAssignment;
    overrides?: Record<string, ThinkingLevel>;
    human_count?: number;
}
export interface PlayerView {
    id: number;
    profileId: number | null;
    name: string;
    seat: number;
    role: Role;
    team: Team;
    alive: boolean;
    thinkingLevel: ThinkingLevel;
    avatarStyle: string;
    isHuman?: boolean;
    humanName?: string | null;
}
export interface BaseEvent {
    type: string;
    seq: number;
    round: number;
    ts: number;
    secret?: boolean;
}
export type GameEvent = (BaseEvent & {
    type: "game_started";
    mode: GameMode;
    assignment: string;
}) | (BaseEvent & {
    type: "phase";
    phase: string;
    label: string;
}) | (BaseEvent & {
    type: "system";
    message: string;
}) | (BaseEvent & {
    type: "ai_thinking";
    playerId: number;
    status: "start" | "done" | "error" | "fallback";
    level?: ThinkingLevel;
    ms?: number;
}) | (BaseEvent & {
    type: "night_action";
    playerId: number;
    action: "kill" | "check" | "save" | "poison" | "none";
    targetId?: number;
    content?: string;
    role: Role;
}) | (BaseEvent & {
    type: "death";
    playerId: number;
    cause: "wolf" | "vote" | "poison" | "hunter";
    revealRole: boolean;
}) | (BaseEvent & {
    type: "speech";
    playerId: number;
    content: string;
    level: ThinkingLevel;
}) | (BaseEvent & {
    type: "vote";
    playerId: number;
    targetId: number | null;
    reveal: boolean;
}) | (BaseEvent & {
    type: "vote_result";
    counts: Record<number, number>;
    eliminatedId: number | null;
    tie?: boolean;
}) | (BaseEvent & {
    type: "idiot_flip";
    playerId: number;
}) | (BaseEvent & {
    type: "hunter_shot";
    playerId: number;
    targetId?: number;
    content?: string;
}) | (BaseEvent & {
    type: "last_words";
    playerId: number;
    content: string;
}) | (BaseEvent & {
    type: "human_turn";
    playerId: number;
    seat: number;
    action: string;
    label: string;
}) | (BaseEvent & {
    type: "game_over";
    winner: Team;
    reason: string;
});
export interface DecisionInput {
    player: {
        id: number;
        name: string;
        seat: number;
        role: Role;
        team: Team;
        alive: boolean;
    };
    thinkingLevel: ThinkingLevel;
    requiredAction: "night_kill" | "night_check" | "night_save" | "night_poison" | "day_speech" | "day_vote" | "hunter_shot" | "last_words";
    context: {
        round: number;
        phaseLabel: string;
        alive: {
            id: number;
            name: string;
            seat: number;
        }[];
        publicLog: string[];
        privateInfo: string[];
    };
}
export interface DecisionOutput {
    action: string;
    target_id?: number | null;
    content?: string;
    reason?: string;
}
export interface GameReport {
    gameId: number;
    winner: Team;
    reason: string;
    rounds: number;
    startedAt: string;
    finishedAt: string;
    players: {
        id: number;
        name: string;
        role: Role;
        team: Team;
        alive: boolean;
        win: boolean;
        mvp: boolean;
        speechCount: number;
        tokensUsed: number;
    }[];
}
export interface ProviderMeta {
    id: string;
    label: string;
    kind: "openai" | "gemini" | "local";
    baseUrl: string;
    defaultModels: string[];
    needsKey: boolean;
    note?: string;
}
