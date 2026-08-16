/**
 * Cloudflare Pages Functions 统一 API 入口。
 *
 * 设计要点：
 * 1. 无状态：对局引擎不常驻，靠「回合快照 + 决策日志重放」在每次请求里推进（worker/driver.ts）。
 * 2. 轮询即心跳：前端每 2s 拉一次状态/事件，这些 GET 接口会顺带调用 stepGame 推进有限个真实 LLM 决策。
 * 3. 零依赖：使用原生 Web 标准 Request/Response 手写路由，不引入 Hono，压缩 bundle 体积。
 */
import type { Env, PagesContext } from "../../worker/env.js";
import { ensureSchema } from "../../worker/schema.js";
import { guard, turnstileConfigured } from "../../worker/turnstile.js";
import { stepGame } from "../../worker/driver.js";
import {
  createGame,
  startGame,
  controlGame,
  getGameState,
  getGameEvents,
  listGames,
  getReport,
  joinHumanSeat,
  getHumanView,
  submitHumanAction,
} from "../../worker/games.js";
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  importProfiles,
  testProfile,
  listPresets,
  savePreset,
  deletePreset,
  listProviders,
} from "../../worker/profiles.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}

function fail(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const text = await req.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 把驱动异常吞掉：推进失败不该让读接口 500，前端下一次轮询会再试 */
async function tryStep(env: Env, gameId: number): Promise<void> {
  try {
    await stepGame(env, gameId);
  } catch (e) {
    console.error(`stepGame(${gameId}) failed:`, e instanceof Error ? e.message : e);
  }
}

/** SSE：Workers 里没有常驻的事件总线，改为「短周期流式轮询」，客户端断开后 EventSource 会自动重连 */
function sseStream(env: Env, gameId: number, afterSeq: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let after = afterSeq;
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      write(": connected\n\n");
      // 最多推 25 轮（约 30s）后主动收流，避免长连接占用与计费异常
      for (let i = 0; i < 25 && !closed; i++) {
        await tryStep(env, gameId);
        try {
          const events = await getGameEvents(env, gameId, after);
          for (const evt of events) {
            write(`data: ${JSON.stringify(evt)}\n\n`);
            after = evt.seq;
          }
        } catch (e) {
          console.error("sse events failed:", e instanceof Error ? e.message : e);
        }
        write(": ping\n\n");
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (!closed) {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...CORS,
    },
  });
}

