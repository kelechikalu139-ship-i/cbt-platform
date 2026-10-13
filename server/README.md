# CBT Examination System — API Server

Express 5 + TypeScript + Prisma 7 + MariaDB. Serves the student and admin web
applications over a school LAN with no internet dependency.

---

## Quick start

```bash
# 1. Install workspace dependencies (from the repo root)
npm install

# 2. Create the database container
docker start cbt-mariadb        # or: docker-compose up -d mariadb

# 3. Configure the environment
cp server/.env.example server/.env
```

Generate real secrets and put them in `server/.env` — the server refuses to start
in production with the placeholder values:

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
```

Then apply the schema and seed the system data:

```bash
cd server
npm run prisma:migrate     # create/apply migrations
npm run prisma:seed        # 29 permissions, 6 roles, dev admin, sample data
npm run dev                # http://0.0.0.0:5000
```

Confirm the whole stack is healthy:

```bash
curl http://127.0.0.1:5000/api/v1/health
```

```json
{ "success": true, "data": { "status": "ok", "database": "connected", ... } }
```

The seeded development administrator is `admin@cbt.local` / `Admin@12345`.
**Change this before the system faces a real network.**

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Watch mode (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm run typecheck` | Type-check application code |
| `npm run typecheck:tests` | Type-check tests and scripts |
| `npm run lint` | ESLint over src, prisma, tests, scripts |
| `npm run format` | Rewrite with Prettier |
| `npm test` | Vitest suite (77 tests) |
| `npm run test:coverage` | Vitest with coverage |
| `npm run verify` | typecheck + lint + test |
| `npm run prisma:migrate` | Create and apply a migration (dev) |
| `npm run prisma:deploy` | Apply existing migrations (production) |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:seed` | Seed roles, permissions and sample data |
| `npm run prisma:reset` | Drop, re-migrate and re-seed (destroys data) |
| `npm run prisma:studio` | Browse the data in a GUI |
| `npm run routes` | Print the mounted route table |
| `npm run check:db` | Verify env parsing, logging and DB connectivity |
| `npm run smoke` | End-to-end API regression suite (51 checks) |

---

## Environment variables

All variables are validated with Zod at startup (`src/config/env.ts`). A missing
or malformed value stops the process **before** any listener opens and before the
database is touched. See `.env.example` for the annotated template.

### Runtime

| Variable | Default | Notes |
|----------|---------|-------|
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `PORT` | `5000` | |
| `HOST` | `0.0.0.0` | Must be `0.0.0.0` for LAN access |
| `APP_NAME` / `APP_VERSION` | | Reported by `/` and `/health` |

### Database

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | *(required)* | `mysql://user:pass@host:3306/database` |
| `DATABASE_POOL_SIZE` | `10` | Sized for a whole lab connecting at once |
| `DATABASE_CONNECT_TIMEOUT_MS` | `10000` | Fail fast instead of hanging |

### Authentication

| Variable | Default | Notes |
|----------|---------|-------|
| `JWT_ACCESS_SECRET` | *(required)* | Minimum 32 characters |
| `JWT_REFRESH_SECRET` | *(required)* | Minimum 32 characters, must differ from the above |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | |
| `BCRYPT_SALT_ROUNDS` | `12` | |

In production the process additionally refuses to start when a secret is still a
placeholder, when the two secrets are identical, or when `CORS_ORIGIN` is `*`.

### CORS, logging and rate limits

| Variable | Default | Notes |
|----------|---------|-------|
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allow-list |
| `LOG_LEVEL` | `info` | |
| `LOG_PRETTY` | `true` | Set `false` in production for JSON lines |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `_MAX` | `900000` / `10` | Guards credential stuffing |
| `GLOBAL_RATE_LIMIT_WINDOW_MS` / `_MAX` | `60000` / `3000` | Deliberately generous |
| `SEED_ADMIN_*` | | Development seed credentials |

### Why the global limit is so high

During an examination a whole lab fires requests simultaneously. Throttling a
student's answer save is worse than tolerating the burst, so the global ceiling is
set far above realistic peak load. The strict limit is applied only where abuse is
plausible — the authentication endpoints.

