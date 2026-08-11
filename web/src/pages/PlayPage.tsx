import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { isOffline } from "../offline";
import { HumanView, ROLE_LABEL, TEAM_LABEL } from "../types";

const ACTION_LABEL: Record<string, string> = {
  night_kill: "狼人刀人",
  night_check: "预言家查验",
  night_save: "女巫救人",
  night_poison: "女巫下毒",
  day_vote: "投票放逐",
  hunter_shot: "猎人开枪",
  day_speech: "发言",
  last_words: "遗言",
};

/** 需要选目标的行动 */
const TARGET_ACTIONS = new Set([
  "night_kill", "night_check", "night_save", "night_poison", "day_vote", "hunter_shot",
]);
/** 允许「跳过/不X」的行动 */
const SKIPPABLE = new Set(["night_save", "night_poison", "day_vote", "hunter_shot"]);

function eventText(e: any, nameMap: Record<number, string>): string {
  const nm = (id: number) => nameMap[id] ?? `座位${id}`;
  switch (e.type) {
    case "phase": return `【${e.label ?? e.phase}】`;
    case "night_action": {
      const a = ACTION_LABEL[e.action as string] ?? e.action;
      return `${nm(Number(e.playerId))} ${a}${e.targetId !== undefined && e.targetId !== null ? " → " + nm(Number(e.targetId)) : ""}`;
    }
    case "day_speech": return `${nm(Number(e.playerId))}：${e.content ?? ""}`;
    case "vote": return `${nm(Number(e.playerId))} 投给 ${e.targetId !== undefined && e.targetId !== null ? nm(Number(e.targetId)) : "弃票"}`;
    case "vote_result": return `放逐结果：${e.eliminatedId !== undefined && e.eliminatedId !== null ? nm(Number(e.eliminatedId)) + " 被放逐" : "无人出局"}`;
    case "death": return `${nm(Number(e.playerId))} 出局`;
    case "last_words": return `${nm(Number(e.playerId))}（遗言）：${e.content ?? ""}`;
    case "human_turn": return `等待 ${nm(Number(e.playerId))}（真人）操作…`;
    case "game_over": return `对局结束 · ${TEAM_LABEL[e.winner as "wolf" | "good"] ?? e.winner} 获胜`;
    default: return "";
  }
}

