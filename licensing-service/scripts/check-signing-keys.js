import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

function readKey(value, createKey) {
  try {
    const pem = Buffer.from(value || "", "base64").toString("utf8");
    const key = createKey(pem);
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

const licensingEnv = dotenv.parse(await readFile(new URL("../.env", import.meta.url)).catch(() => Buffer.from("")));
const schoolEnvPath = fileURLToPath(new URL("../../server/.env", import.meta.url));
const schoolEnv = dotenv.parse(await readFile(schoolEnvPath).catch(() => Buffer.from("")));
const privateKey = readKey(licensingEnv.LICENSE_PRIVATE_KEY_B64, crypto.createPrivateKey);
const publicKey = readKey(licensingEnv.LICENSE_PUBLIC_KEY_B64, crypto.createPublicKey);
const schoolPublicKey = readKey(schoolEnv.LICENSE_PUBLIC_KEY_B64, crypto.createPublicKey);
let keyPairMatches = false;
if (privateKey && publicKey) {
  const derived = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const configured = publicKey.export({ type: "spki", format: "der" });
  keyPairMatches = derived.length === configured.length && crypto.timingSafeEqual(derived, configured);
}
let schoolKeyMatches = false;
if (privateKey && schoolPublicKey) {
  const derived = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const configured = schoolPublicKey.export({ type: "spki", format: "der" });
  schoolKeyMatches = derived.length === configured.length && crypto.timingSafeEqual(derived, configured);
}

console.log(JSON.stringify({
  licensingPrivateKeyValid: Boolean(privateKey),
  licensingPublicKeyValid: Boolean(publicKey),
  licensingKeyPairMatches: keyPairMatches,
  schoolPublicKeyConfigured: Boolean(schoolEnv.LICENSE_PUBLIC_KEY_B64),
  schoolPublicKeyValid: Boolean(schoolPublicKey),
  schoolKeyMatches,
}));
