import "dotenv/config";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
if (process.env.NODE_ENV !== "development") throw new Error("MFA reset helper is available only in local development");
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "") !== "cbt_licensing_platform")
  throw new Error("Refusing MFA reset outside cbt_licensing_platform");
const email = process.env.LICENSE_ADMIN_EMAIL?.trim().toLowerCase();
if (!email) throw new Error("Set LICENSE_ADMIN_EMAIL to the account that needs MFA reset");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined });
try {
  const { rows } = await pool.query(
    `UPDATE licensing_admins SET mfa_enabled=FALSE,mfa_secret_enc=NULL,mfa_pending_secret_enc=NULL,
      mfa_enabled_at=NULL,mfa_last_used_step=0,mfa_recovery_codes='[]'::jsonb,updated_at=CURRENT_TIMESTAMP
     WHERE email=$1 AND role='SUPER_ADMIN' AND status='ACTIVE' RETURNING id,email`,
    [email],
  );
  if (!rows.length) throw new Error("No active super-admin matches LICENSE_ADMIN_EMAIL");
  await pool.query(
    "INSERT INTO license_events (id,event_type,actor_email,metadata) VALUES ($1,'ADMIN_MFA_RESET',$2,$3::jsonb)",
    [crypto.randomUUID(), email, JSON.stringify({ reason: "local development recovery" })],
  );
  console.log("MFA reset for the configured local super-admin. The next sign-in will require MFA enrollment again.");
} finally {
  await pool.end();
}
