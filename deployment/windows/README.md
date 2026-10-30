# Windows installer build

This directory contains the Windows release staging and Inno Setup project. The installer deploys the CBT student portal at `/`, staff portal at `/admin`, and API at `/api/v1` from one LAN origin. First installation runs the MariaDB installer, creates a local-only database account, applies Prisma migrations, creates the first super-admin, installs the CBT API as a Windows service, and opens TCP 5000 on Domain/Private firewall profiles. MariaDB remains bound to loopback.

## Build prerequisites

Use a clean Windows x64 release machine with Node.js 20.11 or newer, npm, PowerShell, and Inno Setup 6 installed. Obtain the following x64 distribution assets from their official project releases and verify their published signatures or checksums before use:

- Node.js Windows ZIP runtime (not the system installer)
- MariaDB Server Windows MSI
- WinSW v2.12.0 Windows service wrapper executable and its `LICENSE.txt` (use the .NET Framework build for Windows Server 2016+)
- The CBT licensing service's base64-encoded Ed25519 **public** key and its production HTTPS API origin

The installer does not contain the licensing private key. Keep the licensing public key and installer inputs in the release pipeline; do not put customer secrets in the payload.

## Stage a release

From the repository root, use a new semantic version for each release:

```powershell
.
deployment\windows\build-release.ps1 `
  -Version 1.0.0 `
  -NodeRuntimeZip deployment\windows\vendor\node-v24.22.1-win-x64.zip `
  -MariaDbMsi deployment\windows\vendor\mariadb-11.8.9-winx64.msi `
  -WinSwExe C:\release-inputs\WinSW.NET461.exe `
  -WinSwLicense C:\release-inputs\WinSW-LICENSE.txt `
  -NodeRuntimeSha256 d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5 `
  -MariaDbSha256 372822572baa7f429b9068d583336a9e46b109c12bb0b24eb66dbeb6ad0a563e `
  -WinSwSha256 b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f `
  -LicensingApiUrl https://licenses.your-domain.example `
  -LicensePublicKeyB64 $env:CBT_LICENSE_PUBLIC_KEY_B64
```

The hashes above pin Node.js v24.22.1 and MariaDB 11.8.9 to their official release metadata, and WinSW v2.12.0 to its official `WinSW.NET461.exe` release asset. The build stops if any binary differs from the pinned value. Use the WinSW binary and license from the same upstream release. The script builds both browser apps and the API, packages production server dependencies and Prisma migrations, and writes a payload checksum manifest under `deployment/windows/build/<version>/`. `VITE_BASE_PATH=/admin/` is applied to the staff portal build. Use an unused version directory; the script deliberately refuses to overwrite an existing release.

Compile `deployment/windows/CBT-Platform.iss` using Inno Setup Compiler with `CBT_RELEASE_VERSION` set to the staged version, for example:

```powershell
$env:CBT_RELEASE_VERSION = '1.0.0'
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" deployment\windows\CBT-Platform.iss
```

The default output is `deployment/windows/build/<version>/The-Platform-CBT-Setup-<version>.exe`, and it is usable without a code-signing certificate for trusted internal school deployments. Windows SmartScreen and endpoint protection may still require an administrator to approve a new unsigned executable; code signing is recommended for public commercial distribution.

If an older certificate-free build names the executable `*-unsigned.exe`, it contains the same unsigned code. Downloading and running only the installer generated from this repository's pinned source and checksum provides the recommended certificate-free deployment path.

## First installation

Run the setup as a Windows administrator. The installer selects and records a free local TCP port from **3307–3399**. If no MariaDB Windows service exists, the bundled MariaDB MSI opens its setup UI; keep the instance service name **CBTPlatformMariaDB** and the selected port, and set a strong root password. If exactly one compatible MariaDB service already exists, the installer uses its MariaDB instance utility to create a separate `CBTPlatformMariaDB` service and data directory on the selected port; it does not rerun or modify the existing service. If the existing database layout is ambiguous or unsupported, setup stops rather than guessing. This keeps the CBT database separate from existing MariaDB or Docker databases (including Docker's common host port 3306). The provisioning step securely prompts for the CBT database root password, then asks for the first staff email/name and a unique password of at least 12 characters. Credentials are passed to the bootstrap process through standard input and saved configuration is restricted to Administrators, SYSTEM, and the relevant service accounts. Provisioning failures are written to `%ProgramData%\The Platform CBT\logs\installer-provisioning.log`.

After installation:

- Staff sign in at `http://<server-LAN-address>:5000/admin/login`.
- Students use `http://<server-LAN-address>:5000/`.
- CBT's MariaDB service listens only on `127.0.0.1` at the selected port; the database port is not opened on the LAN. The installer adds an inbound rule for CBT port 5000 only on Domain and Private profiles.
- Same-origin browser requests work through the server's LAN IP or hostname; cross-origin requests remain restricted to the configured CORS allow-list.
- Configuration, uploads, logs, and backups live under `%ProgramData%\The Platform CBT`.

## Upgrade and uninstall

Before overwriting an existing installation, the installer stops the CBT service, runs `mariadb-dump`, verifies a non-empty SQL backup, and writes a SHA-256 sidecar in `%ProgramData%\The Platform CBT\backups`. If the backup fails, setup aborts before replacing application files. It then applies pending Prisma migrations and restarts the service. Upgrades preserve the existing `DATABASE_URL` and MariaDB service, including legacy installs using port 3306; they do not move or reconfigure databases. Keep the last known-good installer and verified database backup for manual rollback; the installer does not automatically reverse a database migration.

Uninstall removes the CBT Windows service and the port 5000 firewall rule. It deliberately retains MariaDB, its database, `%ProgramData%` configuration, uploads, and backups. Purge retained data only after an operator has exported the school's records and explicitly approved removal.

## Release validation still required

This is an unsigned installer build pipeline, not yet a commercial release certification. Before client delivery, build it on the release machine, verify all third-party asset checksums and license notices, test clean installation/reboot/service recovery on a clean Windows Server VM, join a second machine to the school LAN and test both portals, test an upgrade with real data and restore the generated backup, test uninstall retention, and sign/timestamp the final installer. The Prisma schema and installer have not been exercised together on a clean Windows VM in this repository session.
