import "dotenv/config";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const email = process.env.LICENSE_ADMIN_EMAIL?.trim().toLowerCase();
const portalOrigin = process.env.PORTAL_ORIGIN;
if (!email || !portalOrigin || !process.env.DATABASE_URL) {
  console.error("Set LICENSE_ADMIN_EMAIL, PORTAL_ORIGIN, and DATABASE_URL before creating the one-time setup link.");
  process.exitCode = 1;
} else {
  let setupUrl;
  try {
    const origin = new URL(portalOrigin);
    if (!(["http:", "https:"].includes(origin.protocol)) || origin.pathname !== "/" || origin.search || origin.hash)
      throw new Error("PORTAL_ORIGIN must be an HTTP(S) origin without a path, query, or fragment");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
    try {
      await pool.query("SELECT pg_advisory_lock(hashtext('licensing-super-admin-bootstrap'))");
      const admins = await pool.query("SELECT count(*)::int AS count FROM licensing_admins");
      if (admins.rows[0].count > 0) {
        console.log("Bootstrap closed: an administrator account already exists. Use the portal invitation flow for additional accounts.");
      } else {
        const token = crypto.randomBytes(32).toString("base64url");
        await pool.query(
          `INSERT INTO licensing_admin_bootstrap (id,email,token_hash,expires_at,used_at,created_at)
           VALUES (1,$1,$2,CURRENT_TIMESTAMP + INTERVAL '30 minutes',NULL,CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,token_hash=EXCLUDED.token_hash,
             expires_at=EXCLUDED.expires_at,used_at=NULL,created_at=CURRENT_TIMESTAMP`,
          [email, crypto.createHash("sha256").update(token).digest("hex")],
        );
        origin.searchParams.set("setup", token);
        setupUrl = origin.toString();
      }
      await pool.query("SELECT pg_advisory_unlock(hashtext('licensing-super-admin-bootstrap'))");
    } finally {
      await pool.end();
    }
    if (setupUrl) {
      console.log("One-time super-admin registration link (valid for 30 minutes; treat as a secret):");
      console.log(setupUrl);
    }
  } catch (error) {
    console.error(error?.message?.includes("PORTAL_ORIGIN must") ? error.message : "Could not create the one-time bootstrap link; check the schema and database connection.");
    process.exitCode = 1;
  }
}
