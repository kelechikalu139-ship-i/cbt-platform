import "dotenv/config";
import { spawnSync } from "node:child_process";

const expectedDatabase = "cbt_licensing_platform";
let databaseUrl;
try {
  databaseUrl = new URL(process.env.DATABASE_URL || "");
} catch {
  console.error("Set DATABASE_URL to the dedicated local licensing test database.");
  process.exit(1);
}

if (
  !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== `/${expectedDatabase}`
) {
  console.error(`Refusing integration tests unless DATABASE_URL targets local ${expectedDatabase}.`);
  process.exit(1);
}

const env = {
  ...process.env,
  EXPECTED_DATABASE_NAME: expectedDatabase,
  PGSSL: "false",
  RUN_POSTGRES_TESTS: "true",
};
delete env.LICENSING_TEST_API_URL;

function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) {
    console.error(`Failed to run ${args.join(" ")}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const schemaSetupStatus = run(["scripts/setup-db.js"]);
if (schemaSetupStatus !== 0) process.exit(schemaSetupStatus);
process.exit(run(["--test"]));
