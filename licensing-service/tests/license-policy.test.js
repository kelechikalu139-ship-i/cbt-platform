import test from "node:test";
import assert from "node:assert/strict";
import { activationFailure, offlineIssueFailure } from "../src/license-policy.js";

const now = Date.parse("2026-10-22T12:00:00.000Z");
const active = {
  status: "ACTIVE",
  installation_id: "installation-123",
  expires_at: "2026-10-23T00:00:00.000Z",
};

test("activation permits the bound installation before expiry", () => {
  assert.equal(activationFailure(active, active.installation_id, now), null);
});

test("activation rejects a different installation", () => {
  assert.equal(activationFailure(active, "another-installation", now).status, 409);
});

test("activation expires a licence exactly at its expiry instant", () => {
  const failure = activationFailure(
    { ...active, expires_at: new Date(now).toISOString() },
    active.installation_id,
    now,
  );
  assert.deepEqual(failure, { status: 403, message: "Licence has expired", expire: true });
});

test("activation rejects terminal lifecycle states", () => {
  for (const status of ["REVOKED", "EXPIRED", "SUSPENDED"]) {
    assert.equal(activationFailure({ ...active, status }, active.installation_id, now).status, 403);
  }
});

test("offline issue applies the same binding and expiry rules", () => {
  assert.equal(offlineIssueFailure(active, active.installation_id, now), null);
  assert.equal(offlineIssueFailure(active, "another-installation", now).status, 409);
  const expired = offlineIssueFailure(
    { ...active, expires_at: new Date(now - 1).toISOString() },
    active.installation_id,
    now,
  );
  assert.equal(expired.expire, true);
});

test("offline issue refuses revoked licences", () => {
  assert.equal(offlineIssueFailure({ ...active, status: "REVOKED" }, active.installation_id, now).status, 404);
});

test("offline issue marks an expired licence expired before checking installation binding", () => {
  const failure = offlineIssueFailure(
    { ...active, expires_at: new Date(now - 1).toISOString() },
    "another-installation",
    now,
  );
  assert.equal(failure.status, 403);
  assert.equal(failure.expire, true);
});
