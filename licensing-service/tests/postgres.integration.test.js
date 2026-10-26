import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const shouldRun = process.env.RUN_POSTGRES_TESTS === "true";

test(
  "PostgreSQL schema enforces open-license uniqueness and serializes activation binding",
  { skip: !shouldRun },
  async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      max: 3,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
    const institutionId = `integration_${crypto.randomUUID().replaceAll("-", "_")}`;
    const installationA = crypto.randomUUID();
    const installationB = crypto.randomUUID();
    const keyHash = (value) => crypto.createHash("sha256").update(value).digest("hex");
    let first;
    let second;

    try {
      const { rows: dbRows } = await pool.query("SELECT current_database() AS name");
      assert.equal(dbRows[0].name, "cbt_licensing_platform", "tests must use the dedicated local licensing database");

      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO licenses
          (id,institution_id,institution_name,plan,status,activation_key_hash,max_candidates,issued_at,features)
         VALUES ($1,$2,'Integration Test Institution','STANDARD','PENDING',$3,100,CURRENT_TIMESTAMP,'["cbt"]'::jsonb)`,
        [id, institutionId, keyHash(crypto.randomUUID())],
      );

      await assert.rejects(
        pool.query(
          `INSERT INTO licenses
            (id,institution_id,institution_name,plan,status,activation_key_hash,max_candidates,issued_at,features)
           VALUES ($1,$2,'Duplicate Integration Institution','STANDARD','PENDING',$3,100,CURRENT_TIMESTAMP,'["cbt"]'::jsonb)`,
          [crypto.randomUUID(), institutionId, keyHash(crypto.randomUUID())],
        ),
        (error) => error.code === "23505",
        "a second open license for the same institution must violate the partial unique index",
      );

      first = await pool.connect();
      second = await pool.connect();
      await first.query("BEGIN");
      const { rows: lockedRows } = await first.query("SELECT * FROM licenses WHERE id=$1 FOR UPDATE", [id]);
      assert.equal(lockedRows[0].installation_id, null);

      await second.query("BEGIN");
      let secondReadFinished = false;
      const secondRead = second
        .query("SELECT * FROM licenses WHERE id=$1 FOR UPDATE", [id])
        .then((result) => {
          secondReadFinished = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(secondReadFinished, false, "a competing activation must wait for the first row lock");

      await first.query(
        "UPDATE licenses SET status='ACTIVE',installation_id=$1,activated_at=CURRENT_TIMESTAMP WHERE id=$2",
        [installationA, id],
      );
      await first.query("COMMIT");

      const { rows: secondRows } = await secondRead;
      assert.equal(secondRows[0].installation_id, installationA);
      assert.notEqual(secondRows[0].installation_id, installationB);
      await second.query("ROLLBACK");
    } finally {
      if (first) {
        await first.query("ROLLBACK").catch(() => {});
        first.release();
      }
      if (second) {
        await second.query("ROLLBACK").catch(() => {});
        second.release();
      }
      await pool.query("DELETE FROM licenses WHERE institution_id=$1", [institutionId]).catch(() => {});
      await pool.end();
    }
  },
);
