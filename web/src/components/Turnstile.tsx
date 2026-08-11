import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

/** Turnstile 全局对象（由 challenges.cloudflare.com 脚本注入） */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
      getResponse: (id: string) => string | null;
    };
  }
}

export interface TurnstileHandle {
  /** 重置 widget，使单次使用令牌失效，便于再次提交 */
  reset: () => void;
  /** 取当前令牌（未解出为 null） */
  getResponse: () => string | null;
}

interface Props {
  sitekey: string;
  /** 预期 action，须与后端一致（1–32 字符） */
  action: string;
  /** 校验成功回调（token）；过期/出错回调 null */
  onVerify: (token: string | null) => void;
  theme?: "light" | "dark" | "auto";
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SCRIPT_ID = "cf-turnstile-api";

/** 确保 Turnstile 脚本已加载（幂等） */
function ensureScript(onReady: () => void) {
  if (window.turnstile) return onReady();
  if (!document.getElementById(SCRIPT_ID)) {
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = onReady;
    document.head.appendChild(s);
    return;
  }
  // 脚本标签已存在但全局尚未就绪，轮询等待
  const t = window.setInterval(() => {
    if (window.turnstile) {
      window.clearInterval(t);
      onReady();
    }
  }, 100);
  // 60s 超时保护
  window.setTimeout(() => window.clearInterval(t), 60_000);
}

export const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile(
  { sitekey, action, onVerify, theme = "auto" },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
    getResponse: () =>
      widgetIdRef.current && window.turnstile
        ? window.turnstile.getResponse(widgetIdRef.current)
        : null,
  }));

  useEffect(() => {
    let cancelled = false;
    ensureScript(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey,
        action,
        theme,
        callback: (token: string) => onVerifyRef.current(token),
        "expired-callback": () => onVerifyRef.current(null),
        "error-callback": () => onVerifyRef.current(null),
      });
    });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
      }
      widgetIdRef.current = null;
    };
  }, [sitekey, action, theme]);

  return (
    <div
      ref={containerRef}
      className="cf-turnstile"
      data-sitekey={sitekey}
      data-action={action}
    />
  );
});
