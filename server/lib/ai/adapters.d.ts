import { ThinkingLevel } from "../types.js";
import { ProviderMeta } from "../types.js";
export interface ChatRequest {
    provider: ProviderMeta;
    apiKey: string;
    model: string;
    baseUrlOverride?: string;
    messages: {
        role: "system" | "user";
        content: string;
    }[];
    thinkingLevel: ThinkingLevel;
    maxTokens: number;
    jsonMode: boolean;
}
export interface ChatResult {
    content: string;
    thinkingTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}
export declare const LEVEL_META: Record<ThinkingLevel, {
    label: string;
    timeoutMs: number;
    maxTokens: number;
}>;
export declare function thinkingInstruction(level: ThinkingLevel): string;
/**
 * 思考强度 -> 厂商原生参数。
 * OpenAI: reasoning_effort；Gemini: thinkingBudget；Qwen3: enable_thinking；
 * 其余厂商返回空对象，靠提示词指令 + 输出预算兜底。
 */
export declare function buildThinkingParams(providerId: string, level: ThinkingLevel): Record<string, unknown>;
/** 组装并调用厂商，返回归一化结果；失败时抛出带 message 的 Error */
export declare function callProvider(req: ChatRequest): Promise<ChatResult>;
