import { ThinkingLevel } from "../types.js";
import { ProviderMeta } from "../types.js";

export interface ChatRequest {
  provider: ProviderMeta;
  apiKey: string;
  model: string;
  baseUrlOverride?: string;
  messages: { role: "system" | "user"; content: string }[];
  thinkingLevel: ThinkingLevel;
  maxTokens: number; // 输出预算
  jsonMode: boolean;
}

export interface ChatResult {
  content: string;
  thinkingTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export const LEVEL_META: Record<ThinkingLevel, { label: string; timeoutMs: number; maxTokens: number }> = {
  paper: { label: "纸", timeoutMs: 20000, maxTokens: 220 },
  medium: { label: "中", timeoutMs: 30000, maxTokens: 320 },
  high: { label: "高", timeoutMs: 45000, maxTokens: 450 },
  extra: { label: "特高", timeoutMs: 60000, maxTokens: 600 },
};

// 思考指令（无原生思考接口厂商的兜底）
const THINK_DIRECTIVE: Record<ThinkingLevel, string> = {
  paper: "不要展开推理，直接给出最简短、合理的结论。",
  medium: "先做 1-2 句简要推理，再给出结论。",
  high: "分步骤推理，把关键证据和逻辑链条讲清楚，再给出结论。",
  extra: "深度推理：列出证据、可能性与反方论点，进行多轮推演后给出最终结论。",
};

export function thinkingInstruction(level: ThinkingLevel): string {
  return THINK_DIRECTIVE[level];
}

/**
 * 思考强度 -> 厂商原生参数。
 * OpenAI: reasoning_effort；Gemini: thinkingBudget；Qwen3: enable_thinking；
 * 其余厂商返回空对象，靠提示词指令 + 输出预算兜底。
 */
export function buildThinkingParams(providerId: string, level: ThinkingLevel): Record<string, unknown> {
  switch (providerId) {
    case "openai":
      return level === "paper" ? {} : { reasoning_effort: level === "medium" ? "low" : level === "high" ? "medium" : "high" };
    case "gemini":
      return { thinkingConfig: { thinkingBudget: level === "paper" ? 0 : level === "medium" ? 150 : level === "high" ? 300 : 600 } };
    case "qwen":
      return { chat_template_kwargs: { enable_thinking: level !== "paper" } };
    default:
      return {};
  }
}

/** 组装并调用厂商，返回归一化结果；失败时抛出带 message 的 Error */
export async function callProvider(req: ChatRequest): Promise<ChatResult> {
  if (req.provider.kind === "local") {
    throw new Error("local provider 不应走此路径");
  }
  const base = (req.baseUrlOverride || req.provider.baseUrl).replace(/\/+$/, "");
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));

  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;

  if (req.provider.kind === "gemini") {
    url = `${base}/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
    headers = { "Content-Type": "application/json" };
    body = {
      contents: [
        { role: "user", parts: messages.map((m) => ({ text: `${m.role === "system" ? "[系统设定]\n" : "[当前情境]\n"}${m.content}` })) },
      ],
      generationConfig: {
        ...buildThinkingParams("gemini", req.thinkingLevel),
        maxOutputTokens: req.maxTokens,
        responseMimeType: req.jsonMode ? "application/json" : undefined,
        temperature: 0.7,
      },
      systemInstruction: { parts: [{ text: messages[0].content }] },
    };
    // 若 systemInstruction 与首条 user 内容重复，去掉 user 中的系统设定前缀
    if (body.systemInstruction && messages.length > 1) {
      body.contents = [{ role: "user", parts: messages.slice(1).map((m) => ({ text: m.content })) }];
    }
  } else {
    url = `${base}/chat/completions`;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
    };
    if (req.provider.id === "anthropic") headers["anthropic-version"] = "2023-06-01";
    const extra = buildThinkingParams(req.provider.id, req.thinkingLevel);
    body = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens,
      temperature: 0.7,
      ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...extra,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LEVEL_META[req.thinkingLevel].timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`厂商 ${req.provider.label} 返回 ${res.status}: ${text.slice(0, 300)}`);
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`厂商 ${req.provider.label} 返回非 JSON 响应`);
    }
    if (req.provider.kind === "gemini") {
      const candidates = json?.candidates;
      const parts = candidates?.[0]?.content?.parts ?? [];
      const content = parts.map((p: any) => p.text ?? "").join("");
      const usage = json?.usageMetadata;
      return {
        content,
        thinkingTokens: usage?.thoughtsTokenCount,
        outputTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
      };
    }
    const msg = json?.choices?.[0]?.message;
    const content: string = typeof msg?.content === "string" ? msg.content : JSON.stringify(msg?.content ?? "");
    const usage = json?.usage;
    return {
      content,
      thinkingTokens: usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens,
      outputTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error(`请求超时（${LEVEL_META[req.thinkingLevel].timeoutMs / 1000}s）`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}