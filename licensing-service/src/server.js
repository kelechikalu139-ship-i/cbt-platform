import "dotenv/config";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pg from "pg";
import { z } from "zod";
import {
  buildLicense,
  generateActivationKey,
  hashKey,
} from "./license-service.js";
import { activationFailure, offlineIssueFailure } from "./license-policy.js";

const { Pool } = pg;
const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "MFA_ENCRYPTION_KEY_B64",
  "LICENSE_PRIVATE_KEY_B64",
  "LICENSE_PUBLIC_KEY_B64",
  "PORTAL_ORIGIN",
];
for (const key of required)
  if (!process.env[key])
    throw new Error(`Missing required environment variable: ${key}`);
if (process.env.JWT_SECRET.length < 32)
  throw new Error("JWT_SECRET must be at least 32 characters");
const mfaEncryptionKey = Buffer.from(process.env.MFA_ENCRYPTION_KEY_B64, "base64");
if (mfaEncryptionKey.length !== 32)
  throw new Error("MFA_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes");

function loadLicenseKey(name, createKey) {
  try {
    return createKey(Buffer.from(process.env[name], "base64").toString("utf8"));
  } catch {
    throw new Error(`${name} must contain a valid base64-encoded Ed25519 PEM key`);
  }
}
const privateKey = loadLicenseKey("LICENSE_PRIVATE_KEY_B64", crypto.createPrivateKey);
const publicKey = loadLicenseKey("LICENSE_PUBLIC_KEY_B64", crypto.createPublicKey);
if (
  privateKey.asymmetricKeyType !== "ed25519" ||
  publicKey.asymmetricKeyType !== "ed25519"
)
  throw new Error("Licence keys must be Ed25519");
const derivedPublicKey = crypto
  .createPublicKey(privateKey)
  .export({ type: "spki", format: "der" });
const configuredPublicKey = publicKey.export({ type: "spki", format: "der" });
if (!crypto.timingSafeEqual(derivedPublicKey, configuredPublicKey))
  throw new Error(
    "Configured Ed25519 public key does not match the private key",
  );
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE || 5),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: process.env.PORTAL_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "64kb" }));
app.use(
  rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
});
const dummyPasswordHash = bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

async function recordLicenseEvent(client, event) {
  await client.query(
    "INSERT INTO license_events (id,license_id,event_type,actor_email,installation_id,metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [
      crypto.randomUUID(),
      event.licenseId,
      event.type,
      event.actorEmail || null,
      event.installationId || null,
      JSON.stringify(event.metadata || {}),
    ],
  );
}

const hashInvitationToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const createSchema = z.object({
  institutionName: z.string().trim().min(2).max(190),
  institutionId: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  contactEmail: z
    .union([z.string().email().max(190), z.literal("")])
    .optional(),
  plan: z.enum(["TRIAL", "STANDARD", "PROFESSIONAL", "ENTERPRISE"]),
  maxCandidates: z.number().int().min(1).max(100000),
  expiresAt: z.union([z.string().date(), z.null()]).optional(),
  features: z
    .array(
      z.enum([
        "cbt",
        "question-bank",
        "results",
        "excel-export",
        "pdf-export",
        "backup-restore",
        "osce",
        "viva",
      ]),
    )
    .max(20)
    .default([
      "cbt",
      "question-bank",
      "results",
      "excel-export",
      "pdf-export",
      "backup-restore",
    ]),
});
const activationSchema = z.object({
  activationKey: z.string().trim().min(15).max(100),
  installationId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});
