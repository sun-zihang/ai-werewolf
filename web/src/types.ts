export type ThinkingLevel = "paper" | "medium" | "high" | "extra";
export const LEVEL_LABEL: Record<ThinkingLevel, string> = { paper: "低", medium: "中", high: "高", extra: "特高" };
export const LEVELS: ThinkingLevel[] = ["paper", "medium", "high", "extra"];

export type Role = "werewolf" | "villager" | "seer" | "witch" | "hunter" | "idiot";
export type Team = "wolf" | "good";
export const ROLE_LABEL: Record<Role, string> = {
  werewolf: "狼人", villager: "村民", seer: "预言家", witch: "女巫", hunter: "猎人", idiot: "白痴",
};
export const TEAM_LABEL: Record<Team, string> = { wolf: "狼人阵营", good: "好人阵营" };
export const ROLES: Role[] = ["werewolf", "villager", "seer", "witch", "hunter", "idiot"];

export type GameMode = "simple" | "standard" | "complex";
export type RoleAssignment = "random" | "strength" | "preference";
export const MODE_LABEL: Record<GameMode, string> = { simple: "简易（2-4 人）", standard: "标准（5-8 人）", complex: "复杂（9-12 人）" };

export type GameStatus = "created" | "running" | "paused" | "finished" | "aborted";
export const STATUS_LABEL: Record<GameStatus, string> = {
  created: "待开始", running: "进行中", paused: "已暂停", finished: "已结束", aborted: "已中止",
};

export interface ProviderMeta {
  id: string;
  label: string;
  kind: "openai" | "gemini" | "local";
  baseUrl: string;
  defaultModels: string[];
  needsKey: boolean;
  note?: string;
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

export interface GameListItem {
  id: number;
  status: GameStatus;
  mode: GameMode;
  winner: Team | null;
  reason: string | null;
  rounds: number;
  player_count: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface GamePlayer {
  id: number;
  profileId: number;
  name: string;
  seat: number;
  role: Role;
  team: Team;
  alive: boolean;
  thinkingLevel: ThinkingLevel;
  avatarStyle: string;
}

export interface GameState {
  id: number;
  status: GameStatus;
  mode: GameMode;
  assignment: string;
  round: number;
  phase: string;
  winner: Team | null;
  reason: string | null;
  players: GamePlayer[];
  created_at: string;
}

export interface GameEvent {
  type: string;
  seq: number;
  round: number;
  ts: number;
  secret?: boolean;
  [k: string]: unknown;
}

export interface ReportPlayer {
  id: number;
  name: string;
  role: Role;
  team: Team;
  alive: boolean;
  win: boolean;
  mvp: boolean;
  speechCount: number;
  tokensUsed: number;
}

export interface GameReport {
  gameId: number;
  winner: Team;
  reason: string;
  rounds: number;
  startedAt: string;
  finishedAt: string;
  players: ReportPlayer[];
}

export interface Preset {
  id: number;
  name: string;
  ai_ids: number[];
  config: Record<string, unknown>;
  created_at: string;
}

/** 真人占座邀请（房主创建对局后下发，用于生成加入链接） */
export interface HumanInvite {
  seat: number;
  token: string;
}

export interface CreateGameResult {
  id: number;
  humanInvites?: HumanInvite[];
}

/** 真人玩家视角（自己的私密信息 + 当前可操作项 + 公共时间线） */
export interface HumanView {
  gameId: number;
  seat: number;
  isHuman: boolean;
  joined: boolean;
  myName: string | null;
  humans: { seat: number; name: string | null }[];
  /** 全部玩家 seat → 显示名映射，用于把时间线事件里的 playerId/targetId 解析成名字 */
  nameMap: Record<number, string>;
  status: GameStatus;
  round: number;
  phase: string;
  role?: Role;
  privateInfo: string[];
  yourTurn: boolean;
  requiredAction?: string;
  options: { id: number; name: string; seat: number }[];
  timeline: GameEvent[];
  winner?: Team | null;
  reason?: string | null;
}