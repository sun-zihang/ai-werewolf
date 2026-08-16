import { useRef, useState, type ReactNode } from "react";
import { Turnstile, TurnstileHandle } from "./Turnstile";
import { TURNSTILE_SITEKEY, TURNSTILE_ENABLED } from "../config";

interface Props {
  /** 与后端 guard(action) 完全一致的 Turnstile action（1–32 字符） */
  action: string;
  /** 校验通过后的回调；token 为空字符串表示「未启用 Turnstile」或「开发环境放行」 */
  onConfirm: (token: string) => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

/**
 * 受 Turnstile 保护的动作按钮。
 *
 * 行为：
 * - 未启用 Turnstile（开发/预览）：按钮直接触发 onConfirm("")，无额外交互。
 * - 已启用：首次点击「揭开」人机验证 widget；解出令牌后出现「确认」按钮，点击才真正执行。
 *   如此一来列表里成百上千个卡片也不会一次性渲染几十个 iframe——只有被点击的那一个才会渲染。
 *   令牌单次使用后自动重置，下次需重新验证。
 */
export function GuardedAction({ action, onConfirm, className, disabled, title, children }: Props) {
  const [armed, setArmed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);

  async function fire() {
    setBusy(true);
    try {
      await onConfirm(token ?? "");
      ref.current?.reset();
      setToken(null);
      setArmed(false);
    } catch {
      /* onConfirm 内部已自行 setError，这里吞掉避免未处理拒绝 */
    } finally {
      setBusy(false);
    }
  }

  function onClick() {
    if (!TURNSTILE_ENABLED) {
      void fire();
      return;
    }
    if (token) {
      void fire();
      return;
    }
    setArmed(true);
  }

  return (
    <>
      <button
        type="button"
        className={className}
        title={title}
        disabled={disabled || busy || (TURNSTILE_ENABLED && !token)}
        onClick={onClick}
      >
        {children}
      </button>
      {TURNSTILE_ENABLED && armed && (
        <span className="guarded-turnstile">
          <Turnstile ref={ref} sitekey={TURNSTILE_SITEKEY} action={action} onVerify={setToken} />
          {token && (
            <button type="button" className="primary" disabled={busy} onClick={() => void fire()}>
              确认
            </button>
          )}
        </span>
      )}
    </>
  );
}
