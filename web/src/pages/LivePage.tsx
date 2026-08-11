import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { isOffline, useOffline } from "../offline";
import OfflineCard from "../components/OfflineCard";
import { GameListItem, MODE_LABEL, STATUS_LABEL } from "../types";

export default function LivePage({ go }: { go: (hash: string) => void }) {
  const offline = useOffline();
  const [games, setGames] = useState<GameListItem[]>([]);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  const load = () => {
    api
      .listGames()
      .then((list) => {
        setGames(list);
        setUpdatedAt(Date.now());
        setError("");
      })
      .catch((e) => {
        if (!isOffline()) setError(e.message);
      });
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 3000); // 实时刷新，捕捉新开的对局
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = useMemo(
    () => games.filter((g) => g.status === "running" || g.status === "paused"),
    [games]
  );
  const liveCount = live.length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>
            实时观战
            {liveCount > 0 && <span className="live-pill">{liveCount} 局进行中</span>}
          </h1>
          <div className="sub">
            正在自动刷新的对局列表 · 上帝视角可见全部身份与夜间行动 · 点「进入观战」即可实时跟进
          </div>
        </div>
        <div className="toolbar">
          <span className="muted small">
            {updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "加载中…"}
          </span>
          <button className="ghost" onClick={load}>刷新</button>
        </div>
      </div>

      {error && !offline && <div className="err" style={{ marginBottom: 14 }}>{error}</div>}

      {offline ? (
        <OfflineCard />
      ) : liveCount === 0 ? (
        <div className="card live-empty">
          <div className="live-empty-title">当前没有进行中的对局</div>
          <div className="muted">开一局 AI 自动对局，这里会出现「进入观战」入口，方便你实时跟进。</div>
          <div className="controls">
            <a href="#/new"><button className="primary">新建对局</button></a>
            <a href="#/history"><button className="ghost">查看历史</button></a>
          </div>
        </div>
      ) : (
        <div className="live-grid">
          {live.map((g) => (
            <div key={g.id} className="card live-card">
              <div className="live-card-head">
                <span className="mono">#{g.id}</span>
                <span className={`live-dot ${g.status === "paused" ? "paused" : "on"}`} />
                <span className="tag">{STATUS_LABEL[g.status]}</span>
              </div>
              <div className="live-card-meta">
                <div><b>{MODE_LABEL[g.mode]}</b></div>
                <div className="muted small">{g.player_count} 人 · 第 {g.rounds} 轮</div>
              </div>
              <div className="controls">
                <button className="accent" onClick={() => go(`#/games/${g.id}`)}>进入观战 →</button>
                <span className="muted small">上帝视角</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
