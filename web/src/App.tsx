import { useEffect, useRef, useState } from "react";
import { getApiBase, setApiBase } from "./api";
import { setOffline } from "./offline";
import LibraryPage from "./pages/LibraryPage";
import NewGamePage from "./pages/NewGamePage";
import SpectatePage from "./pages/SpectatePage";
import HistoryPage from "./pages/HistoryPage";
import LivePage from "./pages/LivePage";
import PlayPage from "./pages/PlayPage";

type Route =
  | { page: "library" }
  | { page: "new" }
  | { page: "game"; id: number }
  | { page: "history" }
  | { page: "live" }
  | { page: "play"; gameId: number; token: string };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "games" && parts[1]) return { page: "game", id: Number(parts[1]) };
  if (parts[0] === "play" && parts[1] && parts[2]) return { page: "play", gameId: Number(parts[1]), token: parts[2] };
  if (parts[0] === "new") return { page: "new" };
  if (parts[0] === "live") return { page: "live" };
  if (parts[0] === "history") return { page: "history" };
  return { page: "library" };
}

function go(hash: string) {
  window.location.hash = hash;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const [online, setOnline] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [apiInput, setApiInput] = useState("");
  const settingsRef = useRef<HTMLDivElement>(null);

  function recheck() {
    fetch(`${getApiBase()}/api/health`)
      .then((r) => {
        setOnline(r.ok);
        setOffline(!r.ok);
      })
      .catch(() => {
        setOnline(false);
        setOffline(true);
      });
  }
  useEffect(() => {
    const fn = () => setRoute(parseHash());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    recheck();
  }, []);
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (showSettings && settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showSettings]);
  function applyApi() {
    setApiBase(apiInput);
    setShowSettings(false);
    recheck();
  }

  return (
    <div className="app">
      {online === false && (
        <div style={{ borderBottom: "1px solid var(--line)", background: "var(--paper-mid)", padding: "10px 32px", fontSize: 13, color: "var(--ink-soft)" }}>
          <b>后端未连接。</b>
          GitHub Pages 只托管前端界面，游戏引擎需自行运行后端（本机 <code className="mono">npm run start</code> 或 Docker / CloudBase 云托管）。
          点右上角 <code className="mono">⚙ 后端</code> 填入你的后端地址（如 https://your-host/api）即可开始；详见 README。
        </div>
      )}
      <header className="topbar">
        <span className="brand">
          狼人杀<span className="dot">·</span>AI 桌
        </span>
        <nav className="nav">
          <a className={route.page === "library" ? "active" : ""} href="#/">AI 库</a>
          <a className={route.page === "new" ? "active" : ""} href="#/new">新建对局</a>
          <a className={route.page === "live" ? "active" : ""} href="#/live">实时观战</a>
          <a className={route.page === "history" ? "active" : ""} href="#/history">历史</a>
        </nav>
        <div className="backend-setter" ref={settingsRef}>
          <button className="gear" onClick={() => { setApiInput(getApiBase()); setShowSettings((s) => !s); }}>
            ⚙ 后端{getApiBase() ? " ✓" : ""}
          </button>
          {showSettings && (
            <div className="settings-pop">
              <div className="settings-title">后端地址</div>
              <input
                value={apiInput}
                placeholder="https://your-backend.example.com"
                onChange={(e) => setApiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyApi(); }}
                autoFocus
              />
              <div className="settings-hint">
                Pages 仅托管前端，需指向你自托管的后端。留空则用相对路径（与本机同源）。设置会保存在浏览器本地。
              </div>
              <div className="actions">
                <button className="primary" onClick={applyApi}>保存</button>
                <button className="ghost" onClick={() => { setApiBase(""); setApiInput(""); recheck(); setShowSettings(false); }}>清除</button>
              </div>
            </div>
          )}
        </div>
        <span className="hint">AI 自动对局 · 支持 1-4 名真人加入</span>
      </header>
      <main className="page">
        {route.page === "library" && (
          <LibraryPage
            go={go}
            onOpenSettings={() => {
              setApiInput(getApiBase());
              setShowSettings(true);
            }}
          />
        )}
        {route.page === "new" && <NewGamePage go={go} />}
        {route.page === "live" && <LivePage go={go} />}
        {route.page === "game" && <SpectatePage gameId={route.id} />}
        {route.page === "play" && <PlayPage gameId={route.gameId} token={route.token} />}
        {route.page === "history" && <HistoryPage go={go} />}
      </main>
    </div>
  );
}