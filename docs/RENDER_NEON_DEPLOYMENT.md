# Deploy the licensing portal and API to Render with Neon

The licensing portal is a static Vite site. The licensing service is a Node/Express web service with a PostgreSQL connection. Neon hosts the database; it does not host either app. The repository is already linked locally to Neon project `cbt_licensing_platform`, branch `production`. The Neon CLI put its pooled and unpooled URLs in the ignored repository-root `.env.local`.

## Fix the portal publish-directory error

Render paths are relative to each service's root directory. Pick one of these matching configurations; do not mix the root-directory and repository-root paths.

**Recommended: set a root directory.** In the portal Static Site's Settings → Build & Deploy:

- Root Directory: `licensing-portal`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`

The supplied build log proves Vite built `dist/index.html`; this configuration makes Render look for `dist` in the same `licensing-portal` directory where Vite wrote it. If you leave Root Directory blank instead, use build command `cd licensing-portal && npm install && npm run build` and Publish Directory `licensing-portal/dist`.

Add the portal build environment variable:

```text
VITE_LICENSING_API_URL=https://<licensing-api-service>.onrender.com
```

Vite embeds this value into the browser bundle at build time, so save it and redeploy the Static Site after setting it. It must be the API's HTTPS origin, with no `/api` suffix.

## Create the licensing API Web Service

In Render, choose New → Web Service and connect the same GitHub repository and `main` branch. Set:

- Root Directory: `licensing-service`
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Render provides `PORT`; the API binds to it on `0.0.0.0`. Once the first deploy creates the service URL, use that URL for the portal's `VITE_LICENSING_API_URL` above.

Set these variables on the API service in Render. Keep secret values in Render's Environment page, not in Git or the portal's environment:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled URL from the Neon dashboard / repo-root `.env.local`; it contains a credential, so do not paste it into chat or commit it |
| `PGSSL` | `true` |
| `EXPECTED_DATABASE_NAME` | `neondb` (only used by local DB-check/setup scripts; safe to omit in Render) |
| `DB_POOL_SIZE` | `5` |
| `JWT_SECRET` | A newly generated random secret, at least 32 characters; do not reuse the local `.env` value |
| `MFA_ENCRYPTION_KEY_B64` | A separate random 32-byte key encoded as Base64 |
| `LICENSE_PRIVATE_KEY_B64` | Production Ed25519 private key, Base64 encoded; API secret only |
| `LICENSE_PUBLIC_KEY_B64` | Matching Ed25519 public key, Base64 encoded |
| `PORTAL_ORIGIN` | Exact portal origin, e.g. `https://<licensing-portal-service>.onrender.com` |

The API service must be deployed first so Render assigns its public URL. Then set the portal's `VITE_LICENSING_API_URL`, build/deploy the portal, and set the API's `PORTAL_ORIGIN` to the portal's assigned URL. Redeploy the API after changing `PORTAL_ORIGIN`.

## Neon database status and local connection

The project is linked to branch `production`. The API uses the standard `pg` driver and Neon Postgres, not the CBT platform's local MariaDB. Neon recommends the pooled connection string for application traffic. Do not enable Neon Auth or Data API for this service: the app already has Express endpoints and admin authentication.

For local verification, `licensing-service/.env` now uses the Neon pooled URL, `PGSSL=true`, and `EXPECTED_DATABASE_NAME=neondb`. The former local URL is commented there so it can be restored for local-only work. The repository-root `.env.local` is gitignored and is the Neon CLI's source; do not commit it. The production Render service must receive its own environment values through the Render dashboard.

The production branch already has the licensing schema and expected indexes. `npm run db:check` confirms the connection and schema. Avoid running integration tests against this production branch; the integration tests are restricted to a loopback database. The API's `/health` endpoint returns database connectivity status.

## First admin and deployment verification

After both Render services are live:

1. Confirm `https://<licensing-api-service>.onrender.com/health` returns HTTP 200 with `database: connected`.
2. Set `LICENSE_ADMIN_EMAIL` temporarily in the API service environment, with `PORTAL_ORIGIN` set to the portal's exact origin. Run `npm run admin:bootstrap` once from an authorized environment connected to Neon; it prints a single-use Super Admin setup URL that expires after 30 minutes. Keep that URL private and open it in the portal. Remove the temporary `LICENSE_ADMIN_EMAIL` afterward if desired.
3. Sign in, enroll MFA, and verify an invitation and license issue/activation flow using a test institution.
4. Confirm a different browser origin is rejected by CORS and logs do not expose database or key values.

The root `.env.local`, `licensing-service/.env`, and `licensing-portal/.env` are local files and must not be uploaded to GitHub. Set production values through Render's dashboard. Do not put the license private key in the portal, Windows installer, or customer CBT server.
