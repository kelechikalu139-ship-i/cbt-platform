# Commercial deployment readiness audit

Audit date: 23 October 2026. Scope: tracked repository contents and checks run in this workspace. This is an implementation audit, not a customer deployment certification.

## Readiness decision

**Not ready for a first commercial installation.** A Windows installer source and release-staging pipeline now exist, including both web apps, local MariaDB provisioning, first-super-admin setup, Windows service registration, firewall setup, and backup-before-upgrade logic. No customer installer has yet been compiled, signed, or exercised on a clean Windows Server VM. Authentication/API compatibility, LAN client access, reboot recovery, upgrade rollback and operational recovery still need release validation. The hosted licensing service previously used MySQL and could not run against the specified PostgreSQL target. Its database layer now uses PostgreSQL, and local schema, concurrency and HTTP lifecycle checks pass; production deployment remains outstanding.

The repository has three separate frontends/services: `apps/web`, `apps/admin`, `server` for the school installation, and `licensing-portal` / `licensing-service` for central licensing. The school Prisma schema is MariaDB/MySQL and must remain so. Licensing tables are separate and PostgreSQL-only.

## Prioritized blockers

| Priority | Finding and repository evidence | Release gate |
|---|---|---|
| Critical | Windows installer source now covers service registration, loopback MariaDB configuration, Domain/Private firewall scope, first-admin setup, pre-upgrade database backup, migrations and uninstall retention. The `.exe` is not yet compiled or Authenticode-signed, and clean/upgrade/restore tests on Windows Server have not been run. | Build the signed release and validate clean install, reboot, LAN clients, upgrade, restore and uninstall on supported Windows VMs. |
| Critical | Licensing uses `pg`, PostgreSQL SQL and a separate `licensing-service/schema.sql`; online/offline issuance are row-locked, and open-license uniqueness is enforced in PostgreSQL. Local database and HTTP lifecycle integration checks pass. Local development signing keys now work and match the school public key; production key storage/rotation still needs a managed secret process. | Define production signing-key provisioning/rotation, then test Render connection/pooling, backup and migration procedure. |
| High | Licensing has database-backed admin accounts with invitation-only registration, super-admin access controls, immediately enforced account disabling, and mandatory TOTP MFA enrollment with one-time recovery codes. Billing/payment reconciliation is absent, and `max_candidates` only becomes a signed claim. Renewal rotates keys; admins can suspend/resume with audit events. Transfer workflows and a retention/export policy remain absent. Already-issued offline licenses can continue until expiry or their next check-in. | Validate MFA recovery and remaining workflows before sale. |
| High | Central activation binds a license to the submitted installation ID but does not require proof of possession from the local server. The UUID is server-generated locally but can be copied with the database/configuration. | Add a server-held key challenge/proof protocol and define transfer/reinstall recovery; do not claim cloning resistance. |
| High | The school server now has online activation and offline signed-file import in Settings, Ed25519 verification, MariaDB persistence, and a production gate that prevents starting new attempts without a valid license. Answer saving/submission for an already-started exam remain available after expiry. There is no offline grace, automated revocation check or admin transfer workflow. | Test live/air-gapped activation and exam-flow recovery; implement signed refresh/revocation and transfer policy. |
| High | CBT license state is local MariaDB state while issuance remains central PostgreSQL. This branch connects activation but does not yet synchronize renewals, revocations or transfers. | Keep providers separate; add a tested refresh and transfer protocol. |
| High | `server/src/services/backup.service.ts` makes logical JSON backups and supports destructive replacement restore, but no backup test proves a restore. Backups have no encryption or integrity signature, and the routine restore suspends foreign-key checking. | Test verified restore on a disposable MariaDB instance; protect storage, define retention, encryption and operator approval. |
| High | Root and server docs expose development seed passwords, and `server/src/config/env.ts` defaults seed credentials. The Prisma seed itself rejects production, but installers must never deploy a dev seed or use the examples as production credentials. | First-run secure administrator provisioning and production secret scan/release check. |
| Medium | `licensing-portal` uses an in-memory token and supports issue, renewal, suspend/resume and recovery through key reissue; it displays the latest 100 central licensing audit events. Renewal rotates the activation key and its screen shows the new key once. Its deployment requires a build-time `VITE_LICENSING_API_URL`. | Browser-level deployment checks against the real API origin. |
| Medium | Seven unit tests cover local license signature verification, seven licensing-service unit tests cover activation lifecycle policy, one PostgreSQL integration test covers license uniqueness and activation row locking, and one HTTP integration test covers issue/revoke, activation and audit events. `server/README.md` still contains stale claims that system/settings endpoints do not exist. Windows installer tests, MariaDB restore tests, and load tests for simultaneous candidates remain absent. | Reconcile the server guide and add release-gate suites with reproducible test databases and Windows runners. |

## Repository evidence by capability

