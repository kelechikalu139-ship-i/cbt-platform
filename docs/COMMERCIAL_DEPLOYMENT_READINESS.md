# Commercial deployment readiness audit

Audit date: 22 October 2026. Scope: tracked repository contents and checks run in this workspace. This is an implementation audit, not a customer deployment certification.

## Readiness decision

**Not ready for a first commercial installation.** The local CBT is a substantial application, but there is no Windows installer/service setup, and its authentication/API compatibility and operational recovery still need release validation. The hosted licensing service previously used MySQL and could not run against the specified PostgreSQL target. Its database layer has now been switched to PostgreSQL, but a live PostgreSQL integration test and production deployment have not been run.

The repository has three separate frontends/services: `apps/web`, `apps/admin`, `server` for the school installation, and `licensing-portal` / `licensing-service` for central licensing. The school Prisma schema is MariaDB/MySQL and must remain so. Licensing tables are separate and PostgreSQL-only.

## Prioritized blockers

| Priority | Finding and repository evidence | Release gate |
|---|---|---|
| Critical | No Windows installer, service registration, LAN/firewall setup, upgrade guard, uninstall flow, or customer installation guide exists. The only Compose file is development MariaDB. | Build and test a non-Docker Windows installer on clean and upgrade Windows VMs. |
| Critical | Licensing previously used `mysql2`, MySQL `?` parameters, `ENUM`, `DATETIME`, and MySQL DDL. It now uses `pg`, PostgreSQL SQL and a separate `licensing-service/schema.sql`; activation is row-locked and idempotently bound. No PostgreSQL instance was available to validate it. | Install/lock dependencies, run PostgreSQL integration tests, test Render connection/pooling/migrations. |
| High | The license service has one administrator from environment variables, no admin lifecycle/roles/MFA, no billing/payment reconciliation, no event history, no renew/suspend/transfer workflow, and `max_candidates` only becomes a signed claim. | Implement and test required business/admin workflows before sale. |
| High | Central activation binds a license to the submitted installation ID but does not require proof of possession from the local server. The UUID is server-generated locally but can be copied with the database/configuration. | Add a server-held key challenge/proof protocol and define transfer/reinstall recovery; do not claim cloning resistance. |
| High | The school server now has online activation and offline signed-file import in Settings, Ed25519 verification, MariaDB persistence, and a production gate that prevents starting new attempts without a valid license. Answer saving/submission for an already-started exam remain available after expiry. There is no offline grace, automated revocation check or admin transfer workflow. | Test live/air-gapped activation and exam-flow recovery; implement signed refresh/revocation and transfer policy. |
| High | CBT license state is local MariaDB state while issuance remains central PostgreSQL. This branch connects activation but does not yet synchronize renewals, revocations or transfers. | Keep providers separate; add a tested refresh and transfer protocol. |
| High | `server/src/services/backup.service.ts` makes logical JSON backups and supports destructive replacement restore, but no backup test proves a restore. Backups have no encryption or integrity signature, and the routine restore suspends foreign-key checking. | Test verified restore on a disposable MariaDB instance; protect storage, define retention, encryption and operator approval. |
| High | Root and server docs expose development seed passwords, and `server/src/config/env.ts` defaults seed credentials. The Prisma seed itself rejects production, but installers must never deploy a dev seed or use the examples as production credentials. | First-run secure administrator provisioning and production secret scan/release check. |
| Medium | `licensing-portal` uses an in-memory token and has no activation/renewal/recovery views. Its deployment requires a build-time `VITE_LICENSING_API_URL`. | Browser-level deployment checks against the real API origin. |
| Medium | Seven unit tests now cover local license signature verification. `server/README.md` still contains stale claims that system/settings endpoints do not exist. No licensing-service/PostgreSQL integration tests, Windows installer tests, MariaDB restore tests, or load tests for simultaneous candidates are present. | Reconcile the server guide and add release-gate suites with reproducible test databases and Windows runners. |

## Repository evidence by capability