const renewSchema = z.object({
  plan: z.enum(["TRIAL", "STANDARD", "PROFESSIONAL", "ENTERPRISE"]),
  maxCandidates: z.number().int().min(1).max(100000),
  expiresAt: z.union([z.string().date(), z.null()]),
  features: createSchema.shape.features,
});
const loginSchema = z.object({
  email: z.string().trim().email().max(190),
  password: z.string().min(1).max(200).optional(),
  mfaCode: z.string().trim().max(32).optional(),
  mfaChallengeToken: z.string().min(20).max(2048).optional(),
}).superRefine((value, context) => {
  if (!value.password && !value.mfaChallengeToken)
    context.addIssue({ code: "custom", message: "Password is required" });
  if (value.mfaChallengeToken && !value.mfaCode)
    context.addIssue({ code: "custom", message: "Authenticator code is required" });
});
const invitationSchema = z.object({ email: z.string().trim().email().max(190) });
const registrationSchema = z.object({
  email: z.string().trim().email().max(190),
  invitationToken: z.string().min(32).max(128),
  password: z.string().min(12).max(200),
});
const bootstrapSchema = z.object({
  bootstrapToken: z.string().min(32).max(128),
  password: z.string().min(12).max(200),
});
const mfaVerifySchema = z.object({ code: z.string().trim().min(6).max(32) });

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
function decodeBase32(value) {
  let bits = 0;
  let buffer = 0;
  const output = [];
  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("Invalid stored MFA secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
function encryptMfaSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", mfaEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}
function decryptMfaSecret(value) {
  const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", mfaEncryptionKey, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
}
function verifyTotp(secret, input, now = Date.now()) {
  const code = String(input || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const key = decodeBase32(secret);
  const currentStep = Math.floor(now / 30000);
  for (const step of [currentStep - 2, currentStep - 1, currentStep, currentStep + 1, currentStep + 2]) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = crypto.createHmac("sha1", key).update(counter).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
    const expected = String(binary % 1_000_000).padStart(6, "0");
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) return step;
  }
  return null;
}
function digestRecoveryCode(code) {
  return crypto.createHash("sha256").update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}
function issueAdminToken(account, expiresIn = "30m") {
  return jwt.sign({ sub: account.email, id: account.id, role: account.role }, process.env.JWT_SECRET, {
    expiresIn,
    issuer: "cbt-licensing",
    algorithm: "HS256",
  });
}

async function adminAuth(req, res, next) {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "";
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "cbt-licensing",
      algorithms: ["HS256"],
    });
    if (!claims.sub || !claims.id || !["SUPER_ADMIN", "ADMIN"].includes(claims.role))
      throw new Error("Invalid administrator token");
    req.adminClaims = claims;
  } catch {
    return res.status(401).json({ message: "Authentication required" });
  }
  const { rows } = await pool.query(
    "SELECT id,email,role,status,mfa_enabled FROM licensing_admins WHERE id=$1 AND email=$2",
    [req.adminClaims.id, req.adminClaims.sub],
  );
  if (!rows.length || rows[0].status !== "ACTIVE" || !rows[0].mfa_enabled || rows[0].role !== req.adminClaims.role)
    return res.status(401).json({ message: "Authentication required" });
  req.admin = { ...req.adminClaims, role: rows[0].role, sub: rows[0].email, id: rows[0].id };
  delete req.adminClaims;
  next();
}

async function adminMfaSetupAuth(req, res, next) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { issuer: "cbt-licensing", algorithms: ["HS256"] });
    if (claims.role !== "MFA_ENROLLMENT" || !claims.id || !claims.sub) throw new Error("Invalid MFA enrollment token");
  } catch {
    return res.status(401).json({ message: "MFA enrollment session expired; sign in again" });
  }
  const { rows } = await pool.query("SELECT id,email,status,mfa_enabled FROM licensing_admins WHERE id=$1 AND email=$2", [claims.id, claims.sub]);
  if (!rows.length || rows[0].status !== "ACTIVE" || rows[0].mfa_enabled)
    return res.status(401).json({ message: "MFA enrollment session is no longer valid" });
  req.admin = { id: rows[0].id, sub: rows[0].email };
  next();
}

app.get(
  "/health",
  wrap(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  }),
);

