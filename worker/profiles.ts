import { providerById, PROVIDERS } from "../server/lib/ai/providers.js";
import { callProvider } from "../server/lib/ai/adapters.js";
import type { AiProfilePublic, ThinkingLevel } from "../server/lib/types.js";
import { THINKING_LEVELS } from "../server/lib/types.js";
import type { Env } from "./env.js";
import { encryptSecret, decryptSecret } from "./webcrypto.js";

const MAX_PROFILES = 50;

type Row = Record<string, any>;

function safeJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function profileToPublic(row: Row): AiProfilePublic {
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

interface ParsedInput {
  name?: string;
  provider?: string;
  model?: string;
  thinking_level?: ThinkingLevel;
  base_url_override?: string;
  api_key?: string;
  role_preference?: unknown[];
  language_style?: string;
  avatar_style?: string;
  description?: string;
}

function parseInput(body: Row, partial = false): ParsedInput {
  const out: ParsedInput = {};
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) throw new Error("名称不能为空");
    out.name = String(body.name).trim();
  }
  if (!partial || body.provider !== undefined) {
    if (!providerById(body.provider)) throw new Error("不支持的厂商");
    out.provider = body.provider;
  }
  if (!partial || body.model !== undefined) {
    if (!body.model || !String(body.model).trim()) throw new Error("模型不能为空");
    out.model = String(body.model).trim();
  }
  if (body.thinking_level !== undefined) {
    if (!THINKING_LEVELS.includes(body.thinking_level)) throw new Error("无效的思考强度");
    out.thinking_level = body.thinking_level;
  }
  if (body.base_url_override !== undefined) out.base_url_override = String(body.base_url_override).trim() || undefined;
  if (body.api_key !== undefined) out.api_key = String(body.api_key);
  if (body.role_preference !== undefined) out.role_preference = Array.isArray(body.role_preference) ? body.role_preference : [];
  if (body.language_style !== undefined) out.language_style = String(body.language_style);
  if (body.avatar_style !== undefined) out.avatar_style = String(body.avatar_style);
  if (body.description !== undefined) out.description = String(body.description);
  return out;
}

async function getRow(env: Env, id: number): Promise<Row | null> {
  return env.DB.prepare("SELECT * FROM ai_profiles WHERE id=?").bind(id).first<Row>();
}

async function count(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM ai_profiles").first<{ c: number }>();
  return Number(r?.c ?? 0);
}

export async function listProfiles(env: Env): Promise<AiProfilePublic[]> {
  const r = await env.DB.prepare("SELECT * FROM ai_profiles ORDER BY created_at DESC, id DESC").all<Row>();
  return (r.results ?? []).map(profileToPublic);
}

export async function getProfile(env: Env, id: number): Promise<AiProfilePublic> {
  const row = await getRow(env, id);
  if (!row) throw new Error("AI 档案不存在");
  return profileToPublic(row);
}

