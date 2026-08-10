import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Db } from "../src/db.js";
import { createGame, getGameEvents, getGameState, getReport, startGame } from "../src/manager.js";

let db: Db;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "aww-test-"));
  process.env.AWW_DATA_DIR = tmpDir;
  const { openDb } = await import("../src/db.js");
  db = openDb();
});

afterAll(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("端到端：本地规则引擎完整对局", () => {
  it("创建 5 个本地 AI → 开 5 人局 → 跑到结束 → 报告正确", async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const row = db
        .prepare("INSERT INTO ai_profiles (name, provider, model, thinking_level) VALUES (?, 'local', 'local-engine', 'medium')")
        .run(`本地AI${i}`);
      ids.push(Number(row.lastInsertRowid));
    }

    const gameId = createGame(db, { ai_ids: ids, mode: "auto", assignment: "random" });
    expect(gameId).toBeGreaterThan(0);

    const state0 = getGameState(db, gameId);
    expect(state0.players).toHaveLength(5);
    expect(state0.status).toBe("created");

    await startGame(db, gameId, 0);

    let state = getGameState(db, gameId);
    const deadline = Date.now() + 20000;
    while (state.status !== "finished" && state.status !== "aborted" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      state = getGameState(db, gameId);
    }
    expect(state.status).toBe("finished");
    expect(["wolf", "good"]).toContain(state.winner);

    const events = getGameEvents(db, gameId);
    expect(events.length).toBeGreaterThan(10);
    expect(events.some((e) => e.type === "game_over")).toBe(true);
    expect(events.some((e) => e.type === "speech")).toBe(true);

    const report = getReport(db, gameId);
    expect(report.players).toHaveLength(5);
    expect(report.players.filter((p) => p.win).length).toBeGreaterThan(0);
    expect(report.players.filter((p) => p.mvp).length).toBe(1);

    const row: any = db.prepare("SELECT stats_play_count FROM ai_profiles WHERE id = ?").get(ids[0]);
    expect(row.stats_play_count).toBe(1);
  });

  it("非法配置（超 12 人）被拒绝", async () => {
    expect(() =>
      createGame(db, { ai_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], mode: "auto", assignment: "random" })
    ).toThrow(/2-12/);
  });
});