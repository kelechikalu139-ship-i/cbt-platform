import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildLicense, generateActivationKey } from "../src/license-service.js";

test("both products use the established CBT activation-key format", () => {
  assert.match(generateActivationKey(), /^NCBT-(?:[A-F0-9]{5}-){7}[A-F0-9]{5}$/);
  assert.match(generateActivationKey("caosce-platform"), /^NCBT-(?:[A-F0-9]{5}-){7}[A-F0-9]{5}$/);
  assert.throws(() => generateActivationKey("unknown-product"), /Unsupported licence product/);
});

test("signed license payload uses the stored product, defaulting legacy rows to CBT", () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const baseRow = {
    id: "license-id",
    institution_id: "institution-id",
    institution_name: "Test Institution",
    plan: "PROFESSIONAL",
    max_candidates: 100,
    issued_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    features: ["results"],
  };

  assert.equal(buildLicense({ ...baseRow, product: "caosce-platform" }, "installation-id", privateKey).payload.product, "caosce-platform");
  assert.equal(buildLicense(baseRow, "installation-id", privateKey).payload.product, "nurse-cbt");
});
