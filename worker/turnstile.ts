import type { Env } from "./env.js";

/**
 * Cloudflare Turnstile 服务端校验（Workers 版）。
 * 与 server/src/turnstile.ts 逻辑一致，只是密钥从 Env 绑定读取而非 process.env。
 * 浏览器 → 本 Worker → siteverify，绝不在浏览器直连 siteverify。
 */
const DEFAULT_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

export function turnstileConfigured(env: Env): boolean {
  return typeof env.TURNSTILE_SECRET === "string" && env.TURNSTILE_SECRET.length > 0;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
}

export async function verifyTurnstile(env: Env, token: string, expectedAction: string, req: Request): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return { success: true }; // 未配置密钥：开发/预览放行

  const hostnames = (env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const url = env.TURNSTILE_SITEVERIFY_URL ?? DEFAULT_SITEVERIFY_URL;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip: clientIp(req) }),
    });
  } catch {
    return { success: false, "error-codes": ["connection-failure"] };
  }
  if (!resp.ok) return { success: false, "error-codes": [`http-${resp.status}`] };

  const result = (await resp.json()) as TurnstileResult;
  const hostOk = hostnames.length === 0 || (typeof result.hostname === "string" && hostnames.includes(result.hostname));
  return {
    success: result.success === true && result.action === expectedAction && hostOk,
    action: result.action,
    hostname: result.hostname,
    "error-codes": result["error-codes"],
  };
}

/**
 * 守卫：要求请求体带上通过校验的令牌。
 * 返回 null 表示通过，否则返回应直接下发的 403 响应体描述。
 */
export async function guard(
  env: Env,
  req: Request,
  body: Record<string, unknown> | undefined,
  action: string,
  field = "cf_turnstile_response"
): Promise<{ error: string; detail?: string[] } | null> {
  if (!turnstileConfigured(env)) return null;
  const token = body?.[field];
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { error: "Turnstile 验证缺失或无效" };
  }
  const result = await verifyTurnstile(env, token, action, req);
  if (!result.success) return { error: "Turnstile 验证失败", detail: result["error-codes"] };
  return null;
}