app.post(
  "/api/admin/login",
  loginLimiter,
  wrap(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid sign-in details" });
    const email = parsed.data.email.toLowerCase();
    let challengeClaims = null;
    if (parsed.data.mfaChallengeToken) {
      try {
        challengeClaims = jwt.verify(parsed.data.mfaChallengeToken, process.env.JWT_SECRET, {
          issuer: "cbt-licensing", algorithms: ["HS256"],
        });
        if (challengeClaims.role !== "MFA_CHALLENGE" || challengeClaims.sub !== email || !challengeClaims.id)
          throw new Error("Invalid MFA challenge");
      } catch {
        return res.status(401).json({ message: "MFA sign-in expired; enter your email and password again" });
      }
    }
    const { rows } = await pool.query(
      "SELECT id,email,password_hash,role,status,mfa_enabled FROM licensing_admins WHERE email=$1",
      [email],
    );
    const account = rows[0];
    const passwordOk = challengeClaims
      ? Boolean(account && challengeClaims.id === account.id)
      : await bcrypt.compare(parsed.data.password, account?.password_hash || await dummyPasswordHash);
    if (!account || account.status !== "ACTIVE" || !passwordOk)
      return res.status(401).json({ message: "Invalid credentials" });
    if (!account.mfa_enabled) {
      if (challengeClaims) return res.status(401).json({ message: "MFA sign-in is no longer valid; enter your password again" });
      const setupToken = jwt.sign({ sub: email, id: account.id, role: "MFA_ENROLLMENT" }, process.env.JWT_SECRET, {
        expiresIn: "10m", issuer: "cbt-licensing", algorithm: "HS256",
      });
      return res.json({ mfaSetupRequired: true, setupToken, user: { id: account.id, email, role: account.role } });
    }
    if (!parsed.data.mfaChallengeToken) {
      const mfaChallengeToken = jwt.sign({ sub: email, id: account.id, role: "MFA_CHALLENGE" }, process.env.JWT_SECRET, {
        expiresIn: "5m", issuer: "cbt-licensing", algorithm: "HS256",
      });
      return res.json({ mfaRequired: true, mfaChallengeToken });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT mfa_secret_enc,mfa_last_used_step,mfa_recovery_codes FROM licensing_admins WHERE id=$1 AND status='ACTIVE' AND mfa_enabled=TRUE FOR UPDATE",
        [account.id],
      );
      if (!current.rows.length) {
        await client.query("ROLLBACK");
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const adminMfa = current.rows[0];
      const step = verifyTotp(decryptMfaSecret(adminMfa.mfa_secret_enc), parsed.data.mfaCode);
      let valid = false;
      if (step !== null && step > Number(adminMfa.mfa_last_used_step)) {
        await client.query("UPDATE licensing_admins SET mfa_last_used_step=$1 WHERE id=$2", [step, account.id]);
        valid = true;
      } else if (step === null) {
        const recoveryHash = digestRecoveryCode(parsed.data.mfaCode);
        const hashes = Array.isArray(adminMfa.mfa_recovery_codes) ? adminMfa.mfa_recovery_codes : [];
        const index = hashes.findIndex((hash) => {
          const left = Buffer.from(String(hash));
          const right = Buffer.from(recoveryHash);
          return left.length === right.length && crypto.timingSafeEqual(left, right);
        });
        if (index >= 0) {
          hashes.splice(index, 1);
          await client.query("UPDATE licensing_admins SET mfa_recovery_codes=$1::jsonb WHERE id=$2", [JSON.stringify(hashes), account.id]);
          valid = true;
        }
      }
      if (!valid) {
        await client.query("ROLLBACK");
        return res.status(401).json({ message: "Authenticator or recovery code is invalid" });
      }
      await client.query("UPDATE licensing_admins SET last_login_at=CURRENT_TIMESTAMP WHERE id=$1", [account.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const token = issueAdminToken(account);
    res.json({
      token,
      expiresIn: 1800,
      user: { id: account.id, email, role: account.role },
    });
  }),
);

app.post(
  "/api/public/bootstrap",
  loginLimiter,
  wrap(async (req, res) => {
    const parsed = bootstrapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Bootstrap token or password is invalid" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('licensing-super-admin-bootstrap'))");
      const admins = await client.query("SELECT count(*)::int AS count FROM licensing_admins");
      const setup = await client.query(
        "SELECT email FROM licensing_admin_bootstrap WHERE id=1 AND token_hash=$1 AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE",
        [hashInvitationToken(parsed.data.bootstrapToken)],
      );
      if (admins.rows[0].count > 0 || !setup.rows.length) {
        await client.query("ROLLBACK");
        return res.status(410).json({ message: "Super-admin setup link is invalid, expired, or already used" });
      }
      const email = setup.rows[0].email;
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const inserted = await client.query(
        "INSERT INTO licensing_admins (id,email,password_hash,role) VALUES ($1,$2,$3,'SUPER_ADMIN') RETURNING id,email",
        [crypto.randomUUID(), email, passwordHash],
      );
      await client.query("UPDATE licensing_admin_bootstrap SET used_at=CURRENT_TIMESTAMP WHERE id=1");
      await recordLicenseEvent(client, { type: "SUPER_ADMIN_BOOTSTRAPPED", actorEmail: email, metadata: { role: "SUPER_ADMIN" } });
      await client.query("COMMIT");
      res.status(201).json({ message: "Super administrator registered. You can now sign in.", email: inserted.rows[0].email });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.get(
  "/api/public/bootstrap-status",
  loginLimiter,
  wrap(async (req, res) => {
    const token = String(req.query.token || "");
    if (token.length < 32 || token.length > 128) return res.json({ available: false });
    const [admins, setup] = await Promise.all([
      pool.query("SELECT 1 FROM licensing_admins LIMIT 1"),
      pool.query(
        "SELECT email FROM licensing_admin_bootstrap WHERE id=1 AND token_hash=$1 AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP",
        [hashInvitationToken(token)],
      ),
    ]);
    const available = admins.rows.length === 0 && setup.rows.length > 0;
    res.json({ available, ...(available ? { email: setup.rows[0].email } : {}) });
  }),
);

app.post(
  "/api/admin/register",
  loginLimiter,
  wrap(async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Registration details are invalid; passwords must be at least 12 characters" });
    const email = parsed.data.email.toLowerCase();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const invitation = await client.query(
        "SELECT id,email FROM licensing_admin_invitations WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE",
        [hashInvitationToken(parsed.data.invitationToken)],
      );
      if (!invitation.rows.length || invitation.rows[0].email !== email) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Invitation is invalid, expired, or belongs to another email" });
      }
      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const inserted = await client.query(
        "INSERT INTO licensing_admins (id,email,password_hash,role) VALUES ($1,$2,$3,'ADMIN') ON CONFLICT (email) DO NOTHING RETURNING id,email,role",
        [crypto.randomUUID(), email, passwordHash],
      );
      if (!inserted.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "An administrator already uses this email" });
      }
      await client.query("UPDATE licensing_admin_invitations SET used_at=CURRENT_TIMESTAMP WHERE id=$1", [invitation.rows[0].id]);
      await recordLicenseEvent(client, { type: "ADMIN_REGISTERED", actorEmail: email, metadata: { role: "ADMIN" } });
      await client.query("COMMIT");
      res.status(201).json({ message: "Administrator account created. Sign in to continue." });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.get("/api/admin/me", adminAuth, (req, res) => {
  res.json({ user: { id: req.admin.id, email: req.admin.sub, role: req.admin.role } });
});

app.get("/api/admin/admins", adminAuth, wrap(async (req, res) => {
  if (req.admin.role !== "SUPER_ADMIN") return res.status(403).json({ message: "Super administrator access required" });
  const { rows } = await pool.query("SELECT id,email,role,status,created_at,last_login_at FROM licensing_admins ORDER BY created_at");
  res.json({ data: rows });
}));

app.post("/api/admin/invitations", adminAuth, wrap(async (req, res) => {
  if (req.admin.role !== "SUPER_ADMIN") return res.status(403).json({ message: "Super administrator access required" });
  const parsed = invitationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "A valid administrator email is required" });
  const email = parsed.data.email.toLowerCase();
  const token = crypto.randomBytes(32).toString("base64url");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT 1 FROM licensing_admins WHERE email=$1", [email]);
    if (existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "An administrator account already exists for this email" });
    }
    await client.query(
      "UPDATE licensing_admin_invitations SET revoked_at=CURRENT_TIMESTAMP WHERE email=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at<=CURRENT_TIMESTAMP",
      [email],
    );
    await client.query(
      "INSERT INTO licensing_admin_invitations (id,email,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP + INTERVAL '48 hours')",
      [crypto.randomUUID(), email, hashInvitationToken(token), req.admin.id],
    );
    await recordLicenseEvent(client, { type: "ADMIN_INVITED", actorEmail: req.admin.sub, metadata: { invitedEmail: email } });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") return res.status(409).json({ message: "An account or unexpired invitation already exists for this email" });
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json({ data: { email, token, expiresInHours: 48 } });
}));

