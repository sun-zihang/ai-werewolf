import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Db } from "../src/db.js";
import {
  createGame,
  getHumanView,
  isRunning,
  joinHumanSeat,
  startGame,
  submitHumanAction,
} from "../src/manager.js";

let db: Db;
let tmpDir: string;

beforeAll(async () => {
  // 加速内存清理，便于验证「赛后内存清理仍可看胜负」
  process.env.AWW_CLEANUP_MS = "500";
  tmpDir = mkdtempSync(path.join(tmpdir(), "aww-human-"));
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

describe("真人视角 getHumanView 回归", () => {
  it("nameMap 含全部座位 且 赛后内存清理仍可看胜负", async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const row = db
        .prepare("INSERT INTO ai_profiles (name, provider, model, thinking_level) VALUES (?, 'local', 'local-engine', 'medium')")
        .run(`本地AI${i}`);
      ids.push(Number(row.lastInsertRowid));
    }

    const created = createGame(db, { ai_ids: ids, human_count: 1, mode: "auto", assignment: "random" });
    const gameId = created.id;
    const token = created.humanInvites[0].token;
    expect(token).toBeTruthy();

    joinHumanSeat(db, gameId, token, "测试真人");
    await startGame(db, gameId, 0);

    // 驱动真人行动直到对局结束
    let finishedView: any = null;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const v: any = getHumanView(db, gameId, token);
      if (v.status === "finished" || v.status === "aborted") {
        finishedView = v;
        break;
      }
      if (v.yourTurn) {
        let body: any = {};
        if (v.requiredAction === "day_speech" || v.requiredAction === "last_words") body = { content: "x" };
        else if (v.requiredAction === "night_save") body = {};
        else if (v.options && v.options.length) body = { target_id: v.options[0].id };
        submitHumanAction(db, gameId, token, body);
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    expect(finishedView).not.toBeNull();
    expect(finishedView.status).toBe("finished");

    // 修复 A：nameMap 含全部 6 个座位，且已加入真人名字正确
    const seats = Object.keys(finishedView.nameMap).map(Number).sort((a, b) => a - b);
    expect(seats).toEqual([1, 2, 3, 4, 5, 6]);
    expect(finishedView.nameMap[finishedView.seat]).toBe("测试真人");

    // 修复 D（rg 存在时）：winner / reason 可见
    expect(["wolf", "good"]).toContain(finishedView.winner);
    expect(typeof finishedView.reason).toBe("string");

    // 等待内存清理（AWW_CLEANUP_MS=500 后 isRunning 变 false）
    let cleared = false;
    const dl2 = Date.now() + 5000;
    while (Date.now() < dl2) {
      if (!isRunning(gameId)) {
        cleared = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(cleared).toBe(true);

    // 修复 D（rg 已删，读 session）：winner / reason / nameMap 仍可见
    const afterView: any = getHumanView(db, gameId, token);
    expect(afterView.status).toBe("finished");
    expect(afterView.winner).toBe(finishedView.winner);
    expect(afterView.reason).toBe(finishedView.reason);
    expect(Object.keys(afterView.nameMap)).toHaveLength(6);
  }, 90000);
});