- **Local data and exams:** `server/prisma/schema.prisma` uses `provider = "mysql"`; `server/src/config/database.ts` constructs `PrismaMariaDb`. Schema includes users/roles/permissions, students, question bank, exams, exam sessions, answers, results, audit logs, and a local license model. Migrations include academic-session/class fields and the signed-license cache change.
- **Authentication/security foundation:** server code uses bcrypt, short-lived access tokens, refresh-token rotation, database-backed permissions, Zod request validation, Helmet, CORS allow-list, rate limiting, and Pino logging. Existing tests cover auth, RBAC, validation, tokens, pagination, autosubmit, and system routes. These do not establish commercial security without production configuration and full deployment testing.
- **Exam integrity foundation:** the schema and `server/src/modules/exams` plus `server/src/services/auto-submit.service.ts` implement server-owned expiry, stored question order, answer persistence and scheduled auto-submit. Concurrent-load and server-restart behavior still need explicit integration evidence.
- **Central licensing:** `licensing-service/src/server.js` now uses PostgreSQL `pg`, explicit HS256 JWT verification, Ed25519 key-pair consistency validation, readiness health checks, and transactional issue/renew/activation/offline-issue/suspend/resume/revoke audit events. Admins are stored in PostgreSQL; bootstrap is a one-time CLI action, invitations expire after 48 hours, and each authenticated request checks account status. `licensing-service/schema.sql` is independent of the MariaDB Prisma schema. The portal supports admin login, invited registration, super-admin account management, issue, renew, list, offline issue, suspend/resume, revoke and recent activity history.
- **Database tooling:** the central licensing service remains on `pg` intentionally: the current PostgreSQL model is small, and activation/offline issuance use PostgreSQL row locks directly. Prisma would be reasonable if the central domain grows or typed models and generated migrations become a priority; it would still need raw SQL for `SELECT ... FOR UPDATE`. Do not point the school server's MariaDB Prisma client at this PostgreSQL database.
- **Local signing setup:** `npm run keys:setup:local` generated an Ed25519 pair after the local-only guards passed: `NODE_ENV=development`, database `cbt_licensing_platform`, zero existing licenses, and no valid key in either environment. The private key is in the ignored licensing `.env`; the matching public key is in the ignored school `.env`. The setup command refuses to rotate an existing valid key.
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

## Windows installation and upgrade guide (release source; not yet certified)

**No compiled customer package currently exists.** Installer source and build instructions are in `deployment/windows/`; do not install the repository directly on a customer server. Docker and developer tools are not a customer requirement.

The release package must bundle/pin a supported Node runtime, built admin/student assets, API, and a maintained Windows service wrapper; provision local MariaDB bound to loopback; store configuration and secrets under an ACL-restricted ProgramData directory; migrate before the API service starts; and open only the required CBT web/API LAN port in Windows Firewall. The installer must generate unique secrets and installation ID, ask for an approved LAN hostname/address, create an initial administrator securely, and run health checks. It must detect an existing version and take a verified backup before any upgrade. Uninstall must stop services and remove program files while retaining database and backups unless an operator separately chooses a documented data purge.

Before release, provide school ICT staff a signed installer, checksum, prerequisites, clean-install steps, LAN client check, update/rollback steps, backup location, restore rehearsal, logs/diagnostics location and uninstall/data-retention steps. Do not expose MariaDB port 3306 to the LAN.

## Local license activation workflow (implemented path, not yet rehearsed)

For online activation, an authorized school administrator opens Settings, copies the installation ID for support records, enters the activation key, and submits it. The local API contacts `LICENSING_API_URL`, verifies the returned signature against `LICENSE_PUBLIC_KEY_B64`, and stores the signed license in MariaDB. The activation key is not stored; only its digest is retained. For an air-gapped school, the licensing administrator uses the central portal's offline-issue workflow with the installation ID, securely transfers the resulting signed JSON file, and the school administrator imports that file in Settings. The local server verifies signature, product, expiry, claims and installation binding before persistence.

The offline path does not need a connection during exam delivery, but no grace after signed expiry is provided. A lost/reinstalled server requires a centrally authorized transfer; that workflow is not implemented. A copied installation ID is not strong proof that the caller controls the original server, so proof-of-possession remains a release blocker.

## Render deployment guide (not yet deployed)

1. Provision Neon PostgreSQL and a Render Node web service rooted at `licensing-service/`. Set build/install to `npm install`; start to `npm start`; use the health path `/health`. For Render, set the portal static site root directory to `licensing-portal/` and publish directory to `dist/`.
2. Set `DATABASE_URL` to Neon's pooled PostgreSQL connection URL, `PGSSL=true`, and `DB_POOL_SIZE` within the database connection budget. The API applies the idempotent schema at startup; `npm run db:setup` is available for explicit setup and is guarded by `EXPECTED_DATABASE_NAME` (default `cbt_licensing_platform`).
3. Set `PORTAL_ORIGIN` to the exact HTTPS static-site origin. Inject a generated 32+ character `JWT_SECRET` and matching Ed25519 private/public keys as protected API secrets. Do not place the private key in the portal or school server.
4. For first setup, provide `LICENSE_ADMIN_EMAIL` and `PORTAL_ORIGIN`, then run `npm run admin:bootstrap`. It creates a 30-minute one-time setup link only while there are no admin accounts; the first super-admin chooses a password in the portal. If the sole super-admin needs recovery, set `EXPECTED_DATABASE_NAME` to the target database and run `npm run admin:recover`; it updates that account using a hidden password prompt. After setup, the portal defaults to sign-in, and additional accounts require super-admin invitations.
5. Build `licensing-portal/` as a separate static site using `npm install && npm run build`; publish `dist` relative to the portal root directory. Set build-time `VITE_LICENSING_API_URL` to the API service's HTTPS origin, without a trailing path prefix.
6. Deploy the API, wait for `/health` to return `{"status":"ok","database":"connected"}`, then build/deploy the portal and test admin login, invited registration, disable behavior, issue, activation, revoke, invalid signature and expired license against a disposable database.
7. Confirm logs contain no secrets, PostgreSQL access is limited to the service, backups are enabled at the provider, CORS rejects a different origin, and the signing key backup/rotation procedure is recorded.