app.post("/api/admin/admins/:id/disable", adminAuth, wrap(async (req, res) => {
  if (req.admin.role !== "SUPER_ADMIN") return res.status(403).json({ message: "Super administrator access required" });
  if (req.admin.id === req.params.id) return res.status(400).json({ message: "You cannot disable your own account" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('licensing-super-admin-disable'))");
    const { rows } = await client.query("SELECT id,role,status FROM licensing_admins WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!rows.length || rows[0].status === "DISABLED") {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Active administrator not found" });
    }
    if (rows[0].role === "SUPER_ADMIN") {
      const count = await client.query("SELECT count(*)::int AS active FROM licensing_admins WHERE role='SUPER_ADMIN' AND status='ACTIVE'");
      if (count.rows[0].active <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "The last active super administrator cannot be disabled" });
      }
    }
    await client.query("UPDATE licensing_admins SET status='DISABLED',updated_at=CURRENT_TIMESTAMP WHERE id=$1", [req.params.id]);
    await recordLicenseEvent(client, { type: "ADMIN_DISABLED", actorEmail: req.admin.sub, metadata: { adminId: req.params.id } });
    await client.query("COMMIT");
    res.json({ message: "Administrator disabled" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

app.post("/api/admin/mfa/setup", adminMfaSetupAuth, wrap(async (req, res) => {
  const secret = encodeBase32(crypto.randomBytes(20));
  const encrypted = encryptMfaSecret(secret);
  await pool.query("UPDATE licensing_admins SET mfa_pending_secret_enc=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [encrypted, req.admin.id]);
  const label = encodeURIComponent(`The Platform CBT:${req.admin.sub}`);
  const issuer = encodeURIComponent("The Platform CBT");
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  res.json({ secret, otpauthUrl, algorithm: "SHA1", digits: 6, periodSeconds: 30 });
}));

app.post("/api/admin/mfa/verify-setup", adminMfaSetupAuth, wrap(async (req, res) => {
  const parsed = mfaVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Enter the six-digit code from your authenticator app" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT email,role,mfa_pending_secret_enc,mfa_last_used_step FROM licensing_admins WHERE id=$1 AND status='ACTIVE' AND mfa_enabled=FALSE FOR UPDATE",
      [req.admin.id],
    );
    if (!rows.length || !rows[0].mfa_pending_secret_enc) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Generate an authenticator setup secret first" });
    }
    const step = verifyTotp(decryptMfaSecret(rows[0].mfa_pending_secret_enc), parsed.data.code);
    if (step === null || step <= Number(rows[0].mfa_last_used_step)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "That code is invalid or already used; wait for the next code and try again" });
    }
    const recoveryCodes = Array.from({ length: 10 }, () => {
      const raw = crypto.randomBytes(12).toString("hex").toUpperCase();
      return raw.match(/.{1,6}/g).join("-");
    });
    const recoveryHashes = recoveryCodes.map(digestRecoveryCode);
    await client.query(
      `UPDATE licensing_admins SET mfa_secret_enc=mfa_pending_secret_enc,mfa_pending_secret_enc=NULL,
       mfa_enabled=TRUE,mfa_enabled_at=CURRENT_TIMESTAMP,mfa_last_used_step=$1,mfa_recovery_codes=$2::jsonb,
       updated_at=CURRENT_TIMESTAMP WHERE id=$3`,
      [step, JSON.stringify(recoveryHashes), req.admin.id],
    );
    await recordLicenseEvent(client, { type: "ADMIN_MFA_ENABLED", actorEmail: rows[0].email, metadata: { role: rows[0].role } });
    await client.query("COMMIT");
    const account = { id: req.admin.id, email: rows[0].email, role: rows[0].role };
    res.json({ recoveryCodes, token: issueAdminToken(account), user: account });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

app.get(
  "/api/admin/licenses",
  adminAuth,
  wrap(async (_req, res) => {
    const { rows } = await pool.query(
      "SELECT id,institution_id,institution_name,contact_email,plan,status,installation_id,max_candidates,issued_at,expires_at,activated_at,features,created_at FROM licenses ORDER BY created_at DESC LIMIT 1000",
    );
    res.json({ data: rows });
  }),
);

app.post(
  "/api/admin/licenses",
  adminAuth,
  wrap(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          message: "Invalid licence details",
          errors: parsed.error.flatten(),
        });
    const input = parsed.data;
    if (input.expiresAt && input.expiresAt < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ message: "Expiry date must be today or later" });
    }
    const id = crypto.randomUUID();
    const key = generateActivationKey();
    const issued = new Date();
    const expiry = input.expiresAt
      ? new Date(`${input.expiresAt}T23:59:59.999Z`)
      : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: existing } = await client.query(
        "SELECT id FROM licenses WHERE institution_id=$1 AND status IN ('PENDING','ACTIVE') LIMIT 1",
        [input.institutionId],
      );
      if (existing.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "This institution already has a pending or active licence." });
      }
      await client.query(
        "INSERT INTO licenses (id,institution_id,institution_name,contact_email,plan,status,activation_key_hash,max_candidates,issued_at,expires_at,features) VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10::jsonb)",
        [
          id,
          input.institutionId,
          input.institutionName,
          input.contactEmail || null,
          input.plan,
          hashKey(key),
          input.maxCandidates,
          issued,
          expiry,
          JSON.stringify(input.features),
        ],
      );
      await recordLicenseEvent(client, {
        licenseId: id,
        type: "LICENSE_ISSUED",
        actorEmail: req.admin.sub,
        metadata: { plan: input.plan, maxCandidates: input.maxCandidates, institutionId: input.institutionId },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      // Another administrator may have issued a licence after the pre-check.
      if (error?.code === "23505")
        return res.status(409).json({ message: "This institution already has a pending or active licence." });
      throw error;
    } finally {
      client.release();
    }
    res
      .status(201)
      .json({
        data: {
          id,
          institutionId: input.institutionId,
          institutionName: input.institutionName,
          plan: input.plan,
          maxCandidates: input.maxCandidates,
          expiresAt: expiry,
          activationKey: key,
        },
      });
  }),
);

