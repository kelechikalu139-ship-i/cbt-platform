# Licensing portal

This is the product-owner portal for the central licensing service. It includes administrator sign-in, invitation-based registration, the license dashboard, audit history, and super-admin account management.

## Local setup

1. Start PostgreSQL and configure `licensing-service/.env` with the local database, signing keys, a JWT secret, `LICENSE_ADMIN_EMAIL`, and `PORTAL_ORIGIN=http://127.0.0.1:5173`.
2. In a terminal, apply the schema and create a one-time setup link:

   ```powershell
   cd licensing-service
   npm.cmd run db:setup
   npm.cmd run admin:bootstrap
   ```

   The command prints a setup URL bound to `LICENSE_ADMIN_EMAIL`. It expires after 30 minutes and works only while no admin account exists. Treat the link as a secret.
   If an admin account already exists, bootstrap is closed. To recover the existing sole super-admin, set the desired `LICENSE_ADMIN_EMAIL` and use `npm.cmd run admin:recover`; it securely prompts for a new password and updates that account.
3. Generate the local MFA encryption key before starting the licensing API (after pulling this MFA change, run the schema setup command from step 2 again):

   ```powershell
   npm.cmd run mfa:key:setup
   ```

   Keep `MFA_ENCRYPTION_KEY_B64` in `licensing-service/.env` stable and backed up. Losing or rotating it makes enrolled authenticator secrets unreadable. Every administrator must enroll a TOTP authenticator at their next sign-in by scanning the QR code or entering the displayed setup key; each account receives one-time recovery codes to save. Later sign-ins first check the email and password, then show a separate MFA page. To recover a locked-out local super-admin, run `npm.cmd run admin:mfa:reset`, then sign in and enroll again. This reset command is development-only and requires the configured super-admin email.

   If setup rejects a code, sign in again to generate a fresh QR/setup key, scan it, and enter a newly generated code before it changes. Ensure the computer and phone clocks are set automatically.

4. Start the licensing API in that terminal:

   ```powershell
   $env:PORT = '18080'
   npm.cmd run dev
   ```

5. In a second terminal, configure and start the portal:

   ```powershell
   cd licensing-portal
   Copy-Item .env.example .env.local
   npm.cmd install
   npm.cmd run dev
   ```

6. Open the one-time setup URL to register the first super-admin. After that, the portal shows only sign-in; the super-admin can create staff invitation links from **Administrator access** on the dashboard.

## Deploy to Render with Neon

Follow [the Render and Neon deployment guide](../docs/RENDER_NEON_DEPLOYMENT.md). The key Render setting for this monorepo is to set the portal Static Site's Root Directory to `licensing-portal` and its Publish Directory to `dist`. Deploy the API as a separate Node Web Service rooted at `licensing-service`.

## CBT client installation

The portal issues activation credentials. Host the installer at a stable HTTPS URL, set `VITE_CBT_INSTALLER_URL` to that URL in the Render Static Site's build environment, and redeploy. When issuing a licence, administrators can download the installer from the confirmation panel and send it to the customer through an approved channel with the activation key. The URL is embedded in the public frontend build, so it must not contain credentials or be treated as an access-control mechanism.

The CBT download button uses its existing release lookup and `VITE_CBT_INSTALLER_URL` configuration. Render Static Sites serve files from the published build output; they do not have a manual file-upload area, and the 146 MB installer must not be committed as a regular Git file. For a test download, upload the unsigned installer to an HTTPS file host such as a public object-storage bucket, then set the Render build variable to its direct download URL. Clearly keep that test build for internal testing only. Do not send it to clients. A signed, clean-install-validated client release is not available yet.

## CAOSCE client installation

The dashboard offers a separate CAOSCE installer control with a direct versioned URL to the CAOSCE pre-release asset in the public CBT release repository. It does not use or replace the latest CBT release. `VITE_CAOSCE_INSTALLER_URL` can override the default with another direct HTTPS installer URL.

The CAOSCE installer includes the compiled API and Admin, Examiner, and Student portals, plus the pinned MariaDB installer. It requires Windows 10/11 x64, Node.js 20+, and administrator approval. Setup provisions a separate `CAOSCEPlatformMariaDB` service and `caosce_manager` database under ProgramData, bound only to loopback on a dedicated port; it does not reuse or alter the CBT database service or schema. Upgrading from v1.0.1 retains the prior `.env` in a restricted backup but does not migrate data from the old external database. The CAOSCE database service, MariaDB runtime, and data persist after uninstall. Its desktop shortcut uses the CAOSCE project icon, starts the API in the background, and opens the Admin login; Start Menu shortcuts launch each portal. The installer applies database migrations, but the CAOSCE app does not yet enforce product keys issued by this portal.

The licence service now issues separate `nurse-cbt` and `caosce-platform` product keys using the existing `NCBT-XXXXX-...` key format, and signs the corresponding product ID into each licence. Existing CBT rows are kept as `nurse-cbt`; the service adds the product column and replaces the institution-wide open-licence constraint with a per-product constraint at startup. The portal can therefore issue both products to one institution while preventing duplicate open licences for the same product. CAOSCE app-side activation/enforcement is not yet integrated: its client must validate the `caosce-platform` signed licence before these keys enforce access in that application.

The portal only accepts the API origin configured in `PORTAL_ORIGIN`; keep the portal and API origins aligned. Development defaults to `http://127.0.0.1:18080` for the API. Restart Vite after changing environment configuration. For a production build, set `VITE_LICENSING_API_URL` to the public HTTPS API origin before running `npm run build`.

## Licensing service integration tests

From the repository root, run `npm --prefix licensing-service run test:integration`. The runner applies the schema and enables the HTTP/PostgreSQL integration tests only when `DATABASE_URL` targets the local `cbt_licensing_platform` test database; it refuses remote or differently named databases. Configure a local PostgreSQL database before running it.