- **Local data and exams:** `server/prisma/schema.prisma` uses `provider = "mysql"`; `server/src/config/database.ts` constructs `PrismaMariaDb`. Schema includes users/roles/permissions, students, question bank, exams, exam sessions, answers, results, audit logs, and a local license model. Migrations include academic-session/class fields and the signed-license cache change.
- **Authentication/security foundation:** server code uses bcrypt, short-lived access tokens, refresh-token rotation, database-backed permissions, Zod request validation, Helmet, CORS allow-list, rate limiting, and Pino logging. Existing tests cover auth, RBAC, validation, tokens, pagination, autosubmit, and system routes. These do not establish commercial security without production configuration and full deployment testing.
- **Exam integrity foundation:** the schema and `server/src/modules/exams` plus `server/src/services/auto-submit.service.ts` implement server-owned expiry, stored question order, answer persistence and scheduled auto-submit. Concurrent-load and server-restart behavior still need explicit integration evidence.
- **Central licensing:** `licensing-service/src/server.js` now uses PostgreSQL `pg`, explicit HS256 JWT verification, Ed25519 key-pair consistency validation, readiness health checks, and transactional activation. `licensing-service/schema.sql` is independent of the MariaDB Prisma schema. The portal supports basic admin login, issue, list and revoke only.
- **Local license flow:** the school Settings screen submits activation keys to the configured central API or imports an offline signed file. The CBT server verifies Ed25519 claims using only its public key, binds them to a persisted server-generated installation ID, stores signed claims and a digest (not the raw key), and audits activation/import. Production configuration requires a real public key and API URL. New exam attempts are license-gated; an active attempt can still save and submit.
- **Deployment artifacts:** `docker-compose.yml` runs only MariaDB for development, loopback-bound. There is no Render blueprint, Docker production deployment, Windows service wrapper, installer, or backup/restore operator script.
- **Secrets:** tracked `.env.example` files use placeholders and contain no real credentials found during this review. Several examples/documentation mention development credentials; production must use generated secrets and a separately bootstrapped administrator.

## Features that can wait until a later release

After the critical installation, licensing, security and recovery gates pass, the following can be staged according to the first customer's contract: additional exam formats such as OSCE/VIVA, central licensing analytics beyond operational audit events, automated payment-provider reconciliation (if invoices are handled manually at launch), and multi-region/high-availability licensing deployment. These are not implemented release commitments; do not sell them as available functionality.

## Security findings

| Severity | Finding | Remediation/status |
|---|---|---|
| Critical | Licensing could not connect to PostgreSQL due to MySQL driver and SQL dialect. | Fixed in this branch at `licensing-service/package.json`, `src/server.js`, `schema.sql`; runtime verification remains outstanding. |
| High | License activation races could bind the same license concurrently without a row lock. | Fixed with PostgreSQL transaction + `SELECT ... FOR UPDATE`; concurrent test remains outstanding. |
| High | Licensing signing key pair could be mismatched, yielding unverifiable signed licenses. | Startup now derives and compares Ed25519 public key; not tested with production secrets. |
| High | Central signer and local verifier initially serialized signed claims in different property orders. | Fixed with canonical signing and legacy-order verification; cross-service signer/verifier unit test passes. |
| High | Licensing service supports only a single env-configured admin and lacks event audit/MFA or admin provisioning. | Open blocker. Protect access at hosting layer until implemented. |
| High | Local licensing is now enforced for starting new attempts and offline-issued signed files can be imported. Central revocation is learned only by reactivation and there is no configurable offline grace or transfer policy. | Partial implementation; do not claim revocation or grace behavior. |
| High | Backup data is plaintext JSON, and restore replaces all tables. | Restrict NTFS access and store off-host; add encryption/checksum and tested restore before production. |
| Medium | Licensing rate limiter is process-local; horizontal instances do not share counters. | Use a shared store before scaling beyond one API instance; test proxy/IP behavior on Render. |
| Medium | Licensing/admin and local CBT documentation still contains development credentials and conflicting historical instructions. | Use safe environment templates and reconcile docs before customer handoff. |

## Database migration and rollback plan

### School CBT (MariaDB)

1. Stop the CBT service and prevent new sessions; allow an active examination to finish or formally close it.
2. Make and verify a full MariaDB backup using the site's database backup tooling. Copy it to protected off-host storage.
3. Record the installed application version and migration table state. Build from the target release and inspect the SQL under `server/prisma/migrations`.
4. Apply only forward migrations with `npm run prisma:deploy --workspace=server`; do not use `prisma reset` in production.
5. Start the API and verify `/api/v1/health`, login, a read-only exam query and a controlled test exam before reopening access.
6. If the release fails, stop the service, preserve logs, restore the pre-upgrade database backup to a clean MariaDB database, and reinstall the previous application build. Prisma migrations are not assumed reversible; never manually delete migration records.

Migration `server/prisma/migrations/20261022180000_add_signed_local_license` makes `licenseKey` nullable, adds signed-license and validation fields, and adds the local `SUSPENDED` status. It preserves existing rows. Rollback must restore a pre-migration backup before applying the old application: activation can create rows with a null legacy `licenseKey`, so simply making that column non-null can fail. This procedure is documented, not yet exercised as an upgrade/rollback test. Keep the CBT database MariaDB.

### Central licensing (PostgreSQL)

The new `licensing-service/schema.sql` is a fresh PostgreSQL schema and uses idempotent `CREATE TABLE/INDEX IF NOT EXISTS`. It is applied at service startup before listening. There is no production migration runner or proven conversion from an earlier MySQL licensing database. For an existing deployment, freeze issuance/activation, take and verify a database backup, map rows into PostgreSQL with a reviewed one-off migration, compare counts and key hashes, and retain the old database read-only until the new API passes acceptance. Roll back by routing traffic back to the preserved service/database; do not reverse-convert data in place. Signing keys must remain the same during migration or all existing signatures need an explicit key-rotation migration.

