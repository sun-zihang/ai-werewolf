import { DecisionInput, DecisionOutput, GameEvent, Role, ThinkingLevel } from "../src/types.js";
import { EnginePlayer, WerewolfGame } from "../src/engine/engine.js";
import { ROLE_TEAM } from "../src/engine/roles.js";

export function makePlayers(roles: Role[], opts?: { levels?: ThinkingLevel[]; names?: string[] }): EnginePlayer[] {
  return roles.map((role, i) => {
    const seat = i + 1;
    return {
      id: seat,
      profileId: seat,
      name: opts?.names?.[i] ?? `AI-${seat}`,
      seat,
      role,
      team: ROLE_TEAM[role],
      alive: true,
      thinkingLevel: opts?.levels?.[i] ?? "medium",
      avatarStyle: "ink",
      canVote: true,
      idiotFlipped: false,
      witchAntidote: role === "witch",
      witchPoison: role === "witch",
      speechCount: 0,
      tokensUsed: 0,
      votesReceived: 0,
    };
  });
}

export function simpleDecide(input: DecisionInput): DecisionOutput {
  const others = input.context.alive.filter((p) => p.id !== input.player.id);
  const first = others[0]?.id ?? null;
  switch (input.requiredAction) {
    case "night_kill": return { action: "kill", target_id: first, reason: "stub" };
    case "night_check": return { action: "check", target_id: first, reason: "stub" };
    case "night_save": return { action: "save", target_id: null, reason: "stub" };
    case "night_poison": return { action: "poison", target_id: null, reason: "stub" };
    case "day_speech": return { action: "speak", content: "我是好人，先观望。", reason: "stub" };
    case "last_words": return { action: "speak", content: "遗言：大家加油。", reason: "stub" };
    case "day_vote": return { action: "vote", target_id: first, reason: "stub" };
    case "hunter_shot": return { action: "shoot", target_id: null, reason: "stub" };
    default: return { action: "speak", content: "…", reason: "stub" };
  }
}

export async function runToEnd(engine: WerewolfGame): Promise<WerewolfGame> {
  await engine.run();
  return engine;
}

export function eventSink(evts: GameEvent[]) {
  return (e: GameEvent) => evts.push(e);
}

export function byRole(game: WerewolfGame, role: Role) {
  return game.players.find((p) => p.role === role)!;
}

export function aliveWolves(game: WerewolfGame) {
  return game.players.filter((p) => p.role === "werewolf" && p.alive);
}