Deployment has **not** succeeded or been tested against Render. Database-backed administrator login, invitation registration, access management, and mandatory TOTP enrollment are implemented, but need operational/customer-flow validation. Payment reconciliation and license transfer workflows remain absent. Renewal and suspension also need operational/customer-flow validation.

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
| Licensing API | `NODE_ENV`, `PORT`, `HOST`, `DATABASE_URL`, `DB_POOL_SIZE`, `PGSSL`, `JWT_SECRET`, `LICENSE_PRIVATE_KEY_B64`, `LICENSE_PUBLIC_KEY_B64`, `PORTAL_ORIGIN`, `LICENSE_ADMIN_EMAIL` | See `licensing-service/.env.example`; `LICENSE_ADMIN_EMAIL` is used only to bind the one-time first-admin setup link. PostgreSQL URL and signing private key stay in service secrets. |
| Licensing portal | `VITE_LICENSING_API_URL` | Public HTTPS API origin compiled into static bundle. |

## Verification report

- `npm run check` and `npm test` in `licensing-service/`: **passed**; seven lifecycle policy tests cover activation binding, terminal states, exact expiry, offline issue and expiry handling.
- `licensing-service/scripts/check-db.js` and `setup-db.js` provide a credential-safe probe and a schema setup command that refuses any database except `cbt_licensing_platform`. The local PostgreSQL Windows service accepted the configured connection; schema setup completed. Local `PGSSL` is set to `false` because TLS certificate validation is unnecessary for loopback development.
- `npm run keys:check`: **passed**; licensing private/public keys match and the school public key matches them.
- `RUN_POSTGRES_TESTS=true npm run test:db` and `RUN_POSTGRES_TESTS=true npm run test:http` (PowerShell equivalent: set `$env:RUN_POSTGRES_TESTS='true'` first): **passed**. The database test verifies the partial unique index and a competing `SELECT ... FOR UPDATE`; the HTTP test covers admin issue/revoke, activation, same-install retry, different-install conflict, audit retrieval, and that audit data contains no activation key. It passed against the configured local pair and an ephemeral pair. Temporary database rows/events are cleaned up.
- The service started on loopback port `18080`; `/health` returned `{"status":"ok","database":"connected"}`. The temporary service process was stopped after verification.
- `npm run typecheck --workspace=server`: **passed**.
- `npm run build --workspaces --if-present`: **student and admin frontend builds passed; server TypeScript build passed**. It does not build the separate licensing portal/service because they are not npm workspaces.
- `npm test --workspace=server`: **failed overall because MariaDB was unavailable**. 56 tests passed, 30 were skipped, and three integration suites failed during setup/cleanup with Prisma pool timeouts. This is an environment failure, not evidence those integration behaviors pass.
- `npm run lint --workspace=server`: **passed**.
- `npm run build --workspaces --if-present`: **passed** for `apps/admin`, `apps/web`, and `server`.
- `npm run build` in `licensing-portal/`: **passed**.
- `npm run prisma:generate --workspace=server`: **passed** after the MariaDB license schema change.
- `npm exec --workspace=server -- vitest run tests/license.test.ts`: **passed**, 7 tests including a cross-service signer/verifier compatibility check, payload tampering, algorithm, product and installation binding, expiry, issue time and perpetual claims.
- `npm run typecheck --workspace=server`, `npm run build --workspace=server`, `npm run lint --workspace=server`, and `npm run build --workspace=apps/admin`: **passed** after adding online/offline activation and the exam-start gate.
- `npm ci --no-audit --no-fund` in `licensing-service/`: **passed**; 102 packages installed. npm reported `bcrypt`'s install script as awaiting explicit approval, but the package imports and the API starts successfully in this workspace.
- Licensing PostgreSQL schema setup, partial unique institution constraint, concurrent activation row-lock behavior, and HTTP online activation lifecycle: **passed** against the local database. HTTP offline issue/import, full MariaDB integration, restore, Windows installer, and Render deployment: **not tested**. The central service still accepts the installation ID submitted with the activation key; cryptographic proof of possession and transfer recovery remain release blockers.
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
