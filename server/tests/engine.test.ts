import { describe, expect, it } from "vitest";
import { compositionFor, modeForPlayerCount } from "../src/engine/roles.js";
import { WerewolfGame } from "../src/engine/engine.js";
import { DecisionInput, DecisionOutput } from "../src/types.js";
import { aliveWolves, byRole, eventSink, makePlayers, runToEnd, simpleDecide } from "./helpers.js";

describe("角色组成表", () => {
  it("简易 3/4 人", () => {
    expect(compositionFor(3, "simple")).toEqual(["werewolf", "villager", "villager"]);
    expect(compositionFor(4, "simple")).toEqual(["werewolf", "seer", "villager", "villager"]);
  });
  it("标准 5-8 人", () => {
    expect(compositionFor(5, "standard")).toEqual(["werewolf", "seer", "witch", "villager", "villager"]);
    expect(compositionFor(8, "standard")).toHaveLength(8);
    expect(compositionFor(8, "standard").filter((r) => r === "werewolf")).toHaveLength(2);
  });
  it("复杂 9-12 人含白痴", () => {
    expect(compositionFor(9, "complex")).toHaveLength(9);
    expect(compositionFor(9, "complex").filter((r) => r === "idiot")).toHaveLength(1);
    expect(compositionFor(12, "complex")).toHaveLength(12);
  });
  it("自动定档", () => {
    expect(modeForPlayerCount(3)).toBe("simple");
    expect(modeForPlayerCount(6)).toBe("standard");
    expect(modeForPlayerCount(10)).toBe("complex");
  });
  it("越界人数抛错", () => {
    expect(() => compositionFor(2, "simple")).toThrow();
    expect(() => compositionFor(13, "complex")).toThrow();
  });
});

function newGame(players: ReturnType<typeof makePlayers>, decide: (i: DecisionInput) => Promise<DecisionOutput> | DecisionOutput, evts: any[] = []) {
  return new WerewolfGame({
    players,
    mode: "simple",
    assignment: "random",
    emit: eventSink(evts),
    decide: async (i) => decide(i),
    validate: () => null,
    onTokens: () => {},
    pace: { night: 0, speech: 0, vote: 0, lastwords: 0, hunter: 0, phaseGap: 0 },
    validateRoles: false,
  });
}

describe("游戏引擎", () => {
  it("完整跑一局 5 人标准局直至分出胜负", async () => {
    const players = makePlayers(compositionFor(5, "standard"));
    const evts: any[] = [];
    const game = newGame(players, simpleDecide, evts);
    await runToEnd(game);
    expect(game.status).toBe("finished");
    expect(["wolf", "good"]).toContain(game.winner);
    expect(evts.some((e) => e.type === "game_over")).toBe(true);
  });

  it("狼人全灭时好人获胜", async () => {
    const players = makePlayers(["werewolf", "werewolf", "villager", "villager", "villager"]);
    let g: WerewolfGame;
    g = newGame(players, (input) => {
      if (input.requiredAction === "night_kill") return { action: "kill", target_id: null, reason: "空刀" };
      if (input.requiredAction === "day_vote") {
        const wolf = aliveWolves(g)[0];
        return { action: "vote", target_id: wolf?.id ?? null, reason: "投狼" };
      }
      return simpleDecide(input);
    });
    await runToEnd(g);
    expect(g.winner).toBe("good");
  });

  it("白痴被票翻牌免死并失去投票权", async () => {
    const players = makePlayers(["werewolf", "idiot", "villager", "villager"], { names: ["狼", "白痴", "村民甲", "村民乙"] });
    let g: WerewolfGame;
    g = newGame(players, (input) => {
      if (input.requiredAction === "night_kill") {
        const villager = players.find((p) => p.role === "villager" && p.alive)!;
        return { action: "kill", target_id: villager.id, reason: "刀村民" };
      }
      if (input.requiredAction === "day_vote") {
        const idiot = players.find((p) => p.role === "idiot")!;
        return { action: "vote", target_id: idiot.alive ? idiot.id : null, reason: "投白痴" };
      }
      return simpleDecide(input);
    });
    await runToEnd(g);
    const idiot = byRole(g, "idiot");
    expect(idiot.alive).toBe(true);
    expect(idiot.canVote).toBe(false);
    expect(idiot.idiotFlipped).toBe(true);
  });

  it("猎人被票出局可开枪带走目标", async () => {
    const players = makePlayers(["werewolf", "hunter", "villager"], { names: ["狼", "猎人", "村民"] });
    const evts: any[] = [];
    let g: WerewolfGame;
    g = newGame(players, (input) => {
      if (input.requiredAction === "night_kill") return { action: "kill", target_id: null, reason: "空刀" };
      if (input.requiredAction === "day_vote") {
        const hunter = players.find((p) => p.role === "hunter")!;
        return { action: "vote", target_id: hunter.alive ? hunter.id : null, reason: "投猎人" };
      }
      if (input.requiredAction === "hunter_shot") {
        const wolf = players.find((p) => p.role === "werewolf" && p.alive)!;
        return { action: "shoot", target_id: wolf ? wolf.id : null, reason: "枪狼" };
      }
      return simpleDecide(input);
    }, evts);
    await runToEnd(g);
    const shot = evts.find((e) => e.type === "hunter_shot" && e.targetId !== undefined);
    expect(shot).toBeTruthy();
    expect(byRole(g, "werewolf").alive).toBe(false);
    expect(g.winner).toBe("good");
  });

  it("女巫救下被刀者则平安夜且消耗解药", async () => {
    const players = makePlayers(["werewolf", "witch", "villager"], { names: ["狼", "女巫", "村民"] });
    const evts: any[] = [];
    let g: WerewolfGame;
    g = newGame(players, (input) => {
      if (input.requiredAction === "night_kill") {
        const villager = players.find((p) => p.role === "villager")!;
        return { action: "kill", target_id: villager.id, reason: "刀村民" };
      }
      if (input.requiredAction === "night_save") {
        return { action: "save", target_id: g.nightKillTarget ?? null, reason: "救人" };
      }
      if (input.requiredAction === "day_vote") {
        const wolf = players.find((p) => p.role === "werewolf")!;
        return { action: "vote", target_id: wolf.alive ? wolf.id : null, reason: "投狼" };
      }
      return simpleDecide(input);
    }, evts);
    await runToEnd(g);
    expect(byRole(g, "witch").witchAntidote).toBe(false);
    expect(evts.some((e) => e.type === "system" && String(e.message).includes("平安夜"))).toBe(true);
  });

  it("平票时无人出局", async () => {
    const players = makePlayers(["werewolf", "werewolf", "villager", "villager", "villager"]);
    const evts: any[] = [];
    let g: WerewolfGame;
    g = newGame(players, (input) => {
      if (input.requiredAction === "night_kill") return { action: "kill", target_id: null, reason: "空刀" };
      if (input.requiredAction === "day_vote") {
        if (g.round === 1) {
          // 平票：1、2 投 3；3、4 投 1；5 投 4 → 3:2、1:2、4:1
          const map: Record<number, number> = { 1: 3, 2: 3, 3: 1, 4: 1, 5: 4 };
          return { action: "vote", target_id: map[input.player.id] ?? null, reason: "平票" };
        }
        const wolf = aliveWolves(g)[0];
        return { action: "vote", target_id: wolf?.id ?? null, reason: "投狼" };
      }
      return simpleDecide(input);
    }, evts);
    await runToEnd(g);
    const tieResult = evts.find((e) => e.type === "vote_result" && e.tie);
    expect(tieResult).toBeTruthy();
    expect(tieResult.eliminatedId).toBeNull();
  });
});