const INSERT_SQL = `INSERT INTO ai_profiles (name, provider, model, base_url_override, api_key_enc, thinking_level, role_preference, language_style, avatar_style, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export async function createProfile(env: Env, body: Row): Promise<AiProfilePublic> {
  const input = parseInput(body);
  if ((await count(env)) >= MAX_PROFILES) throw new Error(`AI 档案数量已达上限（${MAX_PROFILES}）`);
  const enc = input.api_key ? await encryptSecret(env, input.api_key) : null;
  const ins = await env.DB
    .prepare(INSERT_SQL)
    .bind(
      input.name,
      input.provider,
      input.model,
      input.base_url_override ?? null,
      enc,
      input.thinking_level ?? "medium",
      JSON.stringify(input.role_preference ?? []),
      input.language_style ?? "自然",
      input.avatar_style ?? "ink",
      input.description ?? ""
    )
    .run();
  return getProfile(env, Number(ins.meta.last_row_id));
}

export async function updateProfile(env: Env, id: number, body: Row): Promise<AiProfilePublic> {
  const row = await getRow(env, id);
  if (!row) throw new Error("AI 档案不存在");
  const input = parseInput(body, true);
  const apiKeyEnc = input.api_key !== undefined && input.api_key !== "" ? await encryptSecret(env, input.api_key) : row.api_key_enc;
  await env.DB
    .prepare(
      `UPDATE ai_profiles SET name=?, provider=?, model=?, base_url_override=?, api_key_enc=?, thinking_level=?, role_preference=?, language_style=?, avatar_style=?, description=?, updated_at=datetime('now') WHERE id=?`
    )
    .bind(
      input.name ?? row.name,
      input.provider ?? row.provider,
      input.model ?? row.model,
      input.base_url_override !== undefined ? input.base_url_override : row.base_url_override,
      apiKeyEnc,
      input.thinking_level ?? row.thinking_level,
      JSON.stringify(input.role_preference ?? safeJson(row.role_preference, [])),
      input.language_style ?? row.language_style,
      input.avatar_style ?? row.avatar_style,
      input.description ?? row.description,
      id
    )
    .run();
  return getProfile(env, id);
}

export async function deleteProfile(env: Env, id: number): Promise<{ ok: boolean }> {
  const row = await getRow(env, id);
  if (!row) throw new Error("AI 档案不存在");
  await env.DB.prepare("DELETE FROM ai_profiles WHERE id=?").bind(id).run();
  return { ok: true };
}

export async function importProfiles(env: Env, profiles: Row[]): Promise<{ created: number[] }> {
  if (!Array.isArray(profiles) || !profiles.length) throw new Error("缺少 profiles 数组");
  if ((await count(env)) + profiles.length > MAX_PROFILES) throw new Error(`导入后总数将超过上限（${MAX_PROFILES}）`);
  const created: number[] = [];
  for (const p of profiles) {
    const input = parseInput(p);
    const enc = input.api_key ? await encryptSecret(env, input.api_key) : null;
    const ins = await env.DB
      .prepare(INSERT_SQL)
      .bind(
        input.name,
        input.provider,
        input.model,
        input.base_url_override ?? null,
        enc,
        input.thinking_level ?? "medium",
        JSON.stringify(input.role_preference ?? []),
        input.language_style ?? "自然",
        input.avatar_style ?? "ink",
        input.description ?? ""
      )
      .run();
    created.push(Number(ins.meta.last_row_id));
  }
  return { created };
}

export async function testProfile(env: Env, id: number, apiKeyInput?: string): Promise<Record<string, unknown>> {
  const row = await getRow(env, id);
  if (!row) throw new Error("AI 档案不存在");
  const provider = providerById(row.provider);
  if (!provider || provider.kind === "local") return { ok: true, latencyMs: 0, note: "本地规则引擎无需测试" };
  const apiKey = apiKeyInput && apiKeyInput !== "" ? String(apiKeyInput) : row.api_key_enc ? await decryptSecret(env, row.api_key_enc) : "";
  if (!apiKey) throw new Error("未配置 API 密钥");
  const t0 = Date.now();
  await callProvider({
    provider,
    apiKey,
    model: row.model,
    baseUrlOverride: row.base_url_override,
    messages: [
      { role: "system", content: "你是连通性测试助手。" },
      { role: "user", content: "回复 OK" },
    ],
    thinkingLevel: "paper" as ThinkingLevel,
    maxTokens: 10,
    jsonMode: false,
  });
  return { ok: true, latencyMs: Date.now() - t0 };
}

// ---------- 预设阵容 ----------

export async function listPresets(env: Env): Promise<Record<string, unknown>[]> {
  const r = await env.DB.prepare("SELECT * FROM preset_lineups ORDER BY created_at DESC, id DESC").all<Row>();
  return (r.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    ai_ids: safeJson(row.ai_ids, []),
    config: safeJson(row.config_json, {}),
    created_at: row.created_at,
  }));
}

export async function savePreset(env: Env, body: Row): Promise<{ id: number }> {
  const { name, ai_ids, config } = body ?? {};
  if (!name || !Array.isArray(ai_ids) || !ai_ids.length) throw new Error("缺少名称或 AI 列表");
  const ins = await env.DB
    .prepare("INSERT INTO preset_lineups (name, ai_ids, config_json) VALUES (?, ?, ?)")
    .bind(String(name), JSON.stringify(ai_ids), JSON.stringify(config ?? {}))
    .run();
  return { id: Number(ins.meta.last_row_id) };
}

export async function deletePreset(env: Env, id: number): Promise<{ ok: boolean }> {
  await env.DB.prepare("DELETE FROM preset_lineups WHERE id=?").bind(id).run();
  return { ok: true };
}

export function listProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    baseUrl: p.baseUrl,
    defaultModels: p.defaultModels,
    needsKey: p.needsKey,
    note: p.note,
  }));
}
