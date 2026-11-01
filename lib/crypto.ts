import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// AES-256-GCM for stored account passwords and API keys. The key comes from AUTH_SECRET,
// so the database file alone is useless without the server's .env.
const key = () => createHash("sha256").update(`${process.env.AUTH_SECRET || "dev-only-secret-change-me"}:accounts`).digest();

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

export function decrypt(blob: string) {
  const raw = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}