---

## Project structure

```
server/
├── prisma/
│   ├── schema.prisma          # 18 models — the source of truth
│   ├── seed.ts                # idempotent: permissions, roles, dev admin, sample data
│   └── migrations/            # generated SQL
├── scripts/
│   ├── check-db.ts            # environment / logging / connectivity diagnostics
│   ├── list-routes.ts         # generates the route table below
│   └── smoke-api.mjs          # 51-check end-to-end regression suite
├── src/
│   ├── config/                # env (Zod), logger (Pino + redaction), database (Prisma adapter)
│   ├── constants/             # permission catalogue and role definitions
│   ├── middleware/            # authenticate, requirePermission, validate, errors, rate limits
│   ├── modules/               # one folder per resource: routes / controller / service / schema
│   │   ├── auth/  students/  categories/  questions/  exams/
│   │   ├── users/  system/
│   ├── routes/index.ts        # mounts every module under /api/v1
│   ├── services/audit.service.ts
│   ├── utils/                 # ApiError, asyncHandler, http-response, pagination, password, tokens
│   ├── app.ts                 # middleware assembly (exported as a factory for tests)
│   └── server.ts              # process bootstrap and graceful shutdown
├── tests/                     # Vitest: unit + integration
└── tsconfig.json              # build config (excludes tests)
```

### Module layout

Each resource follows the same shape, so a new module is a copy of a known
pattern:

| File | Responsibility |
|------|----------------|
| `*.routes.ts` | URL, method, and the middleware chain. No business logic. |
| `*.controller.ts` | Request → validated input → service → response envelope. No queries. |
| `*.service.ts` | All database access and business rules. |
| `*.schema.ts` | Zod validation, including cross-field rules. |

---

## API

Base path `/api/v1`. Every response uses one envelope:

```jsonc
// Success — single resource
{ "success": true, "data": { ... } }

// Success — paginated collection
{ "success": true, "data": [ ... ],
  "meta": { "page": 1, "pageSize": 20, "totalItems": 137, "totalPages": 7 } }

// Failure
{ "success": false, "message": "Human readable summary",
  "errors": { "email": ["Must be a valid email"] } }
```

`errors` is present only for validation failures, and each value is an **array of
strings**. This matches the admin app's client exactly, so no adapter is needed.

### Status codes

| Code | Meaning |
|------|---------|
| `200` / `201` | Success / created |
| `401` | Missing, invalid or expired token |
| `403` | Authenticated but the role lacks the permission |
| `404` | Not found (or soft-deleted) |
| `409` | Duplicate or conflicting state |
| `422` | Validation failed, or the action is refused by a business rule |
| `429` | Rate limit exceeded |
| `500` | Unexpected server error |

`401` and `403` are deliberately distinct: `403` means the caller is known but not
allowed, which the admin UI renders differently.

### Pagination

All list endpoints accept `?page=1&pageSize=20&search=&sort=&order=asc|desc`.

- `pageSize` is capped at 100. An oversized request is clamped, not rejected.
- `sort` is checked against a per-module allow-list; an unknown field silently
  falls back to the default. An arbitrary column must never reach the ORM's
  `orderBy`.
- `search` escapes `%` and `_`, so a literal `100%` matches itself rather than
  matching everything.

### Routes

