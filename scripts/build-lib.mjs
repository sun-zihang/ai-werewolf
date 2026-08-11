#!/usr/bin/env node
/**
 * 把 server/src/{engine,ai,types.ts} 编译成 server/lib/*.js，供 Cloudflare Pages Functions 直接 import。
 *
 * 为什么需要这个包装脚本，而不是直接在 package.json 里调 tsc：
 *
 *   Cloudflare Pages 的构建容器可能带着 NODE_ENV=production 执行 `npm install`，
 *   这会跳过 devDependencies —— 于是根目录的 typescript 不存在。
 *   如果构建命令里硬编码 `tsc`，整个部署会因为「工具链缺失」而失败，
 *   哪怕仓库里已经提交了一份可用的 server/lib。
 *
 * 所以这里区分两种失败：
 *   1) 找不到 tsc（工具链问题）  -> 警告并退出 0，回落到仓库里已提交的 server/lib
 *   2) tsc 报了类型错误（代码问题）-> 退出 1，让部署红掉
 *
 * 第 2 种必须硬失败：server/lib 是 Workers 侧唯一的引擎真相源，
 * 静默带着旧产物上线会造成前后端行为不一致，比构建失败难查得多。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tscEntry = path.join(root, "node_modules", "typescript", "bin", "tsc");
const project = path.join(root, "server", "tsconfig.lib.json");
const libDir = path.join(root, "server", "lib");

function countLibFiles() {
  if (!existsSync(libDir)) return 0;
  let n = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith(".js")) n++;
    }
  };
  walk(libDir);
  return n;
}

if (!existsSync(tscEntry)) {
  const n = countLibFiles();
  if (n === 0) {
    console.error(
      "[build-lib] 找不到 typescript，且 server/lib 里没有任何 .js 产物。\n" +
        "            Pages Functions 会 import 失败。请先在本地跑 `npm run build:lib` 并提交 server/lib。",
    );
    process.exit(1);
  }
  console.warn(
    `[build-lib] 未找到 typescript（很可能是 NODE_ENV=production 跳过了 devDependencies）。\n` +
      `            回落使用仓库中已提交的 server/lib（${n} 个 .js 文件）。`,
  );
  process.exit(0);
}

const res = spawnSync(process.execPath, [tscEntry, "-p", project], {
  cwd: root,
  stdio: "inherit",
});

if (res.status !== 0) {
  console.error(
    "[build-lib] server/src/{engine,ai} 编译失败。\n" +
      "            注意 tsconfig.lib.json 故意用 `types: []` + `lib: [ES2023, WebWorker]`：\n" +
      "            这两个目录必须保持运行时无关，不能引用 node:* / process / Buffer。",
  );
  process.exit(1);
}

console.log(`[build-lib] OK -> server/lib（${countLibFiles()} 个 .js 文件）`);
