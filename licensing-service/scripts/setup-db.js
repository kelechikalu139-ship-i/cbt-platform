import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const expectedDatabase = process.env.EXPECTED_DATABASE_NAME || "cbt_licensing_platform";
function safeErrorCode(error) {
  if (error?.code) return error.code;
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("password authentication failed")) return "AUTH_FAILED";
  if (message.includes("role") && message.includes("does not exist")) return "ROLE_MISSING";
  if (message.includes("database") && message.includes("does not exist")) return "DATABASE_MISSING";
  if (message.includes("certificate") || message.includes("ssl")) return "TLS_ERROR";
  if (message.includes("timeout")) return "TIMEOUT";
  return "UNKNOWN";
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured");
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    max: 1,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
  });

  try {
    const { rows } = await pool.query("SELECT current_database() AS database");
    if (rows[0].database !== expectedDatabase) {
      throw new Error(`Refusing schema setup outside ${expectedDatabase}`);
    }
    const schema = await readFile(
      fileURLToPath(new URL("../schema.sql", import.meta.url)),
      "utf8",
    );
    await pool.query(schema);
    console.log(`Licensing schema is ready in ${expectedDatabase}.`);
  } catch (error) {
    console.error(
      JSON.stringify({
        setup: "failed",
        code: safeErrorCode(error),
        message: error?.message?.startsWith("Refusing schema setup")
          ? error.message
          : "Database setup failed; connection details are suppressed.",
      }),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
