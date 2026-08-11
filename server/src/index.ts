import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { aiProfileRouter } from "./routes/aiProfiles.js";
import { gamesRouter } from "./routes/games.js";
import { presetsRouter } from "./routes/presets.js";
import { providersRouter } from "./routes/providers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb();
const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.use("/api/ai-profiles", aiProfileRouter(db));
app.use("/api/games", gamesRouter(db));
app.use("/api/presets", presetsRouter(db));
app.use("/api/providers", providersRouter());

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 生产模式：托管 web 构建产物
const webDist = path.resolve(here, "../../dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err?.message ?? "服务器内部错误" });
});

app.listen(PORT, () => {
  console.log(`[server] AI 狼人杀后端已启动: http://localhost:${PORT}`);
});