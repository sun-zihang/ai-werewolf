import type { AiProfilePublic, GameEvent, GameListItem, GameReport, GameState, Preset, ProviderMeta } from "./types";

/** 后端地址：构建时可用 VITE_API_BASE 覆盖（如部署在 GitHub Pages 时指向你本机后端） */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg = `请求失败 ${res.status}`;
    if (res.status === 404) msg = "后端接口不存在（404）—— 请确认已在本机启动后端（npm run start）";
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // 厂商
  providers: () => request<ProviderMeta[]>("/api/providers"),
  // AI 档案
  listProfiles: () => request<AiProfilePublic[]>("/api/ai-profiles"),
  createProfile: (body: Record<string, unknown>) => request<AiProfilePublic>("/api/ai-profiles", { method: "POST", body: JSON.stringify(body) }),
  updateProfile: (id: number, body: Record<string, unknown>) => request<AiProfilePublic>(`/api/ai-profiles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProfile: (id: number) => request<{ ok: boolean }>(`/api/ai-profiles/${id}`, { method: "DELETE" }),
  importProfiles: (profiles: Record<string, unknown>[]) => request<{ created: number[] }>("/api/ai-profiles/import", { method: "POST", body: JSON.stringify({ profiles }) }),
  testProfile: (id: number, apiKey?: string) =>
    request<{ ok: boolean; latencyMs?: number; error?: string }>(`/api/ai-profiles/${id}/test`, { method: "POST", body: JSON.stringify({ api_key: apiKey ?? "" }) }),
  // 对局
  listGames: () => request<GameListItem[]>("/api/games"),
  listGamesByProfile: (profileId: number) => request<GameListItem[]>(`/api/games?profile_id=${profileId}`),
  createGame: (body: Record<string, unknown>) => request<{ id: number }>("/api/games", { method: "POST", body: JSON.stringify(body) }),
  getGame: (id: number) => request<GameState>(`/api/games/${id}`),
  startGame: (id: number, speedMs = 450) => request<{ ok: boolean }>(`/api/games/${id}/start`, { method: "POST", body: JSON.stringify({ speed_ms: speedMs }) }),
  controlGame: (id: number, action: "pause" | "resume" | "abort") => request<{ ok: boolean }>(`/api/games/${id}/${action}`, { method: "POST" }),
  getReport: (id: number) => request<GameReport>(`/api/games/${id}/report`),
  // 轮询增量事件（SSE 被隧道缓冲时仍保持时间线实时）
  getEvents: (id: number, after = 0) => request<GameEvent[]>(`/api/games/${id}/events-list?after=${after}`),
  // 预设阵容
  listPresets: () => request<Preset[]>("/api/presets"),
  savePreset: (body: { name: string; ai_ids: number[]; config: Record<string, unknown> }) => request<{ id: number }>("/api/presets", { method: "POST", body: JSON.stringify(body) }),
  deletePreset: (id: number) => request<{ ok: boolean }>(`/api/presets/${id}`, { method: "DELETE" }),
};

/** SSE 订阅对局事件；返回取消函数。onStatus 回报连接状态，便于观战者确认是否实时跟进 */
export function subscribeEvents(
  gameId: number,
  onEvent: (e: GameEvent) => void,
  onStatus?: (status: "connecting" | "open" | "error") => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/games/${gameId}/events`);
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