app.post(
  "/api/admin/licenses/:id/renew",
  adminAuth,
  wrap(async (req, res) => {
    const parsed = renewSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid renewal details", errors: parsed.error.flatten() });
    const input = parsed.data;
    if (input.expiresAt && input.expiresAt < new Date().toISOString().slice(0, 10))
      return res.status(400).json({ message: "Expiry date must be today or later" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM licenses WHERE id=$1 FOR UPDATE", [req.params.id]);
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Licence not found" });
      }
      if (["REVOKED", "SUSPENDED"].includes(row.status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `A ${row.status.toLowerCase()} licence cannot be renewed` });
      }
      const activationKey = generateActivationKey();
      const expiry = input.expiresAt ? new Date(`${input.expiresAt}T23:59:59.999Z`) : null;
      const nextStatus = row.installation_id ? "ACTIVE" : "PENDING";
      const updated = await client.query(
        "UPDATE licenses SET plan=$1,status=$2,activation_key_hash=$3,max_candidates=$4,issued_at=CURRENT_TIMESTAMP,expires_at=$5,features=$6::jsonb,signed_license=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *",
        [input.plan, nextStatus, hashKey(activationKey), input.maxCandidates, expiry, JSON.stringify(input.features), row.id],
      );
      let signedLicense = null;
      if (row.installation_id) {
        signedLicense = buildLicense(updated.rows[0], row.installation_id, privateKey);
        await client.query("UPDATE licenses SET signed_license=$1::jsonb WHERE id=$2", [JSON.stringify(signedLicense), row.id]);
      }
      await recordLicenseEvent(client, {
        licenseId: row.id,
        type: "LICENSE_RENEWED",
        actorEmail: req.admin.sub,
        installationId: row.installation_id,
        metadata: { previousPlan: row.plan, plan: input.plan, previousExpiresAt: row.expires_at, expiresAt: expiry, maxCandidates: input.maxCandidates },
      });
      await client.query("COMMIT");
      res.json({ data: { id: row.id, plan: input.plan, status: nextStatus, expiresAt: expiry, activationKey, signedLicense } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/api/admin/licenses/:id/suspend",
  adminAuth,
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "UPDATE licenses SET status='SUSPENDED',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status IN ('PENDING','ACTIVE') RETURNING id,institution_id,installation_id",
        [req.params.id],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Only pending or active licences can be suspended" });
      }
      await recordLicenseEvent(client, {
        licenseId: rows[0].id,
        type: "LICENSE_SUSPENDED",
        actorEmail: req.admin.sub,
        installationId: rows[0].installation_id,
        metadata: { institutionId: rows[0].institution_id },
      });
      await client.query("COMMIT");
      res.json({ message: "Licence suspended. Online activation is blocked; offline installations are affected when they next check in." });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/api/admin/licenses/:id/resume",
  adminAuth,
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `UPDATE licenses SET status=CASE WHEN expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP THEN 'EXPIRED'
          WHEN installation_id IS NULL THEN 'PENDING' ELSE 'ACTIVE' END,updated_at=CURRENT_TIMESTAMP
         WHERE id=$1 AND status='SUSPENDED' RETURNING id,institution_id,installation_id,status`,
        [req.params.id],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "Licence is not suspended" });
      }
      await recordLicenseEvent(client, {
        licenseId: rows[0].id,
        type: "LICENSE_RESUMED",
        actorEmail: req.admin.sub,
        installationId: rows[0].installation_id,
        metadata: { institutionId: rows[0].institution_id, resultingStatus: rows[0].status },
      });
      await client.query("COMMIT");
      res.json({ message: rows[0].status === "EXPIRED" ? "Licence resumed as expired; renew it to restore service." : "Licence resumed.", status: rows[0].status });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/api/admin/licenses/:id/revoke",
  adminAuth,
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "UPDATE licenses SET status='REVOKED',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status <> 'REVOKED' RETURNING id,institution_id,installation_id",
        [req.params.id],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Licence not found or already revoked" });
      }
      await recordLicenseEvent(client, {
        licenseId: rows[0].id,
        type: "LICENSE_REVOKED",
        actorEmail: req.admin.sub,
        installationId: rows[0].installation_id,
        metadata: { institutionId: rows[0].institution_id },
      });
      await client.query("COMMIT");
      res.json({
        message:
          "Licence revoked. Offline installations learn about revocation only when they next check in.",
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.get(
  "/api/admin/audit",
  adminAuth,
  wrap(async (req, res) => {
    const requested = Number(req.query.limit || 100);
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 500) : 100;
    const { rows } = await pool.query(
      `SELECT id,license_id,event_type,actor_email,installation_id,metadata,created_at
       FROM license_events ORDER BY created_at DESC,id DESC LIMIT $1`,
      [limit],
    );
    res.json({ data: rows });
  }),
);

app.post(
  "/api/public/activate",
  loginLimiter,
  wrap(async (req, res) => {
    const parsed = activationSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: "Invalid activation request" });
    const { activationKey, installationId } = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM licenses WHERE activation_key_hash=$1 FOR UPDATE",
        [hashKey(activationKey)],
      );
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(401).json({ message: "Activation key is invalid" });
      }
      const failure = activationFailure(row, installationId);
      if (failure) {
        if (failure.expire) {
          await client.query("UPDATE licenses SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.id]);
          await recordLicenseEvent(client, {
            licenseId: row.id,
            type: "LICENSE_EXPIRED",
            installationId,
            metadata: { institutionId: row.institution_id, plan: row.plan },
          });
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
        return res.status(failure.status).json({ message: failure.message });
      }
      const signed = buildLicense(row, installationId, privateKey);
      await client.query(
        "UPDATE licenses SET status='ACTIVE',installation_id=$1,activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP),signed_license=$2::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$3",
        [installationId, JSON.stringify(signed), row.id],
      );
      await recordLicenseEvent(client, {
        licenseId: row.id,
        type: "LICENSE_ACTIVATED",
        installationId,
        metadata: { institutionId: row.institution_id, plan: row.plan },
      });
      await client.query("COMMIT");
      res.json({ data: signed, publicKey: process.env.LICENSE_PUBLIC_KEY_B64 });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/api/admin/licenses/:id/offline-issue",
  adminAuth,
  wrap(async (req, res) => {
    const installationId = String(req.body?.installationId || "").trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(installationId))
      return res
        .status(400)
        .json({ message: "A valid Installation ID is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT * FROM licenses WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      const row = rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Eligible licence not found" });
      }
      const failure = offlineIssueFailure(row, installationId);
      if (failure) {
        if (failure.expire) {
          await client.query("UPDATE licenses SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE id=$1", [row.id]);
          await recordLicenseEvent(client, {
            licenseId: row.id,
            type: "LICENSE_EXPIRED",
            actorEmail: req.admin.sub,
            installationId,
            metadata: { institutionId: row.institution_id, plan: row.plan },
          });
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
        return res.status(failure.status).json({ message: failure.message });
      }
      const signed = buildLicense(row, installationId, privateKey);
      await client.query(
        "UPDATE licenses SET status='ACTIVE',installation_id=$1,activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP),signed_license=$2::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$3",
        [installationId, JSON.stringify(signed), row.id],
      );
      await recordLicenseEvent(client, {
        licenseId: row.id,
        type: "LICENSE_OFFLINE_ISSUED",
        actorEmail: req.admin.sub,
        installationId,
        metadata: { institutionId: row.institution_id, plan: row.plan },
      });
      await client.query("COMMIT");
      res.json({ data: signed });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

app.use((err, _req, res, _next) => {
  console.error("Licensing request failed:", err?.message || "unknown error");
  res.status(500).json({ message: "Internal licensing service error" });
});

const port = Number(process.env.PORT || 8080);
const schemaPath = fileURLToPath(new URL("../schema.sql", import.meta.url));
let server;
try {
  await pool.query(await readFile(schemaPath, "utf8"));
  server = app.listen(port, process.env.HOST || "0.0.0.0");
  console.log(`CBT Licensing Service listening on ${port}`);
} catch (error) {
  console.error(
    "Licensing service database initialization failed:",
    error?.message || "unknown error",
  );
  server?.close();
  await pool.end();
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () =>
    server?.close(() => pool.end().finally(() => process.exit(0))),
  );
}
