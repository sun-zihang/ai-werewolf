import { Role, Team, GameMode } from "../types.js";

export const ROLE_TEAM: Record<Role, Team> = {
  werewolf: "wolf",
  villager: "good",
  seer: "good",
  witch: "good",
  hunter: "good",
  idiot: "good",
};

// 角色复杂度（用于强度匹配分配：数值大 = 更复杂）
export const ROLE_COMPLEXITY: Record<Role, number> = {
  werewolf: 5,
  seer: 4,
  witch: 3,
  hunter: 2,
  idiot: 2,
  villager: 1,
};

// 人数 -> 角色组成（定死的规则表）
export function compositionFor(n: number, mode: GameMode): Role[] {
  const table: Record<GameMode, Record<number, Role[]>> = {
    simple: {
      3: ["werewolf", "villager", "villager"],
      4: ["werewolf", "seer", "villager", "villager"],
    },
    standard: {
      5: ["werewolf", "seer", "witch", "villager", "villager"],
      6: ["werewolf", "seer", "witch", "hunter", "villager", "villager"],
      7: ["werewolf", "werewolf", "seer", "witch", "hunter", "villager", "villager"],
      8: ["werewolf", "werewolf", "seer", "witch", "hunter", "villager", "villager", "villager"],
    },
    complex: {
      9: ["werewolf", "werewolf", "seer", "witch", "hunter", "idiot", "villager", "villager", "villager"],
      10: ["werewolf", "werewolf", "werewolf", "seer", "witch", "hunter", "idiot", "villager", "villager", "villager"],
      11: ["werewolf", "werewolf", "werewolf", "seer", "witch", "hunter", "idiot", "villager", "villager", "villager", "villager"],
      12: ["werewolf", "werewolf", "werewolf", "seer", "witch", "hunter", "idiot", "villager", "villager", "villager", "villager", "villager"],
    },
  };
  const row = table[mode][n];
  if (!row) throw new Error(`人数 ${n} 不在 ${mode} 模式支持范围内`);
  return [...row];
}

export function modeForPlayerCount(n: number): GameMode {
  if (n <= 4) return "simple";
  if (n <= 8) return "standard";
  return "complex";
}

// 简易/标准模式不启用白痴；角色按名称排序后可用于 UI 显示
export const ROLE_ORDER: Role[] = ["werewolf", "seer", "witch", "hunter", "idiot", "villager"];