Regenerate with `npm run routes`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/health` | No token required. Reports DB connectivity and uptime |
| GET | `/api/v1/auth/me` | Current user |
| POST | `/api/v1/auth/login` | Rate limited. Returns access + refresh tokens |
| POST | `/api/v1/auth/refresh` | Rotates the refresh token; replay is rejected |
| POST | `/api/v1/auth/logout` | Revokes the refresh token |
| POST | `/api/v1/auth/change-password` | |
| GET/POST | `/api/v1/students`, `/api/v1/students/:id` | Search, paginate, soft delete |
| GET/POST | `/api/v1/categories`, `/api/v1/categories/:id` | |
| GET/POST | `/api/v1/categories/subjects` | Subjects nested under categories |
| POST/PATCH | `/api/v1/subjects`, `/api/v1/subjects/:id` | |
| GET/POST | `/api/v1/questions`, `/api/v1/questions/:id` | |
| POST | `/api/v1/questions/bulk` | CSV/JSON rows; `autoCreateTaxonomy` (default `true`) creates categories/subjects the file names but the bank lacks |
| GET | `/api/v1/questions/subjects` | Pool sizes per subject, for the exam builder |
| GET/POST | `/api/v1/exams`, `/api/v1/exams/:id` | |
| POST | `/api/v1/exams/:id/publish` | Refuses an exam with no questions (422) |
| POST | `/api/v1/exams/:id/unpublish` | |
| GET/POST | `/api/v1/users`, `/api/v1/users/:id` | Role assignment |
| GET | `/api/v1/audit-logs`, `/api/v1/audit-logs/actions` | Filterable trail |
| GET | `/api/v1/students/classes` | Distinct class list for filters |
| GET | `/api/v1/system/status` | Counts and build information |

---

## Authentication

Two tokens with deliberately different lifetimes:

- **Access token** — 15 minutes, sent as `Authorization: Bearer <token>`.
- **Refresh token** — 7 days, rotated on every use and stored **hashed**.

Rotation is single-use: a refresh token that has already been exchanged is
revoked, and presenting it again returns `401`. That is what makes a stolen
refresh token detectable instead of indefinitely reusable.

Both token types are signed with different secrets and carry a `typ` claim, so a
refresh token cannot be presented as an access token or the reverse. Password
hashes, answer keys and licence secrets are never placed in a token payload.

### Failed logins reveal nothing

An unknown email and a wrong password return the same `401` with the same message,
and the same applies to an inactive account with a correct password. The endpoint
must not be usable to enumerate staff accounts or students.

---

## Roles and permissions

29 permissions in the `<resource>.<action>` form across six roles.

| Role | Summary |
|------|---------|
| `SUPER_ADMIN` | Every permission, including licensing |
| `ADMIN` | Full operational control; licensing read-only |
| `EXAM_OFFICER` | Builds and publishes exams; no staff accounts, no audit |
| `LECTURER` | Authors and edits questions; cannot publish or publish exams |
| `INVIGILATOR` | Read-only: views rosters and question banks |
| `STUDENT` | No administrative permission |

Least privilege is enforced structurally and covered by tests in
`tests/rbac.test.ts`: an invigilator can never mutate anything, `SYSTEM_MANAGE`
belongs only to `ADMIN` and `SUPER_ADMIN`, and no non-admin role can reach staff
account administration or the audit trail.

### Student accounts

Students never self-register. An administrator creates the record and assigns the
portal credentials. `Student.userId` is optional so a candidate can exist in the
system before they are ever given log-in access.

---

## Question integrity

A question is a discriminated union on `type`, so a true/false item cannot carry
options and a multiple-choice item must:

- have at least two options,
- have unique option labels,
- and carry an answer key that matches one of those labels.

A question whose key matches no option would be permanently unanswerable, so it is
rejected at the schema boundary rather than at grading time.

Marks are stored as a fixed-point decimal, never a float, to avoid the rounding
drift that makes a mark sheet disagree with a score report.

---

## Exam lifecycle

```
DRAFT ──publish──> PUBLISHED ──unpublish──> DRAFT
```

Publishing snapshots the questions and their answer keys onto the exam, so later
edits to the question bank cannot alter an exam that candidates are already
sitting. A published exam refuses edits with `409`; publishing an exam with no
questions is refused with `422`.

### Building a paper from a pool

An exam is created either with an explicit `questionIds` array (a hand-picked
paper) or with a `questionFilter` (`categoryIds`, `subjectIds`, `types`,
`difficulties`). A filter attaches every active question it matches, ordered by
creation time — so a CSV uploaded into a course becomes a paper by selecting
that course in the exam form. The exam also carries `program`, `department`,
`level`, `semester` and `classes` (a JSON array of class names) so a paper is
set for a particular class or classes and level.

---

## Security

| Measure | Implementation |
|---------|----------------|
| Password hashing | bcrypt, cost 12, salted per password |
| Timing-safe comparison | `bcrypt.compare` everywhere |
| Brute-force defence | Strict limiter on auth endpoints only |
| Header hardening | helmet; this process only serves JSON |
| CORS | Explicit allow-list; `*` refused in production |
| Client IP trust | `trust proxy` is **off** — there is no proxy on a school LAN, and trusting `X-Forwarded-For` would let any student spoof their address and defeat the rate limiter |
| Log redaction | Passwords, tokens, cookies, authorization headers and answer keys never reach the log |
| Error responses | Internal details never returned to the client; `X-Request-Id` correlates to the server log |
| SQL injection | Parameterised queries only; identifiers restricted to allow-lists |
| Audit trail | Login, logout, and all mutations recorded with actor, IP and request id |

Every response carries an `X-Request-Id` header. The same value appears in the
log line and in any error, which is what makes a fault on a shared lab machine
diagnosable after the fact.

---

## Wiring the frontends

The admin app's connection layer is now wired to this backend. Sign-in is proven
end to end: the form posts to `POST /api/v1/auth/login`, gets `200`, and stores
the real access token (`apps/admin/scripts/live-login-check.mjs`).

**Beyond sign-in the admin app is not yet functional against the live API.** The
remaining gaps are contract divergence, not configuration, and they are
substantial. Verified findings:

### Fixed

| Area | Change |
|------|--------|
| API base URL | Defaults to the relative `/api/v1`, proxied by the Vite dev server |
| Dev proxy target | `VITE_SERVER_ORIGIN`, default `http://localhost:5000` |
| Login request | Sends `{ email, password }`, matching the backend schema |
| Login response | Reads `accessToken` from the `data` envelope; the mock layer was updated to match so both modes behave identically |
| Placeholder token | `LoginPage` stores the returned token instead of the hardcoded `'session-token'` |

