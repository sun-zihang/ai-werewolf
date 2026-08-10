import { describe, expect, it } from "vitest";
import { createServer, Server } from "node:http";
import { buildThinkingParams, callProvider, LEVEL_META } from "../src/ai/adapters.js";
import { extractJson, toOutput } from "../src/ai/middleware.js";
import { providerById } from "../src/ai/providers.js";

describe("思考强度参数映射", () => {
  it("OpenAI reasoning_effort", () => {
    expect(buildThinkingParams("openai", "paper")).toEqual({});
    expect(buildThinkingParams("openai", "medium")).toEqual({ reasoning_effort: "low" });
    expect(buildThinkingParams("openai", "high")).toEqual({ reasoning_effort: "medium" });
    expect(buildThinkingParams("openai", "extra")).toEqual({ reasoning_effort: "high" });
  });
  it("Gemini thinkingBudget", () => {
    expect(buildThinkingParams("gemini", "paper")).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(buildThinkingParams("gemini", "extra")).toEqual({ thinkingConfig: { thinkingBudget: 600 } });
  });
  it("Qwen3 enable_thinking", () => {
    expect(buildThinkingParams("qwen", "paper")).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(buildThinkingParams("qwen", "high")).toEqual({ chat_template_kwargs: { enable_thinking: true } });
  });
  it("其余厂商无原生参数（提示词兜底）", () => {
    expect(buildThinkingParams("deepseek", "extra")).toEqual({});
    expect(buildThinkingParams("kimi", "high")).toEqual({});
  });
  it("各强度超时与输出预算", () => {
    expect(LEVEL_META.paper.timeoutMs).toBe(20000);
    expect(LEVEL_META.extra.timeoutMs).toBe(60000);
    expect(LEVEL_META.paper.maxTokens).toBeLessThan(LEVEL_META.extra.maxTokens);
  });
});

describe("JSON 决策解析", () => {
  it("去掉 Markdown 代码块", () => {
    const out = extractJson('```json\n{"action":"speak","content":"你好"}\n```');
    expect(out?.action).toBe("speak");
    expect(out?.content).toBe("你好");
  });
  it("从多余文字中提取", () => {
    const out = extractJson('好的，我的决策是：{"action":"vote","target_id":3} 完毕');
    expect(out?.action).toBe("vote");
    expect(out?.target_id).toBe(3);
  });
  it("非法 JSON 返回 null", () => {
    expect(extractJson("没有 json")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });
  it("toOutput 归一化 target_id", () => {
    const out = toOutput({ action: "kill", target_id: "2" } as any);
    expect(out?.target_id).toBe(2);
    const out2 = toOutput({ action: "save", target_id: null } as any);
    expect(out2?.target_id).toBeNull();
  });
});

describe("callProvider 对接 OpenAI 兼容端点", () => {
  it("正常返回并解析 usage", async () => {
    const { port, close } = await startMock((req, body) => {
      expect(req.headers.authorization).toBe("Bearer test-key");
      expect(body.model).toBe("mock-model");
      return {
        choices: [{ message: { content: '{"action":"speak","content":"hi"}' } }],
        usage: { completion_tokens: 7, total_tokens: 30 },
      };
    });
    try {
      const provider = { id: "mock", label: "Mock", kind: "openai" as const, baseUrl: `http://127.0.0.1:${port}/v1`, needsKey: true, defaultModels: [] };
      const res = await callProvider({
        provider,
        apiKey: "test-key",
        model: "mock-model",
        messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
        thinkingLevel: "high",
        maxTokens: 100,
        jsonMode: true,
      });
      expect(res.content).toContain("speak");
      expect(res.totalTokens).toBe(30);
    } finally {
      close();
    }
  });

  it("厂商返回错误时抛出", async () => {
    const { port, close } = await startMock((_req, _body) => {
      return { __status: 401, __body: { error: { message: "invalid api key" } } };
    });
    try {
      const provider = { id: "mock", label: "Mock", kind: "openai" as const, baseUrl: `http://127.0.0.1:${port}/v1`, needsKey: true, defaultModels: [] };
      await expect(
        callProvider({
          provider,
          apiKey: "bad",
          model: "m",
          messages: [],
          thinkingLevel: "medium",
          maxTokens: 10,
          jsonMode: false,
        })
      ).rejects.toThrow(/401/);
    } finally {
      close();
    }
  });

  it("Gemini 原生端点组装正确", async () => {
    const { port, close } = await startMock((_req, body) => {
      expect(body.contents).toBeTruthy();
      expect(body.generationConfig?.thinkingConfig?.thinkingBudget).toBe(300);
      return { candidates: [{ content: { parts: [{ text: '{"action":"check","target_id":1}' }] } }], usageMetadata: { totalTokenCount: 20 } };
    });
    try {
      const provider = { id: "gemini", label: "Gemini", kind: "gemini" as const, baseUrl: `http://127.0.0.1:${port}/v1beta`, needsKey: true, defaultModels: [] };
      const res = await callProvider({
        provider,
        apiKey: "k",
        model: "gemini-2.5-flash",
        messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
        thinkingLevel: "high",
        maxTokens: 100,
        jsonMode: true,
      });
      expect(res.content).toContain("check");
      expect(res.totalTokens).toBe(20);
    } finally {
      close();
    }
  });
});

describe("厂商注册表", () => {
  it("包含 12 家主流 + 本地规则引擎", () => {
    const ids = ["openai", "anthropic", "gemini", "deepseek", "qwen", "kimi", "glm", "minimax", "doubao", "hunyuan", "ernie", "spark", "local"];
    for (const id of ids) expect(providerById(id)).toBeTruthy();
  });
});

function startMock(handler: (req: any, body: any) => any): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        const out = handler({ headers: req.headers }, body);
        if (out && out.__status) {
          res.writeHead(out.__status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(out.__body));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(out));
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ port: (addr as any).port, close: () => server.close() });
    });
  });
}