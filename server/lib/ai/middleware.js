import { callProvider, LEVEL_META } from "./adapters.js";
import { buildMessages } from "./prompts.js";
import { decideLocal, fallbackSpeech } from "./localEngine.js";
import { withRateLimit } from "./queue.js";
const DOWNGRADE = {
    paper: "paper",
    medium: "paper",
    high: "medium",
    extra: "high",
};
export function extractJson(content) {
    const cleaned = content
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start)
        return null;
    const slice = cleaned.slice(start, end + 1);
    try {
        const obj = JSON.parse(slice);
        return obj && typeof obj === "object" ? obj : null;
    }
    catch {
        return null;
    }
}
export function toOutput(obj) {
    if (typeof obj.action !== "string")
        return null;
    const out = { action: obj.action, reason: typeof obj.reason === "string" ? obj.reason : undefined };
    const t = obj.target_id;
    out.target_id = t === null || t === undefined || t === "" ? null : Number(t);
    if (Number.isNaN(out.target_id))
        out.target_id = null;
    out.content = typeof obj.content === "string" ? obj.content : undefined;
    return out;
}
async function attempt(profile, input, level, apiKey, validate) {
    const { system, user } = buildMessages(input);
    const result = await callProvider({
        provider: { id: profile.provider, kind: profile.provider === "gemini" ? "gemini" : "openai", baseUrl: "", label: "", needsKey: true, defaultModels: [] },
        apiKey,
        model: profile.model,
        baseUrlOverride: profile.base_url_override,
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
        thinkingLevel: level,
        maxTokens: LEVEL_META[level].maxTokens,
        jsonMode: true,
    });
    const obj = extractJson(result.content);
    if (!obj)
        return { error: "无法解析 JSON 决策" };
    const out = toOutput(obj);
    if (!out)
        return { error: "决策缺少 action 字段" };
    const invalid = validate(out);
    if (invalid)
        return { error: `非法动作：${invalid}` };
    return {
        out,
        usage: {
            thinkingTokens: result.thinkingTokens,
            outputTokens: result.outputTokens,
            totalTokens: result.totalTokens,
        },
    };
}
/**
 * 统一决策入口：
 * 1) 本地规则引擎直接决策；
 * 2) 远程厂商：原强度调用 → 解析/校验失败或超时 → 降一档重试一次 → 仍失败则本地兜底。
 */
export async function decide(opts) {
    const { profile, input, validate, onTokens } = opts;
    if (profile.provider === "local") {
        return decideLocal(input);
    }
    const apiKey = profile.api_key_enc ? await safeDecrypt(profile.api_key_enc, opts.decryptKey) : "";
    if (!apiKey) {
        return decideLocal(input);
    }
    const level = profile.thinking_level;
    const attempts = [level, DOWNGRADE[level] === level ? level : DOWNGRADE[level]];
    let lastError = "未知错误";
    for (const lvl of attempts) {
        try {
            const res = await withRateLimit(profile.provider, () => attempt(profile, input, lvl, apiKey, validate));
            if ("out" in res) {
                if (res.usage && onTokens)
                    onTokens(res.usage);
                return res.out;
            }
            lastError = res.error;
        }
        catch (err) {
            lastError = err?.message ?? String(err);
        }
    }
    // 兜底：本地决策
    if (onTokens)
        onTokens({});
    const fallback = fallbackSpeech(input);
    return { ...fallback, reason: `兜底（${lastError.slice(0, 80)}）` };
}
async function safeDecrypt(hex, fn) {
    if (!fn)
        return "";
    try {
        return (await fn(hex)) ?? "";
    }
    catch {
        return "";
    }
}
