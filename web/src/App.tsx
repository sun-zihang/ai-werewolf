import { useEffect, useState } from "react";
import { API_BASE } from "./api";
import { setOffline } from "./offline";
import LibraryPage from "./pages/LibraryPage";
import NewGamePage from "./pages/NewGamePage";
import SpectatePage from "./pages/SpectatePage";
import HistoryPage from "./pages/HistoryPage";

type Route =
  | { page: "library" }
  | { page: "new" }
  | { page: "game"; id: number }
  | { page: "history" };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "games" && parts[1]) return { page: "game", id: Number(parts[1]) };
  if (parts[0] === "new") return { page: "new" };
  if (parts[0] === "history") return { page: "history" };
  return { page: "library" };
}

function go(hash: string) {
  window.location.hash = hash;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const fn = () => setRoute(parseHash());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => {
        setOnline(r.ok);
        setOffline(!r.ok);
      })
      .catch(() => {
        setOnline(false);
        setOffline(true);
      });
  }, []);

  return (
    <div className="app">
      {online === false && (
        <div style={{ borderBottom: "1px solid var(--line)", background: "var(--paper-mid)", padding: "10px 32px", fontSize: 13, color: "var(--ink-soft)" }}>
          <b>后端未连接。</b>
          GitHub Pages 只托管前端界面，游戏引擎需在本地运行：项目根目录执行 <code className="mono">npm run start</code> 后访问
          http://localhost:3001；或在构建时用 <code className="mono">VITE_API_BASE</code> 指向你的后端地址。详见 README。
        </div>
      )}
      <header className="topbar">
        <span className="brand">
          狼人杀<span className="dot">·</span>AI 桌
        </span>
        <nav className="nav">
          <a className={route.page === "library" ? "active" : ""} href="#/">AI 库</a>
          <a className={route.page === "new" ? "active" : ""} href="#/new">新建对局</a>
          <a className={route.page === "history" ? "active" : ""} href="#/history">历史</a>
        </nav>
        <span className="hint">全 AI 自动对局 · 本地运行</span>
      </header>
      <main className="page">
        {route.page === "library" && <LibraryPage go={go} />}
        {route.page === "new" && <NewGamePage go={go} />}
        {route.page === "game" && <SpectatePage gameId={route.id} />}
        {route.page === "history" && <HistoryPage go={go} />}
      </main>
    </div>
  );
}