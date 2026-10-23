import "dotenv/config";
import crypto from "node:crypto";
import readline from "node:readline";
import bcrypt from "bcrypt";
import pg from "pg";

const { Pool } = pg;
const email = process.env.LICENSE_ADMIN_EMAIL?.trim().toLowerCase();

async function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function")
    throw new Error("Run this command in an interactive terminal so the password can be entered without echo.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  readline.emitKeypressEvents(process.stdin);
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      error ? reject(error) : resolve(value);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && key.name === "c") return finish(new Error("Recovery cancelled"));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") value = value.slice(0, -1);
      else if (!key.ctrl && !key.meta && character) value += character;
    };
    process.stdin.on("keypress", onKeypress);
  });
}

if (!email || !process.env.DATABASE_URL) {
  console.error("Set LICENSE_ADMIN_EMAIL and DATABASE_URL before recovering the super-admin account.");
  process.exitCode = 1;
} else {
  let passwordHash;
  try {
    const password = await readHidden("New super-admin password (minimum 12 characters): ");
    if (password.length < 12) throw new Error("Password must contain at least 12 characters");
    const confirmation = await readHidden("Confirm new password: ");
    if (password !== confirmation) throw new Error("Passwords do not match");
    passwordHash = await bcrypt.hash(password, 12);
  } catch (error) {
    console.error(error?.message || "Could not read new password");
    process.exitCode = 1;
  }

  if (!process.exitCode) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const db = await client.query("SELECT current_database() AS name");
      if (db.rows[0].name !== "cbt_licensing_platform") throw new Error("Refusing recovery outside cbt_licensing_platform");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('licensing-super-admin-bootstrap'))");
      const { rows } = await client.query("SELECT id,email,status FROM licensing_admins WHERE role='SUPER_ADMIN' FOR UPDATE");
      if (rows.length !== 1 || rows[0].status !== "ACTIVE") throw new Error("Recovery requires exactly one active super-admin account");
      const duplicate = await client.query("SELECT 1 FROM licensing_admins WHERE email=$1 AND id<>$2", [email, rows[0].id]);
      if (duplicate.rowCount) throw new Error("The configured email already belongs to another administrator");
      await client.query("UPDATE licensing_admins SET email=$1,password_hash=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3", [email, passwordHash, rows[0].id]);
      await client.query(
        "INSERT INTO license_events (id,event_type,actor_email,metadata) VALUES ($1,'SUPER_ADMIN_RECOVERED',$2,$3::jsonb)",
        [crypto.randomUUID(), email, JSON.stringify({ emailChanged: rows[0].email !== email })],
      );
      await client.query("COMMIT");
      console.log("The existing super-admin account was recovered. Sign in with LICENSE_ADMIN_EMAIL and the new password.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(error?.message?.startsWith("Refusing recovery") || error?.message?.startsWith("Recovery requires") || error?.message?.startsWith("The configured email")
        ? error.message
        : "Super-admin recovery failed; database changes were rolled back.");
      process.exitCode = 1;
    } finally {
      client.release();
      await pool.end();
    }
  }
}
