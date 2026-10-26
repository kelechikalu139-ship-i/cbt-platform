# CBT Platform

A Computer Based Testing (CBT) platform monorepo for managing and delivering online exams to students.

Commercial deployment status is tracked in the [readiness audit](docs/COMMERCIAL_DEPLOYMENT_READINESS.md). This repository is not yet ready for a customer installation.

## Architecture

| Workspace | Description | Port |
|-----------|-------------|------|
| `apps/web` | React + Vite student application | 5173 |
| `apps/admin` | React + Vite admin dashboard | 5174 |
| `server` | Express 5 + TypeScript + Prisma API | 5000 |
| `packages/shared` | Shared types, constants, validation | - |

## Tech Stack

- **Frontend**: React 18, Vite 5, TypeScript, TailwindCSS, Zustand, React Router 6, Axios
- **Backend**: Node.js, Express 5, TypeScript, Prisma 7, MariaDB, JWT auth
- **Monorepo**: npm workspaces

## Getting Started

```bash
# 1. Install all dependencies
npm install

# 2. Start the database
docker compose up -d          # or: docker start cbt-mariadb

# 3. Configure the server environment
cp server/.env.example server/.env   # then set real JWT secrets

# 4. Create the schema and seed the system data
npm run db:migrate
npm run db:seed

# 5. Start the API
npm run dev:server

# 6. Start the apps
npm run dev:admin     # http://localhost:5174
npm run dev:web       # http://localhost:5173
```

MariaDB is published on `127.0.0.1:3306` only. It holds exam papers, answer keys
and candidate records, so it must not be reachable from student machines; the API
is the only intended client and runs on the same host.

The seeded development administrator is `admin@cbt.local` / `Admin@12345`.
Change it before the system faces a real network.

See **[server/README.md](server/README.md)** for the full API reference,
environment variables, roles and permissions, LAN deployment, and troubleshooting.

## Authentication Model

**Students do not register.** Student accounts are created and assigned by an
administrator in the admin dashboard. Public access to the student app is limited
to a single page: matriculation number entry.

- `apps/web` (student) — logs in with a **matriculation number only**. There is no
  registration page and no password, because access is provisioned by the admin.
- `apps/admin` — the only place where students and exams are created. This is the
  intended control point for authorised registration.

### Mock mode

The student app can use an in-memory mock for frontend development. The Express
API and MariaDB Prisma schema are present in this repository; mock mode does not
represent production authentication or data.

- Set `VITE_USE_MOCK=false` in `apps/web/.env` to switch to the real API at
  `VITE_API_URL`.
- The mock implements the student app's service interface for local UI work.
- `npm run verify:mock -w apps/web` exercises the mock layer (36 assertions
  covering auth, the exam lifecycle, scoring, and session resumption).

Use the repository's actual API routes and schemas when integrating the student
app; do not rely on mock behavior as evidence of server-side enforcement.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:web` | Start student app (port 5173) |
| `npm run dev:admin` | Start admin dashboard (port 5174) |
| `npm run dev:server` | Start API server (port 5000) |
| `npm run build` | Build all workspaces |
| `npm run lint` / `npm run typecheck` / `npm run test` | Run across every workspace |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed roles, permissions and sample data |
| `npm run db:studio` | Open Prisma Studio |

Additional server commands — `prisma:reset`, `prisma:deploy`, `routes`,
`check:db`, `smoke`, `verify`, `format` — are listed in
[server/README.md](server/README.md).

## Project Structure

```
cbt-platform/
├── apps/
│   ├── web/          # Student application
│   └── admin/        # Admin dashboard
├── server/           # API server (Express 5 + Prisma + MariaDB)
│   ├── prisma/       # Schema, migrations, seed
│   ├── src/          # config, middleware, modules, utils
│   ├── scripts/      # Diagnostics and smoke tests
│   └── tests/        # Vitest unit + integration
├── packages/
│   └── shared/       # Shared types and validation
└── docker-compose.yml  # MariaDB only, bound to loopback
```

## Web App Features

- Matriculation number sign-in (no self-registration)
- Protected routes via `ProtectedRoute`
- Dashboard with stats, available exams, and recent results
- Exam listing and detail views
- Timed exam engine with auto-save, auto-submit on timeout, and question palette
- Results with score breakdown and answer review
- Profile with admin-managed fields locked as read-only

## Current status

The older API status and frontend wiring notes in earlier revisions of this
README were stale. See the [commercial readiness audit](docs/COMMERCIAL_DEPLOYMENT_READINESS.md)
for repository evidence, current verification results, release blockers, and
deployment procedures. The central licensing service uses PostgreSQL; the
school CBT server remains on MariaDB.
