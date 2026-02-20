import crypto from "crypto";

const VERSION = "v1";

function deriveKey(): Buffer | null {
  const raw = String(process.env.RPA_CREDENTIALS_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;

  if (raw.startsWith("base64:")) {
    const b = Buffer.from(raw.slice("base64:".length), "base64");
    if (b.length === 32) return b;
  }
  if (/^[a-fA-F0-9]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function hasPortalCredentialEncryptionKey(): boolean {
  return Boolean(deriveKey());
}

export function encryptPortalSecret(value: string): string {
  const key = deriveKey();
  if (!key) throw new Error("RPA_CREDENTIALS_ENCRYPTION_KEY is not set");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptPortalSecret(value: string | null | undefined): string | null {
  const payload = String(value || "").trim();
  if (!payload) return null;

  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    // Backward compatibility for old plaintext values.
    return payload;
  }

  const key = deriveKey();
  if (!key) throw new Error("RPA_CREDENTIALS_ENCRYPTION_KEY is not set");

  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
