import { Role, Team, GameMode } from "../types.js";
export declare const ROLE_TEAM: Record<Role, Team>;
export declare const ROLE_COMPLEXITY: Record<Role, number>;
export declare function compositionFor(n: number, mode: GameMode): Role[];
export declare function modeForPlayerCount(n: number): GameMode;
export declare const ROLE_ORDER: Role[];
