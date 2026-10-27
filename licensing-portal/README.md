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

The download button is not shown for a missing or non-HTTPS URL. Render Static Sites serve files from the published build output; they do not have a manual file-upload area, and the 146 MB installer must not be committed as a regular Git file. For a test download, upload the unsigned installer to an HTTPS file host such as a public object-storage bucket, then set the Render build variable to its direct download URL. Clearly keep that test build for internal testing only. Do not send it to clients. A signed, clean-install-validated client release is not available yet.

The portal only accepts the API origin configured in `PORTAL_ORIGIN`; keep the portal and API origins aligned. Development defaults to `http://127.0.0.1:18080` for the API. Restart Vite after changing environment configuration. For a production build, set `VITE_LICENSING_API_URL` to the public HTTPS API origin before running `npm run build`.
