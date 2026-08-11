import type { Request, Response, NextFunction } from "express";

/**
 * Cloudflare Turnstile 服务端校验（canonical server-side siteverify）。
 *
 * 浏览器 → 本后端 → Cloudflare siteverify（绝不可在浏览器直连 siteverify）。
 * 文档：https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const DEFAULT_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  success: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

/** 是否启用了 Turnstile（配置了密钥即视为生产强制模式） */
export function turnstileConfigured(): boolean {
  return typeof process.env.TURNSTILE_SECRET === "string" && process.env.TURNSTILE_SECRET.length > 0;
}

/** 从请求中提取客户端真实 IP（兼容 Cloudflare / 反向代理的 X-Forwarded-For） */
export function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return xff[0].trim();
  return req.ip ?? "";
}

/**
 * 调用 Cloudflare siteverify 校验令牌。
 * 未配置 TURNSTILE_SECRET 时返回 ok=true（开发/测试放行，生产务必配置）。
 */
export async function verifyTurnstile(
  token: string,
  expectedAction: string,
  req: Request
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    // 开发/测试模式：未配置密钥则放行，避免本地无后端密钥时阻塞正常功能
    return { success: true };
  }

  const hostnames = (process.env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const url = process.env.TURNSTILE_SITEVERIFY_URL ?? DEFAULT_SITEVERIFY_URL;

  let resp: globalThis.Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: clientIp(req),
      }),
    });
  } catch {
    // 网络/超时：保守拒绝
    return { success: false, "error-codes": ["connection-failure"] };
  }

  if (!resp.ok) {
    return { success: false, "error-codes": [`http-${resp.status}`] };
  }

  const result = (await resp.json()) as TurnstileResult;

  const hostOk =
    hostnames.length === 0 ||
    (typeof result.hostname === "string" && hostnames.includes(result.hostname));

  return {
    success: result.success === true && result.action === expectedAction && hostOk,
    action: result.action,
    hostname: result.hostname,
    "error-codes": result["error-codes"],
  };
}

export interface TurnstileGuardOptions {
  /** 预期 action（1–32 字符，仅字母/数字/下划线/连字符） */
  action: string;
  /** 请求体中存放令牌的字段名，默认 cf_turnstile_response */
  field?: string;
}

/**
 * 路由级中间件：要求请求携带通过校验的 Turnstile 令牌。
 * 校验项：令牌存在且长度合法 → siteverify success===true → action 匹配 → hostname 在白名单。
 */
export function turnstileGuard(opts: TurnstileGuardOptions) {
  const field = opts.field ?? "cf_turnstile_response";
  return async (req: Request, res: Response, next: NextFunction) => {
    // 未配置密钥：放行（开发/测试）。生产环境应通过环境变量设置 TURNSTILE_SECRET。
    if (!turnstileConfigured()) return next();

    const token = (req.body as Record<string, unknown> | undefined)?.[field];

    if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
      res.status(403).json({ error: "Turnstile 验证缺失或无效" });
      return;
    }

    const result = await verifyTurnstile(token, opts.action, req);
    if (!result.success) {
      res.status(403).json({ error: "Turnstile 验证失败", detail: result["error-codes"] });
      return;
    }
    next();
  };
}