### Blocking: role and permission vocabulary

The admin app was written against a hypothetical schema and hardcodes a
coarse-grained vocabulary that the backend does not use.

| | Admin app expects | Backend returns |
|---|---|---|
| Role | `'super_admin'`, `'admin'`, `'exam_officer'`… | `'SUPER_ADMIN'`, `'ADMIN'`, `'EXAM_OFFICER'`… |
| Status | `'active'`, `'inactive'`… | `'ACTIVE'`, `'INACTIVE'`… |
| Permissions | 14 coarse: `students.view`, `students.manage` | 29 fine-grained: `students.read`, `students.create`, `students.delete`… |
| Question type | `'multiple_choice'`, `'true_false'` | `'MULTIPLE_CHOICE'`, `'TRUE_FALSE'` |

This fails silently and dangerously. `Sidebar` filters navigation with
`can(item.permission)` → `hasPermission(user.role, …)` →
`ROLE_PERMISSIONS[role]`. With `role = 'SUPER_ADMIN'` that lookup is `undefined`,
so **every navigation item is filtered out and the admin sees a sidebar with no
links at all** — while the header still reads "SUPER ADMIN", so the empty menu
looks like a bug rather than a contract mismatch.

The same class of error affects every enum-typed field (status badges, question
type labels, exam status) and every field whose name differs between the two
sides (`Student.program` vs `departmentId`, `Question.correctAnswer` vs
per-option `isCorrect`, and so on).

### Blocking: endpoints the app calls that do not exist

| App calls | Backend status |
|---|---|
| `GET /api/v1/dashboard` | **404.** No aggregate summary endpoint exists |
| `GET /api/v1/students/classes` | Exists |
| `POST /api/v1/students/import`, `GET /api/v1/students/export` | Not implemented |

The missing `/dashboard` summary is what renders "Dashboard unavailable" on the
landing page.

### Not yet exercised

`apps/web` (the student app) is still untouched. Its `VITE_API_URL` and dev
proxy point at port `3001`, and student sign-in sends a matriculation number,
which has no backend equivalent — students are provisioned by an administrator
and do not self-register.

### Resolving the divergence

Three viable directions; the choice determines where the work lands.

1. **Align the admin app to the backend.** Update the type layer to UPPER_CASE
   enums and the 29-permission vocabulary, replace the client-side role table
   with the `permissions` array `/auth/me` already returns, and rename fields
   to the backend's. Roughly 53 permission references across 7 files plus the
   types module, and it makes the client-side grant table redundant — which is
   the correct end state, since duplicating RBAC in two places invites drift.
