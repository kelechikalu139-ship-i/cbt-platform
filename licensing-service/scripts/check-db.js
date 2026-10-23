import "dotenv/config";
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
    const { rows } = await pool.query(
      "SELECT current_database() AS database, current_setting('server_version_num') AS version",
    );
    const database = rows[0].database;
    const metadata = await pool.query(
      `SELECT to_regclass('public.licenses') AS licenses_table,
        to_regclass('public.license_events') AS license_events_table,
        to_regclass('public.licensing_admins') AS licensing_admins_table,
        to_regclass('public.licensing_admin_invitations') AS admin_invitations_table,
        to_regclass('public.licensing_admin_bootstrap') AS admin_bootstrap_table,
        EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
          AND indexname='uq_licenses_one_open_per_institution') AS open_license_index`,
    );
    const schemaReady = Boolean(
      metadata.rows[0].licenses_table && metadata.rows[0].license_events_table &&
      metadata.rows[0].licensing_admins_table && metadata.rows[0].admin_invitations_table &&
      metadata.rows[0].admin_bootstrap_table &&
      metadata.rows[0].open_license_index,
    );
    console.log(
      JSON.stringify({
        connected: true,
        database,
        expectedDatabase: database === expectedDatabase,
        postgresVersion: rows[0].version,
        licensesTable: metadata.rows[0].licenses_table,
        licenseEventsTable: metadata.rows[0].license_events_table,
        licensingAdminsTable: metadata.rows[0].licensing_admins_table,
        adminInvitationsTable: metadata.rows[0].admin_invitations_table,
        adminBootstrapTable: metadata.rows[0].admin_bootstrap_table,
        openLicenseUniqueIndex: metadata.rows[0].open_license_index,
        schemaReady,
      }),
    );
    if (database !== expectedDatabase) process.exitCode = 2;
    if (!schemaReady) process.exitCode = 3;
  } catch (error) {
    let target = { configuredDatabase: null, hostLooksLocal: null, sslMode: null, pgSslEnabled: process.env.PGSSL === "true" };
    try {
      const connection = new URL(process.env.DATABASE_URL);
      target = {
        configuredDatabase: decodeURIComponent(connection.pathname.replace(/^\//, "")),
        hostLooksLocal: ["localhost", "127.0.0.1", "::1"].includes(connection.hostname),
        sslMode: connection.searchParams.get("sslmode"),
        pgSslEnabled: process.env.PGSSL === "true",
      };
    } catch {
      // Keep malformed URLs and credentials out of diagnostics.
    }
    console.error(
      JSON.stringify({
        connected: false,
        code: safeErrorCode(error),
        ...target,
        message: "Database probe failed; connection details are suppressed.",
      }),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
