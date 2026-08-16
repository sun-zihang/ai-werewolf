import type { AiProfilePublic, CreateGameResult, GameEvent, GameListItem, GameReport, GameState, HumanView, Preset, ProviderMeta } from "./types";

/** 后端地址：运行时优先读 localStorage（便于 GitHub Pages 指向自托管后端），回退到构建期 VITE_API_BASE */
const STORAGE_KEY = "aww_api_base";

/**
 * 判断保存下来的后端地址是否已经不可能可用，需要丢弃并回落到同源。
 * 背景：早期演示要求用户把「Cloudflare 临时隧道地址」或「localhost」填进设置里。
 * 隧道地址每次重启都会变、关机即失效；而现在后端已随站点部署在同源 /api 上。
 * 如果不清掉这些陈旧值，老用户打开站点只会看到「无法连接后端」，还得自己去设置里删——属于我们该兜住的坑。
 */
function isStaleBase(base: string): boolean {
  try {
    const saved = new URL(base, window.location.href);
    const here = window.location.hostname;
    const localHere = here === "localhost" || here === "127.0.0.1";
    // 临时隧道域名一律作废
    if (/\.trycloudflare\.com$/i.test(saved.hostname)) return true;
    // 线上页面却指向本机后端：必然连不上
    if (!localHere && (saved.hostname === "localhost" || saved.hostname === "127.0.0.1")) return true;
    // https 页面指向 http 后端：会被浏览器混合内容策略拦掉
    if (window.location.protocol === "https:" && saved.protocol === "http:") return true;
    return false;
  } catch {
    return false;
  }
}

export function getApiBase(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) {
      const clean = saved.trim().replace(/\/+$/, "");
      if (isStaleBase(clean)) localStorage.removeItem(STORAGE_KEY);
      else return clean;
    }
  } catch { /* ignore */ }
  return (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "";
}
/** 运行时设置后端地址并持久化（留空则清除，回退到相对路径 / 构建期配置） */
export function setApiBase(value: string): string {
  const clean = (value || "").trim().replace(/\/+$/, "");
  try {
    if (clean) localStorage.setItem(STORAGE_KEY, clean);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  return clean;
}

function looksLikeHtml(text: string, contentType: string | null): boolean {
  const start = text.trimStart().toLowerCase();
  return start.startsWith("<!doctype") || start.startsWith("<html") || (contentType ?? "").includes("text/html");
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${url}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (e: any) {
    throw new Error(`无法连接后端：${e.message || "网络请求失败"}。请在右上角「⚙ 后端」检查后端地址，或确认后端服务已启动。`);
  }

  const contentType = res.headers.get("content-type");
  const text = await res.text();

  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    if (res.status === 404) msg = "后端接口不存在（404）—— 请确认已在本机启动后端（npm run start）";
    else if (looksLikeHtml(text, contentType)) {
      msg = "后端未运行或地址错误：收到 HTML 页面而非接口数据。Cloudflare Pages / GitHub Pages 仅托管前端，请在右上角「⚙ 后端」填入你的后端地址。";
    } else {
      try {
        const body = JSON.parse(text);
        if (body?.error) msg = body.error;
      } catch { /* ignore */ }
    }
    throw new Error(msg);
  }

  if (looksLikeHtml(text, contentType)) {
    throw new Error("后端未运行或地址错误：收到 HTML 页面而非接口数据。Cloudflare Pages / GitHub Pages 仅托管前端，请在右上角「⚙ 后端」填入你的后端地址。");
  }

  try {
    return JSON.parse(text) as T;
  } catch (e: any) {
    throw new Error(`后端返回无法解析：${e.message}`);
  }
}

