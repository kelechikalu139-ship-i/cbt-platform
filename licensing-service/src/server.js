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

const { Pool } = pg;
const required = [
  "DATABASE_URL",
  "LICENSE_ADMIN_EMAIL",
  "LICENSE_ADMIN_PASSWORD_HASH",
  "JWT_SECRET",
  "LICENSE_PRIVATE_KEY_B64",
  "LICENSE_PUBLIC_KEY_B64",
  "PORTAL_ORIGIN",
];
for (const key of required)
  if (!process.env[key])
    throw new Error(`Missing required environment variable: ${key}`);
if (process.env.JWT_SECRET.length < 32)
  throw new Error("JWT_SECRET must be at least 32 characters");

const privateKey = crypto.createPrivateKey(
  Buffer.from(process.env.LICENSE_PRIVATE_KEY_B64, "base64").toString("utf8"),
);
const publicKey = crypto.createPublicKey(
  Buffer.from(process.env.LICENSE_PUBLIC_KEY_B64, "base64").toString("utf8"),
);
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
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

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

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "";
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "cbt-licensing",
      algorithms: ["HS256"],
    });
    if (claims.role !== "LICENSING_ADMIN") throw new Error("Invalid role");
    req.admin = claims;
    next();
  } catch {
    res.status(401).json({ message: "Authentication required" });
  }
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
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const passwordOk = await bcrypt.compare(
      password,
      process.env.LICENSE_ADMIN_PASSWORD_HASH,
    );
    if (email !== process.env.LICENSE_ADMIN_EMAIL.toLowerCase() || !passwordOk)
      return res.status(401).json({ message: "Invalid credentials" });
    const token = jwt.sign(
      { sub: email, role: "LICENSING_ADMIN" },
      process.env.JWT_SECRET,
      { expiresIn: "30m", issuer: "cbt-licensing", algorithm: "HS256" },
    );
    res.json({
      token,
      expiresIn: 1800,
      user: { email, role: "LICENSING_ADMIN" },
    });
  }),
);

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
    const id = crypto.randomUUID();
    const key = generateActivationKey();
    const issued = new Date();
    const expiry = input.expiresAt
      ? new Date(`${input.expiresAt}T23:59:59.999Z`)
      : null;
    const { rows: existing } = await pool.query(
      "SELECT id FROM licenses WHERE institution_id=$1 AND status IN ('PENDING','ACTIVE') LIMIT 1",
      [input.institutionId],
    );
    if (existing.length)
      return res
        .status(409)
        .json({
          message: "This institution already has a pending or active licence.",
        });
    await pool.query(
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
  "/api/admin/licenses/:id/revoke",
  adminAuth,
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(
      "UPDATE licenses SET status='REVOKED',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status <> 'REVOKED'",
      [req.params.id],
    );
    if (!rowCount)
      return res
        .status(404)
        .json({ message: "Licence not found or already revoked" });
    res.json({
      message:
        "Licence revoked. Offline installations learn about revocation only when they next check in.",
    });
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
      if (["REVOKED", "EXPIRED", "SUSPENDED"].includes(row.status)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Licence is not active" });
      }
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        await client.query(
          "UPDATE licenses SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
          [row.id],
        );
        await client.query("COMMIT");
        return res.status(403).json({ message: "Licence has expired" });
      }
      if (row.installation_id && row.installation_id !== installationId) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({
            message:
              "Licence is bound to another installation; contact support for transfer",
          });
      }
      const signed = buildLicense(row, installationId, privateKey);
      await client.query(
        "UPDATE licenses SET status='ACTIVE',installation_id=$1,activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP),signed_license=$2::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$3",
        [installationId, JSON.stringify(signed), row.id],
      );
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
    const { rows } = await pool.query(
      "SELECT * FROM licenses WHERE id=$1 LIMIT 1",
      [req.params.id],
    );
    const row = rows[0];
    if (!row || ["REVOKED", "EXPIRED", "SUSPENDED"].includes(row.status))
      return res.status(404).json({ message: "Eligible licence not found" });
    if (row.installation_id && row.installation_id !== installationId)
      return res
        .status(409)
        .json({ message: "Licence is already bound to another installation" });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
      return res.status(403).json({ message: "Licence has expired" });
    const signed = buildLicense(row, installationId, privateKey);
    await pool.query(
      "UPDATE licenses SET status='ACTIVE',installation_id=$1,activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP),signed_license=$2::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$3",
      [installationId, JSON.stringify(signed), row.id],
    );
    res.json({ data: signed });
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
