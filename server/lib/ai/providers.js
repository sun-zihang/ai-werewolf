// 11 家 OpenAI 兼容 + Gemini 原生 + 本地规则引擎
export const PROVIDERS = [
    { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", needsKey: true, defaultModels: ["gpt-4o", "o3-mini"], note: "o 系列支持 reasoning_effort" },
    { id: "anthropic", label: "Claude (Anthropic)", kind: "openai", baseUrl: "https://api.anthropic.com/v1", needsKey: true, defaultModels: ["claude-sonnet-4-20250514", "claude-haiku-4-20250514"], note: "OpenAI 兼容端点，需 anthropic-version 头" },
    { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", needsKey: true, defaultModels: ["gemini-2.5-flash", "gemini-2.5-pro"], note: "原生 API，thinkingConfig.thinkingBudget 控制思考" },
    { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", needsKey: true, defaultModels: ["deepseek-chat", "deepseek-reasoner"] },
    { id: "qwen", label: "通义千问 (阿里)", kind: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", needsKey: true, defaultModels: ["qwen3-72b-instruct", "qwen-max"], note: "Qwen3 支持 enable_thinking" },
    { id: "kimi", label: "Kimi (月之暗面)", kind: "openai", baseUrl: "https://api.moonshot.cn/v1", needsKey: true, defaultModels: ["kimi-k2-0711-preview", "moonshot-v1-32k"] },
    { id: "glm", label: "智谱 GLM", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", needsKey: true, defaultModels: ["glm-4-plus", "glm-4-flash"] },
    { id: "minimax", label: "MiniMax", kind: "openai", baseUrl: "https://api.minimax.chat/v1", needsKey: true, defaultModels: ["MiniMax-M2", "MiniMax-Text-01"] },
    { id: "doubao", label: "豆包 (火山方舟)", kind: "openai", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", needsKey: true, defaultModels: ["doubao-seed-1-6-250615", "doubao-1-5-pro-32k-250115"] },
    { id: "hunyuan", label: "腾讯混元", kind: "openai", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", needsKey: true, defaultModels: ["hunyuan-turbos-latest", "hunyuan-lites"] },
    { id: "ernie", label: "百度文心", kind: "openai", baseUrl: "https://qianfan.baidubce.com/v2", needsKey: true, defaultModels: ["ernie-4.0-8k", "ernie-3.5-8k"] },
    { id: "spark", label: "讯飞星火", kind: "openai", baseUrl: "https://spark-api-open.xf-yun.com/v1", needsKey: true, defaultModels: ["spark-4.0-250630", "generalv3.5"] },
    { id: "local", label: "本地规则引擎", kind: "local", baseUrl: "", needsKey: false, defaultModels: ["local-engine"], note: "无需密钥，内置话术与规则决策" },
];
const byId = new Map(PROVIDERS.map((p) => [p.id, p]));
export function providerById(id) {
    return byId.get(id);
}
export function providerLabel(id) {
    return byId.get(id)?.label ?? id;
}