export const api = {
  // 厂商
  providers: () => request<ProviderMeta[]>("/api/providers"),
  // AI 档案
  listProfiles: () => request<AiProfilePublic[]>("/api/ai-profiles"),
  createProfile: (body: Record<string, unknown>, cfTurnstileResponse?: string) =>
    request<AiProfilePublic>("/api/ai-profiles", {
      method: "POST",
      body: JSON.stringify(cfTurnstileResponse ? { ...body, cf_turnstile_response: cfTurnstileResponse } : body),
    }),
  updateProfile: (id: number, body: Record<string, unknown>, cfTurnstileResponse?: string) =>
    request<AiProfilePublic>(`/api/ai-profiles/${id}`, {
      method: "PUT",
      body: JSON.stringify(cfTurnstileResponse ? { ...body, cf_turnstile_response: cfTurnstileResponse } : body),
    }),
  deleteProfile: (id: number, cfTurnstileResponse?: string) =>
    request<{ ok: boolean }>(`/api/ai-profiles/${id}`, {
      method: "DELETE",
      body: JSON.stringify(cfTurnstileResponse ? { cf_turnstile_response: cfTurnstileResponse } : {}),
    }),
  importProfiles: (profiles: Record<string, unknown>[], cfTurnstileResponse?: string) =>
    request<{ created: number[] }>("/api/ai-profiles/import", {
      method: "POST",
      body: JSON.stringify(cfTurnstileResponse ? { profiles, cf_turnstile_response: cfTurnstileResponse } : { profiles }),
    }),
  testProfile: (id: number, apiKey?: string, cfTurnstileResponse?: string) =>
    request<{ ok: boolean; latencyMs?: number; error?: string }>(`/api/ai-profiles/${id}/test`, {
      method: "POST",
      body: JSON.stringify(cfTurnstileResponse ? { api_key: apiKey ?? "", cf_turnstile_response: cfTurnstileResponse } : { api_key: apiKey ?? "" }),
    }),
  // 对局
  listGames: () => request<GameListItem[]>("/api/games"),
  listGamesByProfile: (profileId: number) => request<GameListItem[]>(`/api/games?profile_id=${profileId}`),
  createGame: (body: Record<string, unknown>, cfTurnstileResponse?: string) =>
    request<CreateGameResult>("/api/games", {
      method: "POST",
      body: JSON.stringify(cfTurnstileResponse ? { ...body, cf_turnstile_response: cfTurnstileResponse } : body),
    }),
  getGame: (id: number) => request<GameState>(`/api/games/${id}`),
  startGame: (id: number, pace: "slow" | "normal" | "fast" = "slow", cfTurnstileResponse?: string) =>
    request<{ ok: boolean }>(`/api/games/${id}/start`, {
      method: "POST",
      body: JSON.stringify(cfTurnstileResponse ? { pace, cf_turnstile_response: cfTurnstileResponse } : { pace }),
    }),
  controlGame: (id: number, action: "pause" | "resume" | "abort", cfTurnstileResponse?: string) =>
    request<{ ok: boolean }>(`/api/games/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify(cfTurnstileResponse ? { cf_turnstile_response: cfTurnstileResponse } : {}),
    }),
  getReport: (id: number) => request<GameReport>(`/api/games/${id}/report`),
  // 轮询增量事件（SSE 被隧道缓冲时仍保持时间线实时）
  getEvents: (id: number, after = 0) => request<GameEvent[]>(`/api/games/${id}/events-list?after=${after}`),
  // 真人模式
  getHumanView: (gameId: number, token: string) => request<HumanView>(`/api/games/${gameId}/seats/${token}/view`),
  joinHumanSeat: (gameId: number, token: string, name: string, cfTurnstileResponse?: string) =>
    request<{ ok: boolean }>(`/api/games/${gameId}/seats/${token}/join`, {
      method: "POST",
      body: JSON.stringify(
        cfTurnstileResponse ? { name, cf_turnstile_response: cfTurnstileResponse } : { name }
      ),
    }),
  submitHumanAction: (gameId: number, token: string, body: Record<string, unknown>) => request<{ ok: boolean }>(`/api/games/${gameId}/seats/${token}/action`, { method: "POST", body: JSON.stringify(body) }),
  // 预设阵容
  listPresets: () => request<Preset[]>("/api/presets"),
  savePreset: (body: { name: string; ai_ids: number[]; config: Record<string, unknown> }, cfTurnstileResponse?: string) =>
    request<{ id: number }>("/api/presets", {
      method: "POST",
      body: JSON.stringify(cfTurnstileResponse ? { ...body, cf_turnstile_response: cfTurnstileResponse } : body),
    }),
  deletePreset: (id: number, cfTurnstileResponse?: string) =>
    request<{ ok: boolean }>(`/api/presets/${id}`, {
      method: "DELETE",
      body: JSON.stringify(cfTurnstileResponse ? { cf_turnstile_response: cfTurnstileResponse } : {}),
    }),
};

/** SSE 订阅对局事件；返回取消函数。onStatus 回报连接状态，便于观战者确认是否实时跟进 */
export function subscribeEvents(
  gameId: number,
  onEvent: (e: GameEvent) => void,
  onStatus?: (status: "connecting" | "open" | "error") => void
): () => void {
  const es = new EventSource(`${getApiBase()}/api/games/${gameId}/events`);
  onStatus?.("connecting");
  es.onopen = () => onStatus?.("open");
  es.onerror = () => onStatus?.("error");
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch { /* ignore */ }
  };
  return () => es.close();
}