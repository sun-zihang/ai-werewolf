/** Cloudflare Pages Functions 运行时环境绑定 */
export interface Env {
  /** D1 数据库绑定（在 Pages 项目设置 / wrangler.toml 中绑定，变量名 DB） */
  DB: D1Database;
  /** Turnstile 服务端密钥；未设置则校验旁路（本地/预览环境方便调试） */
  TURNSTILE_SECRET?: string;
  /** 允许的 hostname 白名单，逗号分隔；留空跳过 hostname 校验 */
  TURNSTILE_HOSTNAMES?: string;
  /** siteverify 地址覆盖（测试用） */
  TURNSTILE_SITEVERIFY_URL?: string;
  /** API Key 加密主密钥（64 位 hex = 32 字节）。缺省时回落到 D1 中自动生成的密钥 */
  AWW_MASTER_KEY?: string;
  /** 单次推进的最大真实决策数上限覆盖（调试用） */
  AWW_STEP_BUDGET?: string;
}

/** 最小化的 D1 类型声明：避免为了几个接口引入 @cloudflare/workers-types 全量依赖 */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number; duration: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

/** Pages Functions 的 EventContext 精简签名 */
export interface PagesContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil(promise: Promise<unknown>): void;
  next(): Promise<Response>;
}
