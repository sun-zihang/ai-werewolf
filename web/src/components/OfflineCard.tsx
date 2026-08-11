import { getApiBase } from "../api";

export default function OfflineCard() {
  const base = getApiBase();
  const target = base ? base : "同源 /api（本站点若带 Pages Functions 即已自带后端）";
  return (
    <div className="card" style={{ padding: "30px 24px", textAlign: "center", margin: "8px 0 20px" }}>
      <h3 style={{ marginBottom: 10 }}>后端未连接</h3>
      <p className="muted" style={{ fontSize: 13, maxWidth: 620, margin: "0 auto", lineHeight: 1.8 }}>
        前端连不上后端：当前目标地址 <code className="mono">{target}</code> 不可达。
        <br />
        AI 库、对局与观战需要可用的游戏后端。
        <br />
        本地预览：在项目根目录运行 <code className="mono">npm run start</code> 后访问{" "}
        <code className="mono">http://localhost:3001</code> 即可完整体验；
        <br />
        静态托管（GitHub Pages / Cloudflare Pages 未绑定函数时）：请在右上角「⚙ 后端」填入后端地址，
        或部署后端后构建时用 <code className="mono">VITE_API_BASE</code> 指向它。
      </p>
    </div>
  );
}