export default function PlayPage({ gameId, token }: { gameId: number; token: string }) {
  const [view, setView] = useState<HumanView | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [target, setTarget] = useState<number | "">("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const v = await api.getHumanView(gameId, token);
      setView(v);
      if (v.yourTurn) {
        if (v.requiredAction === "night_save" && v.options.length) setTarget(v.options[0].id);
        else setTarget("");
      }
      setError("");
    } catch (e: any) {
      if (!isOffline()) setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 2000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, token]);

  useEffect(() => {
    if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [view?.timeline.length]);

  async function join() {
    if (!name.trim()) return setError("请输入昵称");
    setJoining(true);
    try {
      await api.joinHumanSeat(gameId, token, name.trim());
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setJoining(false);
    }
  }

  async function submitAction(payload: Record<string, unknown>) {
    setSubmitting(true);
    try {
      await api.submitHumanAction(gameId, token, payload);
      setContent("");
      setTarget("");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function copyLink() {
    const link = `${location.origin}/#/play/${gameId}/${token}`;
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!view) return <div className="page"><div className="empty">加载中…</div></div>;

  // 未占座：输入昵称
  if (!view.joined) {
    return (
      <div className="page play-join">
        <div className="card join-card">
          <div className="section-title">加入对局 #{gameId}</div>
          <div className="small muted" style={{ marginBottom: 12 }}>
            输入昵称占座。开局后角色随机，上桌才知道自己是狼还是好人。
          </div>
          <input
            type="text"
            placeholder="你的昵称"
            value={name}
            maxLength={12}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          {error && <div className="err small" style={{ marginTop: 8 }}>{error}</div>}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="primary" onClick={join} disabled={joining}>{joining ? "加入中…" : "占座加入"}</button>
          </div>
        </div>
      </div>
    );
  }

  const isTarget = TARGET_ACTIONS.has(view.requiredAction ?? "");
  const canSkip = SKIPPABLE.has(view.requiredAction ?? "");
  // 需要选目标但没有可选目标（如女巫救人时本夜无人被刀）：无需操作，只给跳过
  const noTarget = isTarget && view.options.length === 0;
  const actLabel = ACTION_LABEL[view.requiredAction ?? ""] ?? view.requiredAction;
  const myTeam = view.role ? (view.role === "werewolf" ? "wolf" : "good") : null;
  const iWon = view.winner && myTeam && view.winner === myTeam;

  return (
    <div className="page play-page">
      <div className="play-head">
        <div>
          <div className="play-seat">座位 {view.seat} · {view.myName}</div>
          {view.role ? (
            <div className={`role-badge ${myTeam}`}>
              {ROLE_LABEL[view.role]} · {TEAM_LABEL[myTeam as "wolf" | "good"]}
            </div>
          ) : (
            <div className="role-badge pending">角色未公开（开局后揭晓）</div>
          )}
        </div>
        <div className="play-meta">
          <span className="muted small">第 {view.round} 天 · {statusText(view.status, view.phase)}</span>
          <button className="ghost small" onClick={copyLink}>{copied ? "已复制" : "复制我的链接"}</button>
          <a className="ghost small" href={`#/games/${gameId}`}>观战视角</a>
        </div>
      </div>

      {view.status === "created" && (
        <div className="card wait-start">
          <div className="turn-banner">已就座，等待房主开始对局…</div>
          <div className="small muted">房主在另一台设备点「开始对局」后，这里会立即进入游戏，并揭晓你的角色。请保持本页面打开。</div>
        </div>
      )}

      {view.status === "finished" && (
        <div className={`card result-card ${iWon ? "win" : "lose"}`}>
          <div className="result-title">{iWon ? "你赢了" : "你输了"}</div>
          <div className="small">{view.reason ?? ""}</div>
        </div>
      )}

      {view.yourTurn && view.status !== "finished" && (
        <div className="card my-turn">
          <div className="turn-banner">轮到你了：{actLabel}</div>
          {noTarget ? (
            <div className="turn-body">
              <div className="small muted">{view.requiredAction === "night_save" ? "本夜无人被刀，无需救人。" : "当前没有可操作的目标。"}</div>
              <div className="actions">
                <button className="primary" disabled={submitting} onClick={() => submitAction({ target_id: null })}>
                  {skipLabel(view.requiredAction) || "确认"}
                </button>
              </div>
            </div>
          ) : isTarget ? (
            <div className="turn-body">
              <select value={target} onChange={(e) => setTarget(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">{view.requiredAction === "night_save" ? "是否救人…" : "选择目标…"}</option>
                {view.options.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}（座位 {o.seat}）</option>
                ))}
              </select>
              <div className="actions">
                <button
                  className="primary"
                  disabled={submitting || target === ""}
                  onClick={() => submitAction({ target_id: target === "" ? null : Number(target) })}
                >
                  {view.requiredAction === "night_save" ? "救人" : "确认"}
                </button>
                {canSkip && (
                  <button className="ghost" disabled={submitting} onClick={() => submitAction({ target_id: null })}>
                    {skipLabel(view.requiredAction)}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="turn-body">
              <textarea
                rows={3}
                value={content}
                placeholder={view.requiredAction === "last_words" ? "留下你的遗言…" : "说点什么…"}
                onChange={(e) => setContent(e.target.value)}
              />
              <div className="actions">
                <button className="primary" disabled={submitting} onClick={() => submitAction({ content: content.trim() || undefined })}>
                  提交
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="play-grid">
        <div className="card">
          <div className="section-title">私密信息</div>
          {view.privateInfo.length === 0 ? (
            <div className="small muted">暂无（开局后揭晓你的角色与查验记录）</div>
          ) : (
            <ul className="private-list">
              {view.privateInfo.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="section-title">公共时间线</div>
          <div className="timeline" ref={timelineRef}>
            {view.timeline.length === 0 && <div className="small muted">对局尚未开始</div>}
            {view.timeline.map((e) => (
              <div key={e.seq} className={`tl-item ${e.type}`}>
                <span className="tl-round">D{e.round}</span>
                <span className="tl-text">{eventText(e, view.nameMap)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="err small" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}

function statusText(status: string, phase: string): string {
  if (status === "created") return "待开始";
  if (status === "finished") return "已结束";
  if (status === "paused") return "已暂停";
  return phase || "进行中";
}

function skipLabel(action?: string): string {
  switch (action) {
    case "night_save": return "不救";
    case "night_poison": return "不毒";
    case "day_vote": return "弃票";
    case "hunter_shot": return "不开枪";
    default: return "跳过";
  }
}
