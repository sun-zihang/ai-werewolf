import { useEffect, useState } from "react";
import { api } from "../api";
import { isOffline, useOffline } from "../offline";
import OfflineCard from "../components/OfflineCard";
import { GameListItem, MODE_LABEL, STATUS_LABEL, TEAM_LABEL } from "../types";

export default function HistoryPage({ go }: { go: (hash: string) => void }) {
  const [games, setGames] = useState<GameListItem[]>([]);
  const offline = useOffline();
  const [error, setError] = useState("");

  useEffect(() => {
    api.listGames().then(setGames).catch((e) => { if (!isOffline()) setError(e.message); });
  }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>历史对局</h1>
          <div className="sub">所有对局记录，点击可回放事件时间线</div>
        </div>
      </div>
      {error && !offline && <div className="err" style={{ marginBottom: 14 }}>{error}</div>}
      {games.length === 0 ? (
        offline ? <OfflineCard /> : <div className="empty">还没有对局记录。到「新建对局」开一局吧。</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="history-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>模式</th>
                <th>状态</th>
                <th>人数</th>
                <th>轮次</th>
                <th>结果</th>
                <th>开始时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id} style={{ cursor: "pointer" }} onClick={() => go(`#/games/${g.id}`)}>
                  <td className="mono">#{g.id}</td>
                  <td>{MODE_LABEL[g.mode]}</td>
                  <td>{STATUS_LABEL[g.status]}</td>
                  <td>{g.player_count}</td>
                  <td>{g.rounds}</td>
                  <td>{g.winner ? TEAM_LABEL[g.winner] : "—"}</td>
                  <td className="small muted">{g.started_at ?? "—"}</td>
                  <td><button className="ghost" onClick={(e) => { e.stopPropagation(); go(`#/games/${g.id}`); }}>回放</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}