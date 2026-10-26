import "dotenv/config";
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (process.env.NODE_ENV !== "development") throw new Error("Local MFA key setup is allowed only when NODE_ENV=development");
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "") !== "cbt_licensing_platform")
  throw new Error("Refusing local MFA key setup outside cbt_licensing_platform");

const existing = process.env.MFA_ENCRYPTION_KEY_B64;
if (existing) {
  if (Buffer.from(existing, "base64").length !== 32) throw new Error("Configured MFA_ENCRYPTION_KEY_B64 must decode to 32 bytes");
  console.log("Local MFA encryption key is already configured; no changes made.");
} else {
  const content = await readFile(envPath, "utf8");
  const key = crypto.randomBytes(32).toString("base64");
  const next = /^MFA_ENCRYPTION_KEY_B64=.*$/m.test(content)
    ? content.replace(/^MFA_ENCRYPTION_KEY_B64=.*$/m, `MFA_ENCRYPTION_KEY_B64=${key}`)
    : `${content.endsWith("\n") ? content : `${content}\n`}MFA_ENCRYPTION_KEY_B64=${key}\n`;
  await writeFile(envPath, next, "utf8");
  console.log("Local MFA encryption key added to ignored licensing-service/.env. Back it up securely; do not rotate it after admins enroll.");
}
