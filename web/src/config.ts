/** 前端运行时配置（从构建期环境变量读取） */

/** Cloudflare Turnstile 站点公钥（公开，可暴露给浏览器）。空字符串表示未启用。 */
export const TURNSTILE_SITEKEY = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? "";

/** 是否启用 Turnstile（站点公钥存在时启用）。未启用时表单不渲染验证、后端校验放行。 */
export const TURNSTILE_ENABLED = TURNSTILE_SITEKEY.length > 0;
