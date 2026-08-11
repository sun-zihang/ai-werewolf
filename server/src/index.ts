import express from "express";
import cors from "cors";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { aiProfileRouter } from "./routes/aiProfiles.js";
import { gamesRouter } from "./routes/games.js";
import { presetsRouter } from "./routes/presets.js";
import { providersRouter } from "./routes/providers.js";
import { turnstileConfigured } from "./turnstile.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// 读取 server/.env（若存在）注入 process.env；已存在的环境变量不被覆盖。
// 生产环境请用真实环境变量 / 进程管理器注入密钥，避免落盘。
function loadLocalEnv() {
  const p = path.resolve(here, "../.env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadLocalEnv();

/** 构建 Express 应用（便于测试直接挂载，无需子进程） */
export function createApp(): express.Express {
  const db = openDb();
  const app = express();
  const PORT = Number(process.env.PORT ?? 3001);

  if (turnstileConfigured()) {
    console.log("[turnstile] 强制模式：未通过验证的请求将被拒绝（hostnames=" + (process.env.TURNSTILE_HOSTNAMES || "(未设，跳过 hostname 校验)") + "）");
  } else {
    console.log("[turnstile] 旁路模式：未配置 TURNSTILE_SECRET，校验放行（生产环境请配置密钥）");
  }

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

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const PORT = Number(process.env.PORT ?? 3001);
  createApp().listen(PORT, () => {
    console.log(`[server] AI 狼人杀后端已启动: http://localhost:${PORT}`);
  });
}