## Windows installation and upgrade guide (design status)

**No installable package currently exists; these are prerequisites for the future installer, not an instruction to install the current repository directly on a customer server.** Docker and developer tools are not an acceptable customer requirement.

The release package must bundle/pin a supported Node runtime, built admin/student assets, API, and a maintained Windows service wrapper; provision local MariaDB bound to loopback; store configuration and secrets under an ACL-restricted ProgramData directory; migrate before the API service starts; and open only the required CBT web/API LAN port in Windows Firewall. The installer must generate unique secrets and installation ID, ask for an approved LAN hostname/address, create an initial administrator securely, and run health checks. It must detect an existing version and take a verified backup before any upgrade. Uninstall must stop services and remove program files while retaining database and backups unless an operator separately chooses a documented data purge.

Before release, provide school ICT staff a signed installer, checksum, prerequisites, clean-install steps, LAN client check, update/rollback steps, backup location, restore rehearsal, logs/diagnostics location and uninstall/data-retention steps. Do not expose MariaDB port 3306 to the LAN.

## Local license activation workflow (implemented path, not yet rehearsed)

For online activation, an authorized school administrator opens Settings, copies the installation ID for support records, enters the activation key, and submits it. The local API contacts `LICENSING_API_URL`, verifies the returned signature against `LICENSE_PUBLIC_KEY_B64`, and stores the signed license in MariaDB. The activation key is not stored; only its digest is retained. For an air-gapped school, the licensing administrator uses the central portal's offline-issue workflow with the installation ID, securely transfers the resulting signed JSON file, and the school administrator imports that file in Settings. The local server verifies signature, product, expiry, claims and installation binding before persistence.

The offline path does not need a connection during exam delivery, but no grace after signed expiry is provided. A lost/reinstalled server requires a centrally authorized transfer; that workflow is not implemented. A copied installation ID is not strong proof that the caller controls the original server, so proof-of-possession remains a release blocker.

## Render deployment guide (not yet deployed)

1. Provision a managed PostgreSQL database and a Node web service from `licensing-service/` in the selected Git repository. Set build/install to `npm install`; start to `npm start`; use the health path `/health`.
2. Set `DATABASE_URL` to the provider's internal PostgreSQL connection URL, `PGSSL=true` when required by the provider, and `DB_POOL_SIZE` within the database connection budget. Service runs schema initialization before listening.
3. Set `PORTAL_ORIGIN` to the exact HTTPS static-site origin. Inject `LICENSE_ADMIN_EMAIL`, a bcrypt `LICENSE_ADMIN_PASSWORD_HASH`, a generated 32+ character `JWT_SECRET`, and matching Ed25519 private/public keys as protected service secrets. Do not place the private key in the portal or school server.
4. Build `licensing-portal/` as a separate static site using `npm install && npm run build`; publish `dist`. Set build-time `VITE_LICENSING_API_URL` to the API service's HTTPS origin, without a trailing path prefix.
5. Deploy the API, wait for `/health` to return `{"status":"ok","database":"connected"}`, then build/deploy the portal and test an admin login, issue, activation, revoke, invalid signature and expired license against a disposable database.
6. Confirm logs contain no secrets, PostgreSQL access is limited to the service, backups are enabled at the provider, CORS rejects a different origin, and the signing key backup/rotation procedure is recorded.

Deployment has **not** succeeded or been tested against Render. A production administrator bootstrap UI, audit history, payment reconciliation and license renewal/transfer workflows are still absent.

## Backup and restore guide (current limits)

The CBT backup implementation writes a folder containing `backup.json` and `manifest.json`. When enabled in system settings, the server makes an immediate backup and repeats at the configured interval; default retention logic is 30 days, but scheduled pruning is not wired into the scheduler. Files are unencrypted and the service's `restoreBackup` replaces every table. No restore test was found or run. Treat backups as sensitive student/exam records, place the directory on an ACL-restricted volume and copy it off-host using an approved encrypted backup process. Before an upgrade, stop writes and take an independent verified backup. A restore rehearsal must use a disposable database, validate manifest/counts, run integrity checks, and confirm logins, exam records and results before signing off.

The licensing database is central PostgreSQL and must have separate provider backups and restore tests. CBT student/exam data remains local; licensing institution, license, activation and key metadata belongs in the central service. Never merge the backup sets.

## Environment variable reference

