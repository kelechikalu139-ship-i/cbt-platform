import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const { Pool } = pg;
const serviceEnvPath = fileURLToPath(new URL("../.env", import.meta.url));
const schoolEnvPath = fileURLToPath(new URL("../../server/.env", import.meta.url));
const [serviceRaw, schoolRaw] = await Promise.all([
  readFile(serviceEnvPath, "utf8"),
  readFile(schoolEnvPath, "utf8"),
]);
const serviceEnv = dotenv.parse(serviceRaw);
const schoolEnv = dotenv.parse(schoolRaw);

function readEd25519Key(value, createKey) {
  try {
    const key = createKey(Buffer.from(value || "", "base64").toString("utf8"));
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

function updateEnv(raw, name, value) {
  const lines = raw.split(/\r?\n/);
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
  const indexes = lines.flatMap((line, index) => matcher.test(line) ? [index] : []);
  if (indexes.length > 1) throw new Error(`Multiple ${name} entries found; no files were changed`);
  if (indexes.length === 1) lines[indexes[0]] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  return lines.join("\n").replace(/\n*$/, "\n");
}

if (serviceEnv.NODE_ENV?.toLowerCase() === "production") {
  throw new Error("Refusing to create development signing keys for a production environment");
}
if (!serviceEnv.DATABASE_URL) throw new Error("DATABASE_URL is missing from licensing-service/.env");

const configuredPrivate = readEd25519Key(serviceEnv.LICENSE_PRIVATE_KEY_B64, crypto.createPrivateKey);
const configuredPublic = readEd25519Key(serviceEnv.LICENSE_PUBLIC_KEY_B64, crypto.createPublicKey);
const schoolPublic = readEd25519Key(schoolEnv.LICENSE_PUBLIC_KEY_B64, crypto.createPublicKey);
if (configuredPrivate || configuredPublic || schoolPublic) {
  throw new Error("At least one valid signing key already exists; refusing to rotate or overwrite it");
}

const pool = new Pool({
  connectionString: serviceEnv.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  max: 1,
  ssl: serviceEnv.PGSSL?.toLowerCase() === "true" ? { rejectUnauthorized: true } : undefined,
});
try {
  const { rows } = await pool.query("SELECT current_database() AS name, count(*)::int AS licenses FROM licenses");
  if (rows[0].name !== "cbt_licensing_platform") {
    throw new Error("Refusing to change keys outside cbt_licensing_platform");
  }
  if (rows[0].licenses !== 0) {
    throw new Error("Refusing key initialization because the local database already contains licenses");
  }
} finally {
  await pool.end();
}

const pair = crypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const privateKeyB64 = Buffer.from(pair.privateKey).toString("base64");
const publicKeyB64 = Buffer.from(pair.publicKey).toString("base64");
const nextServiceEnv = updateEnv(
  updateEnv(serviceRaw, "LICENSE_PRIVATE_KEY_B64", privateKeyB64),
  "LICENSE_PUBLIC_KEY_B64",
  publicKeyB64,
);
const nextSchoolEnv = updateEnv(schoolRaw, "LICENSE_PUBLIC_KEY_B64", publicKeyB64);
await Promise.all([
  writeFile(serviceEnvPath, nextServiceEnv, "utf8"),
  writeFile(schoolEnvPath, nextSchoolEnv, "utf8"),
]);
console.log("Created a local Ed25519 key pair and configured its public key for the school server. Key values were not printed.");
