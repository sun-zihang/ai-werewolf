import type { Env } from "./env.js";

/**
 * D1 表结构。与本地 sqlite（server/src/db.ts）保持字段兼容，另外为「无状态推进」新增三张表：
 *  - game_runtime : 每局一行，存回合起点快照 / 事件最大 seq / 待真人操作 / 推进锁
 *  - game_journal : 决策日志（按回合分段），重放时按顺序喂给引擎，保证结果可复现
 *  - human_inbox  : 真人提交的行动收件箱，驱动器下一次推进时消费并写入日志
 */
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    base_url_override TEXT,
    api_key_enc TEXT,
    thinking_level TEXT NOT NULL DEFAULT 'medium',
    role_preference TEXT NOT NULL DEFAULT '[]',
    language_style TEXT NOT NULL DEFAULT '自然',
    avatar_style TEXT NOT NULL DEFAULT 'ink',
    description TEXT NOT NULL DEFAULT '',
    stats_play_count INTEGER NOT NULL DEFAULT 0,
    stats_win_count INTEGER NOT NULL DEFAULT 0,
    stats_mvp_count INTEGER NOT NULL DEFAULT 0,
    total_tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    mode TEXT NOT NULL,
    assignment TEXT NOT NULL,
    winner TEXT,
    reason TEXT,
    rounds INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS game_ai_mapping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    role TEXT NOT NULL,
    team TEXT NOT NULL,
    alive INTEGER NOT NULL DEFAULT 1,
    thinking_level TEXT NOT NULL DEFAULT 'medium',
    win INTEGER NOT NULL DEFAULT 0,
    mvp INTEGER NOT NULL DEFAULT 0,
    speech_count INTEGER NOT NULL DEFAULT 0,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    is_human INTEGER NOT NULL DEFAULT 0,
    human_token TEXT,
    human_name TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mapping_game ON game_ai_mapping (game_id, seat)`,
  `CREATE INDEX IF NOT EXISTS idx_mapping_token ON game_ai_mapping (game_id, human_token)`,
  `CREATE INDEX IF NOT EXISTS idx_mapping_profile ON game_ai_mapping (profile_id)`,
  `CREATE TABLE IF NOT EXISTS game_events (
    game_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (game_id, seq)
  )`,
  `CREATE TABLE IF NOT EXISTS preset_lineups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ai_ids TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS game_runtime (
    game_id INTEGER PRIMARY KEY,
    snapshot TEXT NOT NULL,
    max_seq INTEGER NOT NULL DEFAULT 0,
    pace TEXT NOT NULL DEFAULT 'normal',
    paused INTEGER NOT NULL DEFAULT 0,
    pending_json TEXT,
    lock_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS game_journal (
    game_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (game_id, round, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS human_inbox (
    game_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (game_id, round, idx)
  )`,
];

let ready: Promise<void> | null = null;

/** 幂等建表；每个 isolate 只执行一次 */
export function ensureSchema(env: Env): Promise<void> {
  if (!ready) {
    ready = env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)))
      .then(() => undefined)
      .catch((e) => {
        ready = null; // 失败后允许下次重试
        throw e;
      });
  }
  return ready;
}

export const SCHEMA_DDL = DDL;
