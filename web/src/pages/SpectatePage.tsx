import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeEvents } from "../api";
import { isOffline, useOffline } from "../offline";
import OfflineCard from "../components/OfflineCard";
import { GameEvent, GameReport, GameState, ROLE_LABEL, STATUS_LABEL, TEAM_LABEL } from "../types";
import Avatar from "../components/Avatar";
import LevelTag from "../components/LevelTag";
import { GuardedAction } from "../components/GuardedAction";

const PHASE_LABEL: Record<string, string> = {
  pending: "等待开始",
  night_wolf: "夜间 · 狼人行动",
  night_seer: "夜间 · 预言家查验",
  night_witch: "夜间 · 女巫行动",
  day_announce: "白天 · 公布死讯",
  day_lastwords: "遗言 · 猎人结算",
  day_speech: "白天 · 自由发言",
  day_vote: "白天 · 投票",
  day_result: "投票结果",
  game_over: "对局结束",
};

export default function SpectatePage({ gameId }: { gameId: number }) {
  const offline = useOffline();
  const [state, setState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [report, setReport] = useState<GameReport | null>(null);
  const [god, setGod] = useState(true);
  const [error, setError] = useState("");
  const [thinking, setThinking] = useState<Set<number>>(new Set());
  const [conn, setConn] = useState<"connecting" | "open" | "error">("connecting");
  const [copied, setCopied] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);
  const reportDoneRef = useRef(false);

  // 统一摄入事件：按 seq 去重，并维护已收到的最大 seq（供轮询增量拉取）
  const ingest = useCallback((list: GameEvent[]) => {
    if (!list.length) return;
    setEvents((prev) => {
      const start = prev.length ? prev[prev.length - 1].seq : 0;
      const fresh = list.filter((e) => e.seq > start);
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    let max = lastSeqRef.current;
    for (const e of list) if (e.seq > max) max = e.seq;
    lastSeqRef.current = max;
  }, []);

  useEffect(() => {
    setEvents([]);
    setReport(null);
    setError("");
    setConn("connecting");
    lastSeqRef.current = 0;
    reportDoneRef.current = false;
    api.getGame(gameId).then(setState).catch((e) => { if (!isOffline()) setError(e.message); });
    const off = subscribeEvents(
      gameId,
      (evt) => {
        ingest([evt]);
        if (evt.type === "ai_thinking") {
          const pid = evt.playerId as number;
          const st = evt.status as string;
          setThinking((t) => {
            const next = new Set(t);
            if (st === "start") next.add(pid);
            else next.delete(pid);
            return next;
          });
        }
      },
      setConn
    );
    // 轮询状态 + 增量事件（SSE 被 Cloudflare Tunnel 等缓冲时，时间线仍实时跟进）
    const iv = setInterval(() => {
      api.getGame(gameId).then((s) => {
        setState(s);
        if (s.status === "finished" && !reportDoneRef.current) {
          reportDoneRef.current = true;
          api.getReport(gameId).then(setReport).catch(() => {});
        }
      }).catch(() => {});
      api.getEvents(gameId, lastSeqRef.current).then((newer) => { if (newer.length) ingest(newer); }).catch(() => {});
    }, 2000);
    return () => {
      off();
      clearInterval(iv);
    };
  }, [gameId, ingest]);

  useEffect(() => {
    if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [events.length]);

  const finished = state?.status === "finished";
  const running = state?.status === "running" || state?.status === "paused";

  useEffect(() => {
    if (finished && !report) api.getReport(gameId).then(setReport).catch(() => {});
  }, [finished, report, gameId]);

  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    state?.players.forEach((p) => m.set(p.id, `${p.seat}号 ${p.name}`));
    return m;
  }, [state]);

  async function control(action: "pause" | "resume" | "abort", token: string) {
    if (action === "abort" && !window.confirm("确定中止本局？")) return;
    try {
      await api.controlGame(gameId, action, token);
      const s = await api.getGame(gameId);
      setState(s);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function copySpectateLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (offline) return <OfflineCard />;
  if (error) return <div className="err">{error}</div>;
  if (!state) return <div className="empty"><span className="spin" /> 加载中…</div>;

  const phaseLabel = state.phase === "game_over" ? "对局结束" : state.phase === "pending" ? "等待开始" : PHASE_LABEL[state.phase] ?? state.phase;

  return (
    <div>
      <div className="phase-banner">
        <div>
          <div className="phase-label">{phaseLabel}</div>
          <div className="meta">
            {state.status === "running" || state.status === "paused" ? `第 ${state.round} 轮 · ${STATUS_LABEL[state.status]}` : STATUS_LABEL[state.status]}
            {state.reason ? ` · ${state.reason}` : ""}
          </div>
        </div>
        <div className="spacer" />
        <label className="toggle-row">
          <input type="checkbox" checked={god} onChange={(e) => setGod(e.target.checked)} />
          上帝视角
        </label>
        {god && <span className="tag accent god-badge" title="上帝视角开启：可见全部身份与夜间行动">全知</span>}
        <span className={`conn-dot ${conn}`} title={conn === "open" ? "实时连接正常" : conn === "connecting" ? "正在连接…" : "连接中断，正在自动重连"}>
          {conn === "open" ? "实时" : conn === "connecting" ? "连接中" : "重连中"}
        </span>
        <button className="ghost" onClick={copySpectateLink}>
          {copied ? "链接已复制 ✓" : "复制观战链接"}
        </button>
        {running && (
          <>
            <GuardedAction action="control_game" onConfirm={(t) => control(state.status === "paused" ? "resume" : "pause", t)}>
              {state.status === "paused" ? "继续" : "暂停"}
            </GuardedAction>
            <GuardedAction className="danger" action="control_game" onConfirm={(t) => control("abort", t)}>中止</GuardedAction>
          </>
        )}
        <a href="#/history"><button className="ghost">返回历史</button></a>
      </div>

      <div className="spectate-layout">
        <div>
          <div className="section-title">座位</div>
          <div className="seat-grid">
            {state.players.map((p) => (
              <div key={p.id} className={`seat ${p.alive ? "" : "dead"}`}>
                {!p.alive && <span className="dead-mark">已出局</span>}
                <div className="seat-top">
                  <Avatar name={p.name} style={p.avatarStyle} size={34} />
                  <div>
                    <div className="seat-name">{p.seat}号 · {p.name}</div>
                    <div className="seat-role">
                      {god ? `${ROLE_LABEL[p.role]} · ${TEAM_LABEL[p.team]}` : p.alive ? "未知身份" : ROLE_LABEL[p.role]}
                    </div>
                  </div>
                </div>
                <div className="seat-foot">
                  <LevelTag level={p.thinkingLevel} />
                  {thinking.has(p.id) && <span className="tag accent"><span className="spin" /> 思考中</span>}
                  {finished && report && report.players.find((r) => r.id === p.id)?.mvp && <span className="tag accent">MVP</span>}
                </div>
              </div>
            ))}
          </div>

          {finished && report && (
            <>
              <div className="section-title" style={{ marginTop: 26 }}>结算报告</div>
              <div className="report">
                {report.players.map((r) => (
                  <div key={r.id} className={`report-item ${r.mvp ? "mvp" : ""}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <b>{r.name}</b>
                      {r.mvp && <span className="tag accent">MVP</span>}
                    </div>
                    <div className="small muted">
                      {ROLE_LABEL[r.role]} · {r.win ? "胜利" : "落败"} · 发言 {r.speechCount} 次 · token {r.tokensUsed}
                    </div>
                  </div>
                ))}
              </div>
              <div className="controls">
                <a href="#/history"><button className="ghost">← 返回历史</button></a>
              </div>
            </>
          )}
        </div>

        <div>
          <div className="section-title">事件时间线</div>
          <div className="timeline" ref={timelineRef}>
            {events.length === 0 && <div className="empty">等待事件…</div>}
            {events.map((e, i) => (
              <TimelineItem key={e.seq} evt={e} god={god} nameOf={nameOf} last={i === events.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ evt, god, nameOf, last }: { evt: GameEvent; god: boolean; nameOf: Map<number, string>; last: boolean }) {
  const nm = (id: number) => nameOf.get(id) ?? `#${id}`;
  let cls = "timeline-item";
  let title = "";
  let text: React.ReactNode = "";

  switch (evt.type) {
    case "phase":
      cls += " phase";
      title = "—— 阶段 ——";
      text = <b>{evt.label as string}</b>;
      break;
    case "system":
      text = <span className="muted">{evt.message as string}</span>;
      break;
    case "game_started":
      text = <span>对局开始 · {String(evt.mode)} 模式</span>;
      break;
    case "game_over":
      cls += " game-over";
      title = "对局结束";
      text = <b>{(evt.winner as string) === "wolf" ? "狼人阵营获胜" : "好人阵营获胜"} · {evt.reason as string}</b>;
      break;
    case "ai_thinking": {
      const st = evt.status as string;
      if (st === "start") return <div className={cls}><span className="t-seq">#{evt.seq}</span><span className="t-body faint">{nm(evt.playerId as number)} 思考中…</span></div>;
      if (st === "fallback") return <div className={cls}><span className="t-seq">#{evt.seq}</span><span className="t-body err">{nm(evt.playerId as number)} 已降级兜底</span></div>;
      return <div className={cls}><span className="t-seq">#{evt.seq}</span><span className="t-body faint">{nm(evt.playerId as number)} 决策完成（{evt.ms as number}ms）</span></div>;
    }
    case "human_turn": {
      const a = evt.action as string;
      const actLabel = a === "night_kill" ? "狼人刀人" : a === "night_check" ? "预言家查验" : a === "night_save" ? "女巫救人" : a === "night_poison" ? "女巫下毒" : a === "day_vote" ? "投票" : a === "hunter_shot" ? "猎人开枪" : a === "day_speech" ? "发言" : a === "last_words" ? "遗言" : a;
      return (
        <div className={cls + " human-turn"}>
          <span className="t-seq">#{evt.seq}</span>
          <span className="t-body human-turn-text">等待 {nm(evt.playerId as number)}（真人）操作：{actLabel}…</span>
        </div>
      );
    }
    case "speech":
      return (
        <div className={cls}>
          <span className="t-seq">#{evt.seq}</span>
          <div className="t-body speech">
            <span className="t-title">{nm(evt.playerId as number)} 说：</span>
            <div className="t-text">{evt.content as string}</div>
          </div>
        </div>
      );
    case "last_words":
      return (
        <div className={cls}>
          <span className="t-seq">#{evt.seq}</span>
          <div className="t-body">
            <span className="t-title">{nm(evt.playerId as number)} 的遗言：</span>
            <div className="t-text">{evt.content as string}</div>
          </div>
        </div>
      );
    case "death": {
      const cause = evt.cause as string;
      const causeText = cause === "wolf" ? "被狼人杀害" : cause === "vote" ? "被投票放逐" : cause === "poison" ? "被毒杀" : "被猎人枪毙";
      text = <span>{nm(evt.playerId as number)} 出局（{causeText}）</span>;
      break;
    }
    case "idiot_flip":
      text = <span>{nm(evt.playerId as number)} 翻牌为白痴，免死且失去投票权</span>;
      break;
    case "hunter_shot": {
      const t = evt.targetId;
      text = t !== undefined ? <span>{nm(evt.playerId as number)}（猎人）开枪带走了 {nm(t as number)}</span> : <span>{nm(evt.playerId as number)}（猎人）选择不开枪</span>;
      break;
    }
    case "vote_result": {
      const counts = evt.counts as Record<string, number>;
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const eliminated = evt.eliminatedId;
      text = (
        <>
          <div className="small muted">{entries.map(([id, c]) => `${nm(Number(id))}：${c} 票`).join("　") || "无人投票"}</div>
          <div>{eliminated ? <span>{nm(eliminated as number)} 被放逐</span> : <span>{evt.tie ? "平票，无人出局" : "无人出局"}</span>}</div>
        </>
      );
      break;
    }
    case "night_action": {
      if (evt.secret && !god) return null;
      const a = evt.action as string;
      const roleName = evt.role as string;
      const roleLabel = roleName === "werewolf" ? "狼人" : roleName === "seer" ? "预言家" : "女巫";
      if (a === "none") text = <span className="muted">{nm(evt.playerId as number)}（{roleLabel}）选择空过</span>;
      else if (a === "kill") text = <span>{nm(evt.playerId as number)}（狼人）刀向 {nm(evt.targetId as number)}</span>;
      else if (a === "check") text = <span>{nm(evt.playerId as number)}（预言家）查验 {nm(evt.targetId as number)}：{evt.content as string}</span>;
      else if (a === "save") text = <span>{nm(evt.playerId as number)}（女巫）救了 {nm(evt.targetId as number)}</span>;
      else if (a === "poison") text = <span>{nm(evt.playerId as number)}（女巫）毒了 {nm(evt.targetId as number)}</span>;
      cls += " secret";
      break;
    }
    case "vote":
      if (evt.reveal) text = <span>{nm(evt.playerId as number)} 投给 {nm(evt.targetId as number)}</span>;
      else return null;
      break;
    default:
      text = <span className="faint">{JSON.stringify(evt).slice(0, 80)}</span>;
  }

  return (
    <div className={cls}>
      <span className="t-seq">#{evt.seq}</span>
      <div className="t-body">
        {title && <div className="t-title">{title}</div>}
        <div className="t-text">{text}</div>
      </div>
    </div>
  );
}