| Component | Variables | Safe example/notes |
|---|---|---|
| CBT API | `NODE_ENV`, `PORT`, `HOST`, `DATABASE_URL`, `DATABASE_POOL_SIZE`, `DATABASE_CONNECT_TIMEOUT_MS`, `LICENSING_API_URL`, `LICENSE_PUBLIC_KEY_B64` | `NODE_ENV=production`, `PORT=5000`, `HOST=0.0.0.0`, `DATABASE_URL=mysql://cbt:REDACTED@127.0.0.1:3306/cbt_system`; set the actual central HTTPS origin and base64 PEM Ed25519 public key. Never configure the private signing key locally. |
| CBT auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `BCRYPT_SALT_ROUNDS` | Generate separate random 48-byte secrets; examples are placeholders only. |
| CBT browser/security | `CORS_ORIGIN`, `LOG_LEVEL`, `LOG_PRETTY`, `UPLOAD_DIR`, `MAX_UPLOAD_SIZE_MB`, `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX`, `GLOBAL_RATE_LIMIT_WINDOW_MS`, `GLOBAL_RATE_LIMIT_MAX` | Exact school origins; production JSON logs; restricted upload/backup paths. |
| CBT seed | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME`, `SEED_STUDENT_PASSWORD` | Development only; seed script refuses production. Omit from customer runtime. |
| Licensing API | `NODE_ENV`, `PORT`, `HOST`, `DATABASE_URL`, `DB_POOL_SIZE`, `PGSSL`, `LICENSE_ADMIN_EMAIL`, `LICENSE_ADMIN_PASSWORD_HASH`, `JWT_SECRET`, `LICENSE_PRIVATE_KEY_B64`, `LICENSE_PUBLIC_KEY_B64`, `PORTAL_ORIGIN` | See `licensing-service/.env.example`; PostgreSQL URL and signing private key stay in service secrets. |
| Licensing portal | `VITE_LICENSING_API_URL` | Public HTTPS API origin compiled into static bundle. |

## Verification report

- `node --check src/server.js` and `node --check src/license-service.js` in `licensing-service/`: **passed**.
- `npm run typecheck --workspace=server`: **passed**.
- `npm run build --workspaces --if-present`: **student and admin frontend builds passed; server TypeScript build passed**. It does not build the separate licensing portal/service because they are not npm workspaces.
- `npm test --workspace=server`: **failed overall because MariaDB was unavailable**. 56 tests passed, 30 were skipped, and three integration suites failed during setup/cleanup with Prisma pool timeouts. This is an environment failure, not evidence those integration behaviors pass.
- `npm run lint --workspace=server`: **passed**.
- `npm run build --workspaces --if-present`: **passed** for `apps/admin`, `apps/web`, and `server`.
- `npm run build` in `licensing-portal/`: **passed**.
- `npm run prisma:generate --workspace=server`: **passed** after the MariaDB license schema change.
- `npm exec --workspace=server -- vitest run tests/license.test.ts`: **passed**, 7 tests including a cross-service signer/verifier compatibility check, payload tampering, algorithm, product and installation binding, expiry, issue time and perpetual claims.
- `npm run typecheck --workspace=server`, `npm run build --workspace=server`, `npm run lint --workspace=server`, and `npm run build --workspace=apps/admin`: **passed** after adding online/offline activation and the exam-start gate.
- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` in `licensing-service/`: **passed** and generated `licensing-service/package-lock.json`. A subsequent `npm ci` did not complete in the local network/runtime window and was stopped.
- Licensing PostgreSQL persistence, database-backed online/offline activation and exam-start gate, activation contention, full MariaDB integration, restore, Windows installer, and Render deployment: **not tested**.
- Local Docker/MariaDB verification could not run: Docker reported that the engine pipe/daemon was unavailable. The server integration-suite failures therefore remain environment-blocked.

## First-customer release checklist

- [ ] Close every Critical/High blocker above and attach the exact CI or rehearsal output.
- [ ] Build signed Windows installer; test clean install, reboot/service recovery, LAN firewall scope, upgrade, rollback and uninstall retention on supported Windows Server versions.
- [ ] Provision fresh MariaDB from migrations; run auth/RBAC, student import, exam schedule, autosave/reconnect, server-timing, auto-submit, grading and concurrent-candidate suites.
- [ ] Rehearse local online activation and offline signed-file import; complete offline grace/expiry/revocation/clock-change and transfer behavior, and verify fail-closed behavior without interrupting an active exam.
- [ ] Deploy licensing PostgreSQL and portal to HTTPS; verify role/admin setup, CORS, licensing lifecycle, signature tampering, duplicate retries and activation count limits.
- [ ] Rehearse encrypted backup, integrity check, full restore, application upgrade and rollback for both databases separately.
- [ ] Confirm generated production secrets, matching signing keys, least-privilege OS/database accounts, restricted ports, no seeded credentials, log redaction and incident contact.
- [ ] Obtain school ICT acceptance, documented LAN URL, administrator handover, backup schedule, recovery contact and release version/checksum.
