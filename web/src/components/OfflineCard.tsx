export default function OfflineCard() {
  return (
    <div className="card" style={{ padding: "30px 24px", textAlign: "center", margin: "8px 0 20px" }}>
      <h3 style={{ marginBottom: 10 }}>后端未连接</h3>
      <p className="muted" style={{ fontSize: 13, maxWidth: 600, margin: "0 auto", lineHeight: 1.8 }}>
        当前是 GitHub Pages 静态预览页，AI 库、对局与观战需要本机游戏后端。
        <br />
        在项目根目录运行 <code className="mono">npm run start</code> 后访问{" "}
        <code className="mono">http://localhost:3001</code> 即可完整体验；
        <br />
        或将后端部署到任意服务器，构建时用 <code className="mono">VITE_API_BASE</code> 指向它。
      </p>
    </div>
  );
}