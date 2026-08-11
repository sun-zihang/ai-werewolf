import { Router, Request, Response } from "express";
import { Db } from "../db.js";
import { providerById, providerLabel } from "../ai/providers.js";
import { LEVEL_META } from "../ai/adapters.js";
import { encryptSecret, decryptSecret } from "../crypto.js";
import { AiProfileInput, ThinkingLevel, THINKING_LEVELS } from "../types.js";
import { profileToPublic } from "../manager.js";
import { turnstileGuard } from "../turnstile.js";

const MAX_PROFILES = 50;

export function aiProfileRouter(db: Db): Router {
  const r = Router();

  const getRow = (id: number): any => db.prepare("SELECT * FROM ai_profiles WHERE id = ?").get(id);

  r.get("/", (_req, res) => {
    const rows: any[] = db.prepare("SELECT * FROM ai_profiles ORDER BY created_at DESC").all();
    res.json(rows.map(profileToPublic));
  });

  r.get("/:id", (req, res) => {
    const row = getRow(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "AI 档案不存在" });
    res.json(profileToPublic(row));
  });

  r.post("/", turnstileGuard({ action: "create_profile" }), (req, res) => {
    try {
      const input = parseInput(req.body);
      const count = (db.prepare("SELECT COUNT(*) c FROM ai_profiles").get() as any).c;
      if (count >= MAX_PROFILES) return res.status(400).json({ error: `AI 档案数量已达上限（${MAX_PROFILES}）` });
      const info = db
        .prepare(
          `INSERT INTO ai_profiles (name, provider, model, base_url_override, api_key_enc, thinking_level, role_preference, language_style, avatar_style, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.name,
          input.provider,
          input.model,
          input.base_url_override ?? null,
          input.api_key ? encryptSecret(input.api_key) : null,
          input.thinking_level,
          JSON.stringify(input.role_preference ?? []),
          input.language_style ?? "自然",
          input.avatar_style ?? "ink",
          input.description ?? ""
        );
      res.status(201).json(profileToPublic(getRow(Number(info.lastInsertRowid))));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.put("/:id", (req, res) => {
    const id = Number(req.params.id);
    const row = getRow(id);
    if (!row) return res.status(404).json({ error: "AI 档案不存在" });
    try {
      const input = parseInput(req.body, true);
      const apiKeyEnc = input.api_key !== undefined && input.api_key !== "" ? encryptSecret(input.api_key) : row.api_key_enc;
      db.prepare(
        `UPDATE ai_profiles SET name=?, provider=?, model=?, base_url_override=?, api_key_enc=?, thinking_level=?, role_preference=?, language_style=?, avatar_style=?, description=?, updated_at=datetime('now','localtime') WHERE id=?`
      ).run(
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
      );
      res.json(profileToPublic(getRow(id)));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!getRow(id)) return res.status(404).json({ error: "AI 档案不存在" });
    db.prepare("DELETE FROM ai_profiles WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  r.post("/import", (req, res) => {
    try {
      const profiles: AiProfileInput[] = req.body?.profiles ?? [];
      if (!Array.isArray(profiles) || !profiles.length) return res.status(400).json({ error: "缺少 profiles 数组" });
      const count = (db.prepare("SELECT COUNT(*) c FROM ai_profiles").get() as any).c;
      if (count + profiles.length > MAX_PROFILES) {
        return res.status(400).json({ error: `导入后总数将超过上限（${MAX_PROFILES}）` });
      }
      const ins = db.prepare(
        `INSERT INTO ai_profiles (name, provider, model, base_url_override, api_key_enc, thinking_level, role_preference, language_style, avatar_style, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const created: number[] = [];
      for (const p of profiles) {
        const input = parseInput(p);
        const info = ins.run(
          input.name,
          input.provider,
          input.model,
          input.base_url_override ?? null,
          input.api_key ? encryptSecret(input.api_key) : null,
          input.thinking_level,
          JSON.stringify(input.role_preference ?? []),
          input.language_style ?? "自然",
          input.avatar_style ?? "ink",
          input.description ?? ""
        );
        created.push(Number(info.lastInsertRowid));
      }
      res.status(201).json({ created });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post("/:id/test", async (req, res) => {
    const id = Number(req.params.id);
    const row = getRow(id);
    if (!row) return res.status(404).json({ error: "AI 档案不存在" });
    const provider = providerById(row.provider);
    if (!provider || provider.kind === "local") {
      return res.json({ ok: true, latencyMs: 0, note: "本地规则引擎无需测试" });
    }
    const apiKey = req.body?.api_key && req.body.api_key !== "" ? String(req.body.api_key) : row.api_key_enc ? decryptSecret(row.api_key_enc) : "";
    if (!apiKey) return res.status(400).json({ error: "未配置 API 密钥" });
    const t0 = Date.now();
    try {
      const { callProvider } = await import("../ai/adapters.js");
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
      res.json({ ok: true, latencyMs: Date.now() - t0 });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  return r;
}

function parseInput(body: any, partial = false): AiProfileInput {
  const out: any = {};
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
  return out as AiProfileInput;
}

function safeJson(s: string, fallback: any): any {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export { providerLabel, LEVEL_META };