import { DecisionInput, DecisionOutput, ThinkingLevel } from "../types.js";
export interface AiProfileRuntime {
    id: number;
    provider: string;
    model: string;
    base_url_override?: string;
    api_key_enc?: string | null;
    thinking_level: ThinkingLevel;
}
export interface DecideOptions {
    profile: AiProfileRuntime;
    input: DecisionInput;
    validate: (out: DecisionOutput) => string | null;
    onTokens?: (usage: {
        thinkingTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    }) => void;
    /**
     * 解密 api_key_enc 的实现由调用方注入。
     * 这样本模块不依赖任何运行时专有 API（node:crypto / Web Crypto），
     * 可同时在 Node 服务与 Cloudflare Workers 里复用。
     */
    decryptKey?: (enc: string) => Promise<string> | string;
}
export declare function extractJson(content: string): Record<string, unknown> | null;
export declare function toOutput(obj: Record<string, unknown>): DecisionOutput | null;
/**
 * 统一决策入口：
 * 1) 本地规则引擎直接决策；
 * 2) 远程厂商：原强度调用 → 解析/校验失败或超时 → 降一档重试一次 → 仍失败则本地兜底。
 */
export declare function decide(opts: DecideOptions): Promise<DecisionOutput>;
