import { Router, Request, Response } from "express";
import { Db } from "../db.js";
import { GameConfigInput } from "../types.js";
import {
  createGame,
  startGame,
  getGameState,
  getGameEvents,
  subscribe,
  controlGame,
  getReport,
} from "../manager.js";
import { PaceKey } from "../engine/engine.js";

export function gamesRouter(db: Db): Router {
  const r = Router();

  r.get("/", (req, res) => {
    const profileId = Number(req.query.profile_id ?? 0);
    const rows: any[] = profileId
      ? db
          .prepare(
            `SELECT g.*, (SELECT COUNT(*) FROM game_ai_mapping m WHERE m.game_id = g.id) AS player_count
             FROM game_sessions g WHERE g.id IN (SELECT game_id FROM game_ai_mapping WHERE profile_id = ?)
             ORDER BY g.id DESC LIMIT 50`
          )
          .all(profileId)
      : db
          .prepare(
            `SELECT g.*, (SELECT COUNT(*) FROM game_ai_mapping m WHERE m.game_id = g.id) AS player_count FROM game_sessions g ORDER BY g.id DESC LIMIT 100`
          )
          .all();
    res.json(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        mode: row.mode,
        winner: row.winner ?? null,
        reason: row.reason ?? null,
        rounds: row.rounds,
        player_count: row.player_count,
        started_at: row.started_at,
        finished_at: row.finished_at,
      }))
    );
  });

  r.post("/", (req, res) => {
    try {
      const config = req.body as GameConfigInput;
      const id = createGame(db, config);
      res.status(201).json({ id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.get("/:id", (req, res) => {
    try {
      res.json(getGameState(db, Number(req.params.id)));
    } catch (e: any) {
      res.status(404).json({ error: e.message });
    }
  });

  r.post("/:id/start", async (req, res) => {
    try {
      const paceInput = (req.body?.pace as PaceKey | undefined) ?? (typeof req.body?.speed_ms === "number" ? req.body.speed_ms : "slow");
      await startGame(db, Number(req.params.id), paceInput);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post("/:id/pause", (_req, res) => {
    controlGame(Number(_req.params.id), "pause");
    res.json({ ok: true });
  });
  r.post("/:id/resume", (_req, res) => {
    controlGame(Number(_req.params.id), "resume");
    res.json({ ok: true });
  });
  r.post("/:id/abort", (_req, res) => {
    controlGame(Number(_req.params.id), "abort");
    res.json({ ok: true });
  });

  r.get("/:id/report", (req, res) => {
    try {
      res.json(getReport(db, Number(req.params.id)));
    } catch (e: any) {
      res.status(404).json({ error: e.message });
    }
  });

  // 轮询用：返回 seq > after 的事件数组（短连接，Cloudflare Tunnel 等会缓冲 SSE 时仍可实时跟进）
  r.get("/:id/events-list", (req, res) => {
    const gameId = Number(req.params.id);
    try {
      getGameState(db, gameId);
    } catch {
      res.status(404).json({ error: "game not found" });
      return;
    }
    const after = Number(req.query.after ?? 0);
    res.json(getGameEvents(db, gameId, after));
  });

  r.get("/:id/events", (req, res) => {
    const gameId = Number(req.params.id);
    try {
      getGameState(db, gameId);
    } catch {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let after = Number(req.query.after ?? 0);
    const send = (evt: any) => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };
    // 先回放已发生事件
    for (const evt of getGameEvents(db, gameId, after)) {
      send(evt);
      after = evt.seq;
    }
    const unsubscribe = subscribe(gameId, send);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return r;
}