2. **Align the backend to the admin app.** Rename Prisma enums to lowercase and
   coarsen 29 permissions into 14. Requires a migration and a reseed, and
   discards the fine-grained least-privilege guarantees that `tests/rbac.test.ts`
   now enforces.
3. **Add a normalising adapter** at the admin service boundary so the UI types
   stay untouched. Lowest immediate churn, but adds a translation layer that must
   be maintained for every new endpoint.

Option 1 is the better long-term shape: the backend contract is the one that is
implemented, tested and security-reviewed, and removing the duplicated client-side
grant table deletes a whole class of future drift.

---

## Testing

```bash
npm test              # 77 tests
npm run test:coverage
npm run smoke         # 51 checks against a running server
```

The suite is deliberately weighted toward what would actually damage the
school's data or expose a candidate:

- **tokens** — a refresh token must not work as an access token, a tampered
  payload must be rejected, and no sensitive material may appear in a JWT.
- **auth** — wrong password, unknown email and inactive account must be
  indistinguishable; rotation must reject a replayed token.
- **authorisation** — `403` not `401` for a permitted-but-unauthorised call, and a
  lecturer must not reach staff accounts, the audit trail or exam publication.
- **rbac** — properties of the grant matrix, so a mis-edited seed is caught before
  it reaches the database.
- **pagination** — clamping, allow-listed sorting, and `LIKE` wildcard escaping.
- **validation** — password strength, and the cross-field question rules.

Integration tests run the real Express app against the real MariaDB via
`supertest`, so routing, middleware and Prisma are covered together. Fixtures use
unique identifiers and are removed afterwards, leaving seeded data untouched.

`fileParallelism` is off in `vitest.config.ts` because every integration test
shares one database; parallel suites would let one test's data leak into another's
assertions.

---

## LAN deployment

1. **Reserve an IP** for the server PC (for example `192.168.1.100`) so it does not
   change between sessions.
2. **Database**: run MariaDB on the same PC. Bind it to `127.0.0.1` — it should
   never be reachable from the student network.
3. **API**: set `HOST=0.0.0.0` so it binds every interface, and add the admin app's
   origin to `CORS_ORIGIN` (`http://192.168.1.100:5174`).
4. **Firewall**: open the API port inbound. Do **not** open 3306.
5. **Frontends**: set `VITE_API_URL` to `http://192.168.1.100:5000/api/v1` in each
   app, and build with `npm run build`.
6. **First sign-in**: change the seeded administrator password immediately.

Verify from a student machine:

```bash
curl http://192.168.1.100:5000/api/v1/health
```

A response means the API is reachable from the LAN. If it fails, check in order:
the server's IP, `HOST` (must not be `127.0.0.1`), then the Windows Firewall rule.

### Running as a service

Wrap `npm start` in a process supervisor that restarts on failure, and set
`NODE_ENV=production` and `LOG_PRETTY=false`. The server validates production
settings at startup and will refuse to run with placeholder secrets, identical
secrets, or a wildcard CORS origin.

---

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| Exits immediately with a config error | Missing or malformed variable; the message names the variable |
| `Can't reach database server` | Container stopped, wrong `DATABASE_URL`, or the app user lacks grants |
| `Unknown database 'cbt_system'` | Migrations not applied — run `npm run prisma:migrate` |
| 401 on every request | Access token expired (15 min) — use `/auth/refresh` |
| 401 after a refresh | The token was already used; rotation revokes it |
| 403 | Authenticated but the role lacks the permission; check `GET /api/v1/auth/me` |
| 422 on publish | The exam has no questions |
| 409 on exam edit | The exam is published; unpublish first |
| LAN clients cannot connect | `HOST` is `127.0.0.1`, or the firewall is blocking the port |
| Origin rejected by CORS | The requesting origin is missing from `CORS_ORIGIN` |

Set `LOG_LEVEL=debug` for verbose logs. Include the `X-Request-Id` from a failing
response when reporting a problem — it pins the exact log lines.