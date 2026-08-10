import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

let masterKey: Buffer | null = null;

/** 确保主密钥存在（首次运行生成并落盘），返回 32 字节密钥 */
export function ensureMasterKey(dataDir: string): Buffer {
  if (masterKey) return masterKey;
  const keyFile = path.join(dataDir, ".masterkey");
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, "utf-8").trim();
    masterKey = Buffer.from(raw, "hex");
  } else {
    mkdirSync(dataDir, { recursive: true });
    masterKey = randomBytes(32);
    writeFileSync(keyFile, masterKey.toString("hex"), { encoding: "utf-8", mode: 0o600 });
  }
  return masterKey;
}

/** AES-256-GCM 加密：iv(12) + tag(16) + ciphertext，hex 编码 */
export function encryptSecret(plain: string, key = masterKey!): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("hex");
}

export function decryptSecret(hex: string, key = masterKey!): string {
  const buf = Buffer.from(hex, "hex");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
}