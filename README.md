# CBT Platform

A Computer Based Testing (CBT) platform monorepo for managing and delivering online exams to students.

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

The server is not built yet, so the student app runs against an in-memory data
layer by default. Any matric number of 3-20 letters, digits, `/` or `-` is
accepted, and a profile (name, program, level) is derived from it.

- Set `VITE_USE_MOCK=false` in `apps/web/.env` to switch to the real API at
  `VITE_API_URL`.
- The mock implements the same interface as the real API, so no page code changes
  are needed when the backend lands.
- `npm run verify:mock -w apps/web` exercises the mock layer (36 assertions
  covering auth, the exam lifecycle, scoring, and session resumption).

Once the backend enforces the real model, `POST /auth/login` should accept
`{ matricNumber }` and reject any matric that has not been provisioned by an
admin. The client already sends exactly that shape.

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

## API Status

Phase 1 is complete and verified against a live MariaDB:

- 18 Prisma models, 29 permissions, 6 roles
- 41 routes under `/api/v1` covering auth, users, students, categories, subjects,
  questions, exams (including publish/unpublish), audit logs and health
- Refresh-token rotation with replay detection, generic login failures,
  permission-guarded endpoints, and audit logging of all mutations
- 77 Vitest tests and a 51-check end-to-end smoke suite, all passing

Deferred to later phases: exam sessions, grading and results, settings, and
licensing.

The admin app's connection layer is wired and sign-in is verified end to end
against the live API, but the app is **not yet usable beyond the login screen**:
it was built against a hypothetical schema and disagrees with the backend on enum
casing (upper vs lower), on the permission vocabulary (14 coarse vs 29
fine-grained), and it calls a `/dashboard` endpoint that does not exist. The full
findings and the options for resolving them are in
[Wiring the frontends](server/README.md#wiring-the-frontends).

The student app (`apps/web`) is untouched and still points at port 3001.
