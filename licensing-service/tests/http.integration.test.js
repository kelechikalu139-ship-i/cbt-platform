import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";
import jwt from "jsonwebtoken";

const { Pool } = pg;
const shouldRun = process.env.RUN_POSTGRES_TESTS === "true";
const serviceDirectory = fileURLToPath(new URL("../", import.meta.url));

async function reserveLocalPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(child, url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Licensing API exited before becoming ready");
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Licensing API did not become ready in time");
}

async function waitForExternalHealth(url) {
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), "integration tests only target loopback services");
  assert.equal(parsed.protocol, "http:", "integration test API must use local HTTP");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Configured local licensing API did not become ready");
}

test(
  "licensing HTTP activation is idempotent, installation-bound and rejects revoked keys",
  { skip: !shouldRun },
  async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      max: 2,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
    const institutionId = `http_test_${crypto.randomUUID().replaceAll("-", "_")}`;
    const installationId = crypto.randomUUID();
    let licenseId = null;
    const externalApiUrl = process.env.LICENSING_TEST_API_URL?.replace(/\/$/, "");
    let jwtSecret = process.env.JWT_SECRET;
    const adminEmail = `http-admin-${crypto.randomUUID()}@example.invalid`;
    const adminId = crypto.randomUUID();
    let apiUrl;
    let child = null;
    if (externalApiUrl) {
      apiUrl = externalApiUrl;
      await waitForExternalHealth(apiUrl);
    } else {
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const port = await reserveLocalPort();
      apiUrl = `http://127.0.0.1:${port}`;
      jwtSecret = crypto.randomBytes(32).toString("base64url");
      adminEmail = "integration@example.invalid";
      child = spawn(process.execPath, ["src/server.js"], {
        cwd: serviceDirectory,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(port),
          LICENSE_PRIVATE_KEY_B64: Buffer.from(privateKey).toString("base64"),
          LICENSE_PUBLIC_KEY_B64: Buffer.from(publicKey).toString("base64"),
          JWT_SECRET: jwtSecret,
          PORTAL_ORIGIN: "http://127.0.0.1:4173",
        },
      });
      await waitForHealth(child, apiUrl);
    }

    try {
      const { rows: databaseRows } = await pool.query("SELECT current_database() AS name");
      assert.equal(databaseRows[0].name, "cbt_licensing_platform", "tests must use the dedicated local licensing database");
      assert.ok(jwtSecret, "local administrator JWT configuration is required for lifecycle testing");
      await pool.query(
        "INSERT INTO licensing_admins (id,email,password_hash,role) VALUES ($1,$2,'unused-test-hash','SUPER_ADMIN')",
        [adminId, adminEmail],
      );
      const adminToken = jwt.sign(
        { sub: adminEmail, id: adminId, role: "SUPER_ADMIN" },
        jwtSecret,
        { expiresIn: "5m", issuer: "cbt-licensing", algorithm: "HS256" },
      );
      const adminHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      };

      const pastExpiry = await fetch(`${apiUrl}/api/admin/licenses`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          institutionName: "HTTP Integration Test Institution",
          institutionId,
          plan: "STANDARD",
          maxCandidates: 100,
          expiresAt: "2000-01-01",
          features: ["cbt"],
        }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(pastExpiry.status, 400, "the admin API must reject an already-expired issue date");

      const issued = await fetch(`${apiUrl}/api/admin/licenses`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          institutionName: "HTTP Integration Test Institution",
          institutionId,
          plan: "STANDARD",
          maxCandidates: 100,
          features: ["cbt"],
        }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(issued.status, 201);
      const issuedBody = await issued.json();
      licenseId = issuedBody.data.id;
      const activationKey = issuedBody.data.activationKey;
      assert.ok(activationKey);

      const activate = async (targetInstallationId) => fetch(`${apiUrl}/api/public/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activationKey, installationId: targetInstallationId }),
        signal: AbortSignal.timeout(5000),
      });

      const first = await activate(installationId);
      assert.equal(first.status, 200);
      const firstBody = await first.json();
      assert.equal(firstBody.data.payload.installationId, installationId);
      assert.equal(firstBody.data.algorithm, "Ed25519");

      const retry = await activate(installationId);
      assert.equal(retry.status, 200, "retry from the bound installation is idempotent");

      const { rows: auditRows } = await pool.query(
        "SELECT count(*)::int AS count FROM license_events WHERE license_id=$1 AND event_type='LICENSE_ACTIVATED'",
        [licenseId],
      );
      assert.equal(auditRows[0].count, 2, "each successful activation response is recorded without key material");

      const conflict = await activate(crypto.randomUUID());
      assert.equal(conflict.status, 409, "a different installation cannot take over the license");

      const revoke = await fetch(`${apiUrl}/api/admin/licenses/${licenseId}/revoke`, {
        method: "POST",
        headers: adminHeaders,
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(revoke.status, 200);
      const revoked = await activate(installationId);
      assert.equal(revoked.status, 403, "a revoked key cannot activate");

      const audit = await fetch(`${apiUrl}/api/admin/audit?limit=500`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(audit.status, 200);
      const auditBody = await audit.json();
      const licenseEvents = auditBody.data.filter((event) => event.license_id === licenseId);
      assert.deepEqual(
        licenseEvents.map((event) => event.event_type).sort(),
        ["LICENSE_ACTIVATED", "LICENSE_ACTIVATED", "LICENSE_ISSUED", "LICENSE_REVOKED"],
      );
      assert.equal(JSON.stringify(licenseEvents).includes(activationKey), false, "audit records must not contain activation keys");
    } finally {
      if (child) {
        child.kill();
        await new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          const timeout = setTimeout(resolve, 3000);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      if (licenseId) {
        await pool.query("DELETE FROM license_events WHERE license_id=$1", [licenseId]).catch(() => {});
        await pool.query("DELETE FROM licenses WHERE id=$1", [licenseId]).catch(() => {});
      }
      await pool.query("DELETE FROM licensing_admins WHERE id=$1", [adminId]).catch(() => {});
      await pool.end();
    }
  },
);
