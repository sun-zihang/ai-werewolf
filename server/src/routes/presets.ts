import { Router } from "express";
import { Db } from "../db.js";

export function presetsRouter(db: Db): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    const rows: any[] = db.prepare("SELECT * FROM preset_lineups ORDER BY created_at DESC").all();
    res.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        ai_ids: JSON.parse(row.ai_ids),
        config: JSON.parse(row.config_json),
        created_at: row.created_at,
      }))
    );
  });

  r.post("/", (req, res) => {
    const { name, ai_ids, config } = req.body ?? {};
    if (!name || !Array.isArray(ai_ids) || !ai_ids.length) {
      return res.status(400).json({ error: "缺少名称或 AI 列表" });
    }
    const info = db
      .prepare("INSERT INTO preset_lineups (name, ai_ids, config_json) VALUES (?, ?, ?)")
      .run(String(name), JSON.stringify(ai_ids), JSON.stringify(config ?? {}));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.delete("/:id", (req, res) => {
    db.prepare("DELETE FROM preset_lineups WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
}