export const onRequest = async (ctx: PagesContext): Promise<Response> => {
  const { request, env } = ctx;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const segs = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  // segs[0] === "api"
  const p = segs.slice(1);
  const m = request.method;

  try {
    await ensureSchema(env);
  } catch (e) {
    return fail(`数据库初始化失败：${e instanceof Error ? e.message : String(e)}`, 500);
  }

  try {
    // ---------- health / providers ----------
    if (p.length === 0 || (p.length === 1 && p[0] === "health")) {
      return json({
        ok: true,
        time: new Date().toISOString(),
        runtime: "cloudflare-pages",
        driver: "d1-poll",
        // 只暴露「是否启用」这个布尔位，不暴露密钥本身。
        // 前端据此决定要不要渲染 Turnstile 组件（本地/预览环境没配密钥时就别挡用户），
        // 线上烟测也据此判断「无 token 写接口该 403」这条断言要不要生效。
        turnstile: turnstileConfigured(env),
      });
    }
    if (p[0] === "providers" && p.length === 1 && m === "GET") return json(listProviders());

    // ---------- presets ----------
    if (p[0] === "presets") {
      if (p.length === 1 && m === "GET") return json(await listPresets(env));
      if (p.length === 1 && m === "POST") {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "save_preset");
        if (blocked) return json(blocked, 403);
        return json(await savePreset(env, body), 201);
      }
      if (p.length === 2 && m === "DELETE") {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "delete_preset");
        if (blocked) return json(blocked, 403);
        return json(await deletePreset(env, Number(p[1])));
      }
      return fail("method not allowed", 405);
    }

    // ---------- ai-profiles ----------
    if (p[0] === "ai-profiles") {
      if (p.length === 1 && m === "GET") return json(await listProfiles(env));
      if (p.length === 1 && m === "POST") {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "create_profile");
        if (blocked) return json(blocked, 403);
        return json(await createProfile(env, body), 201);
      }
      if (p.length === 2 && p[1] === "import" && m === "POST") {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "import_profiles");
        if (blocked) return json(blocked, 403);
        const profiles = Array.isArray(body.profiles) ? (body.profiles as Record<string, unknown>[]) : [];
        return json(await importProfiles(env, profiles), 201);
      }
      if (p.length === 3 && p[2] === "test" && m === "POST") {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "test_profile");
        if (blocked) return json(blocked, 403);
        return json(await testProfile(env, Number(p[1]), typeof body.api_key === "string" ? body.api_key : undefined));
      }
      if (p.length === 2) {
        const id = Number(p[1]);
        if (m === "GET") return json(await getProfile(env, id));
        const body = await readBody(request);
        if (m === "PUT") {
          const blocked = await guard(env, request, body, "update_profile");
          if (blocked) return json(blocked, 403);
          return json(await updateProfile(env, id, body));
        }
        if (m === "DELETE") {
          const blocked = await guard(env, request, body, "delete_profile");
          if (blocked) return json(blocked, 403);
          return json(await deleteProfile(env, id));
        }
      }
      return fail("method not allowed", 405);
    }

    // ---------- games ----------
    if (p[0] === "games") {
      if (p.length === 1 && m === "GET") return json(await listGames(env, Number(url.searchParams.get("profile_id") ?? 0)));
      if (p.length === 1 && m === "POST") {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "create_game");
        if (blocked) return json(blocked, 403);
        return json(await createGame(env, body as never), 201);
      }

      const gameId = Number(p[1]);
      if (!Number.isFinite(gameId) || gameId <= 0) return fail("invalid game id", 400);

      if (p.length === 2 && m === "GET") {
        await tryStep(env, gameId);
        return json(await getGameState(env, gameId));
      }

      if (p.length === 3 && m === "POST" && p[2] === "start") {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "start_game");
        if (blocked) return json(blocked, 403);
        const pace = typeof body.pace === "string" ? body.pace : "slow";
        await startGame(env, gameId, pace);
        ctx.waitUntil(tryStep(env, gameId)); // 立刻先推一步，减少首帧等待
        return json({ ok: true });
      }

      if (p.length === 3 && m === "POST" && (p[2] === "pause" || p[2] === "resume" || p[2] === "abort")) {
        const body = await readBody(request);
        const blocked = await guard(env, request, body, "control_game");
        if (blocked) return json(blocked, 403);
        await controlGame(env, gameId, p[2]);
        return json({ ok: true });
      }

      if (p.length === 3 && m === "GET" && p[2] === "report") return json(await getReport(env, gameId));

      if (p.length === 3 && m === "GET" && p[2] === "events-list") {
        await tryStep(env, gameId);
        return json(await getGameEvents(env, gameId, Number(url.searchParams.get("after") ?? 0)));
      }

      if (p.length === 3 && m === "GET" && p[2] === "events") {
        return sseStream(env, gameId, Number(url.searchParams.get("after") ?? 0));
      }

      // /games/:id/seats/:token/(join|view|action)
      if (p.length === 5 && p[2] === "seats") {
        const token = String(p[3]);
        if (p[4] === "join" && m === "POST") {
          const body = await readBody(request);
          const blocked = await guard(env, request, body, "join_game");
          if (blocked) return json(blocked, 403);
          return json(await joinHumanSeat(env, gameId, token, String(body.name ?? "")));
        }
        if (p[4] === "view" && m === "GET") {
          await tryStep(env, gameId);
          return json(await getHumanView(env, gameId, token));
        }
        if (p[4] === "action" && m === "POST") {
          const result = await submitHumanAction(env, gameId, token, await readBody(request));
          ctx.waitUntil(tryStep(env, gameId)); // 提交后立即消费收件箱，缩短等待
          return json(result);
        }
      }

      return fail("not found", 404);
    }

    return fail("not found", 404);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const notFound = /不存在|not found|未找到/.test(msg);
    console.error(`${m} ${url.pathname} ->`, msg);
    return fail(msg, notFound ? 404 : 400);
  }
};
