import type { Env } from "./env.js";

/**
 * Web Crypto 版 AES-256-GCM，密文格式与 Node 版 server/src/crypto.ts 完全一致：
 *   hex( iv(12) || tag(16) || ciphertext )
 * 因此本地 sqlite 里已加密的 api_key_enc 可以直接搬到 D1 而无需重新加密。
 */

// 注意：不要写 `: Uint8Array` 返回标注。TS 5.7 起 Uint8Array 带 ArrayBufferLike 泛型参数，
// 显式标注会退化成 Uint8Array<ArrayBufferLike>，无法赋给 Web Crypto 要求的 BufferSource。
// 让推断给出 Uint8Array<ArrayBuffer>，subarray() 也会保持该窄类型。
function hexToBytes(hex: string) {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

let cachedKey: CryptoKey | null = null;
let cachedKeyHex: string | null = null;

/**
 * 取得主密钥：优先环境变量 AWW_MASTER_KEY（推荐，密钥不落库），
 * 否则在 D1 的 app_meta 表里自动生成并持久化一份（首次运行自举）。
 */
export async function getMasterKey(env: Env): Promise<CryptoKey> {
  const envHex = (env.AWW_MASTER_KEY ?? "").trim();
  let hex = envHex;
  if (!hex) {
    const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key='master_key'").first<{ value: string }>();
    if (row?.value) {
      hex = row.value;
    } else {
      const raw = new Uint8Array(32);
      crypto.getRandomValues(raw);
      hex = bytesToHex(raw);
      await env.DB.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('master_key', ?)").bind(hex).run();
    }
  }
  if (cachedKey && cachedKeyHex === hex) return cachedKey;
  const key = await crypto.subtle.importKey("raw", hexToBytes(hex), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  cachedKey = key;
  cachedKeyHex = hex;
  return key;
}

export async function encryptSecret(env: Env, plain: string): Promise<string> {
  const key = await getMasterKey(env);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const enc = new TextEncoder().encode(plain);
  // Web Crypto 输出 ciphertext||tag(16)，需拆开重排成 iv||tag||ciphertext
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc));
  const tag = sealed.subarray(sealed.length - 16);
  const body = sealed.subarray(0, sealed.length - 16);
  const out = new Uint8Array(12 + 16 + body.length);
  out.set(iv, 0);
  out.set(tag, 12);
  out.set(body, 28);
  return bytesToHex(out);
}

export async function decryptSecret(env: Env, hex: string): Promise<string> {
  const key = await getMasterKey(env);
  const buf = hexToBytes(hex);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const body = buf.subarray(28);
  const sealed = new Uint8Array(body.length + 16);
  sealed.set(body, 0);
  sealed.set(tag, body.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed);
  return new TextDecoder().decode(plain);
}

/** 生成 hex 随机串（真人座位邀请 token 用） */
export function randomHex(bytes: number): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return bytesToHex(raw);
}
