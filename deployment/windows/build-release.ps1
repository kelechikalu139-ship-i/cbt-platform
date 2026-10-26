[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidatePattern('^\d+\.\d+\.\d+$')] [string] $Version,
  [Parameter(Mandatory)] [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })] [string] $NodeRuntimeZip,
  [Parameter(Mandatory)] [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })] [string] $MariaDbMsi,
  [Parameter(Mandatory)] [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })] [string] $WinSwExe,
  [Parameter(Mandatory)] [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })] [string] $WinSwLicense,
  [Parameter(Mandatory)] [ValidatePattern('^[A-Fa-f0-9]{64}$')] [string] $NodeRuntimeSha256,
  [Parameter(Mandatory)] [ValidatePattern('^[A-Fa-f0-9]{64}$')] [string] $MariaDbSha256,
  [Parameter(Mandatory)] [ValidatePattern('^[A-Fa-f0-9]{64}$')] [string] $WinSwSha256,
  [Parameter(Mandatory)] [string] $LicensingApiUrl,
  [Parameter(Mandatory)] [string] $LicensePublicKeyB64
)

$ErrorActionPreference = 'Stop'

function Assert-InputHash([string] $Path, [string] $Expected, [string] $Name) {
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if (-not $actual.Equals($Expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Name SHA-256 does not match the value supplied for this release."
  }
}

Assert-InputHash $NodeRuntimeZip $NodeRuntimeSha256 'Node runtime'
Assert-InputHash $MariaDbMsi $MariaDbSha256 'MariaDB installer'
Assert-InputHash $WinSwExe $WinSwSha256 'WinSW service wrapper'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$buildRoot = Join-Path $PSScriptRoot 'build'
$releaseRoot = Join-Path $buildRoot $Version
$payloadRoot = Join-Path $releaseRoot 'payload'
if (Test-Path -LiteralPath $releaseRoot) {
  throw "Release directory already exists; choose a new version or move it manually: $releaseRoot"
}

try {
  $licensePem = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($LicensePublicKeyB64))
  if ($licensePem -notmatch '-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----') { throw 'invalid PEM' }
} catch {
  throw 'LicensePublicKeyB64 must be base64-encoded PEM from the CBT licensing service public key.'
}
if (-not $LicensingApiUrl.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'LicensingApiUrl must use HTTPS.'
}
if ($LicensingApiUrl -match 'licenses\.example\.com') { throw 'Set LicensingApiUrl to the live licensing service hostname.' }
$previousPublicKey = $env:CBT_BUILD_PUBLIC_KEY_B64
try {
  $env:CBT_BUILD_PUBLIC_KEY_B64 = $LicensePublicKeyB64
  node.exe -e "const c=require('node:crypto');const k=c.createPublicKey(Buffer.from(process.env.CBT_BUILD_PUBLIC_KEY_B64,'base64').toString());if(k.asymmetricKeyType!=='ed25519')process.exit(2)"
  if ($LASTEXITCODE -ne 0) { throw 'LicensePublicKeyB64 must contain an Ed25519 public key.' }
} catch { throw 'Could not validate LicensePublicKeyB64 with Node.js; use a valid Ed25519 public key.' }
finally {
  if ($null -eq $previousPublicKey) { Remove-Item Env:CBT_BUILD_PUBLIC_KEY_B64 -ErrorAction SilentlyContinue }
  else { $env:CBT_BUILD_PUBLIC_KEY_B64 = $previousPublicKey }
}

New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
$serverRoot = Join-Path $payloadRoot 'server'
$publicRoot = Join-Path $serverRoot 'public'
$studentPublicRoot = Join-Path $publicRoot 'student'
$adminPublicRoot = Join-Path $publicRoot 'admin'
$toolsRoot = Join-Path $payloadRoot 'tools'
$prerequisitesRoot = Join-Path $payloadRoot 'prerequisites'
$setupRoot = Join-Path $payloadRoot 'setup'
New-Item -ItemType Directory -Path $serverRoot, $publicRoot, $studentPublicRoot, $adminPublicRoot, $toolsRoot, $prerequisitesRoot, $setupRoot -Force | Out-Null

$previousDatabaseUrl = $env:DATABASE_URL
Push-Location $repoRoot
try {
  npm.cmd run prisma:generate --workspace=server
  if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
  npm.cmd run build:server
  if ($LASTEXITCODE -ne 0) { throw 'Server build failed.' }
  npm.cmd run build:web
  if ($LASTEXITCODE -ne 0) { throw 'Student portal build failed.' }
  $previousBasePath = $env:VITE_BASE_PATH
  try {
    $env:VITE_BASE_PATH = '/admin/'
    npm.cmd run build:admin
    if ($LASTEXITCODE -ne 0) { throw 'Admin portal build failed.' }
  } finally {
    if ($null -eq $previousBasePath) { Remove-Item Env:VITE_BASE_PATH -ErrorAction SilentlyContinue }
    else { $env:VITE_BASE_PATH = $previousBasePath }
  }

  Copy-Item -LiteralPath 'server\dist' -Destination (Join-Path $serverRoot 'dist') -Recurse
  Copy-Item -LiteralPath 'server\prisma' -Destination (Join-Path $serverRoot 'prisma') -Recurse
  Copy-Item -LiteralPath 'server\prisma.config.ts' -Destination (Join-Path $serverRoot 'prisma.config.ts')
  Copy-Item -LiteralPath 'server\scripts\bootstrap-installation.mjs' -Destination (Join-Path $serverRoot 'bootstrap-installation.mjs')
  Copy-Item -Path 'apps\web\dist\*' -Destination $studentPublicRoot -Recurse
  Copy-Item -Path 'apps\admin\dist\*' -Destination $adminPublicRoot -Recurse

  # Build a lean production dependency tree in the release payload. Prisma CLI
  # is retained because the installer uses `migrate deploy` on first install
  # and before upgrades; all other development dependencies are omitted.
  $runtimePackage = Get-Content 'server\package.json' -Raw | ConvertFrom-Json
  $runtimePackage.devDependencies = @{}
  $runtimePackage.dependencies | Add-Member -NotePropertyName prisma -NotePropertyValue '7.10.0' -Force
  $runtimePackage.scripts = @{}
  [IO.File]::WriteAllText((Join-Path $serverRoot 'package.json'), ($runtimePackage | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
  $env:DATABASE_URL = 'mysql://cbt_app:release-build@127.0.0.1:3306/cbt_system'
  npm.cmd install --omit=dev --prefix $serverRoot --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Production server dependency installation failed.' }
  Push-Location $serverRoot
  try {
    node .\node_modules\prisma\build\index.js generate --config .\prisma.config.ts
    if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation for the release failed.' }
  } finally { Pop-Location }
} finally {
  if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
  else { $env:DATABASE_URL = $previousDatabaseUrl }
  Pop-Location
}

$nodeExtract = Join-Path $releaseRoot 'node-runtime'
Expand-Archive -LiteralPath (Resolve-Path $NodeRuntimeZip) -DestinationPath $nodeExtract
$nodeExe = Get-ChildItem -LiteralPath $nodeExtract -Filter node.exe -File -Recurse | Select-Object -First 1
if (-not $nodeExe) { throw 'Node runtime ZIP does not contain node.exe.' }
$runtimeInfo = (& $nodeExe.FullName -p 'JSON.stringify({version:process.versions.node,arch:process.arch})' | ConvertFrom-Json)
if ([version]$runtimeInfo.version -lt [version]'20.11.0' -or $runtimeInfo.arch -ne 'x64') {
  throw "Node runtime must be x64 version 20.11.0 or newer (found $($runtimeInfo.version)/$($runtimeInfo.arch))."
}
$runtimeDir = Join-Path $payloadRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Copy-Item -LiteralPath $nodeExe.Directory.FullName -Destination (Join-Path $runtimeDir 'node') -Recurse
Copy-Item -LiteralPath (Resolve-Path $MariaDbMsi) -Destination (Join-Path $prerequisitesRoot 'mariadb.msi')
Copy-Item -LiteralPath (Resolve-Path $WinSwExe) -Destination (Join-Path $toolsRoot 'cbt-service.exe')
Copy-Item -LiteralPath (Resolve-Path $WinSwLicense) -Destination (Join-Path $toolsRoot 'WinSW-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-CBT.ps1') -Destination (Join-Path $setupRoot 'Install-CBT.ps1')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Prepare-Upgrade.ps1') -Destination (Join-Path $setupRoot 'Prepare-Upgrade.ps1')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Uninstall-CBT.ps1') -Destination (Join-Path $setupRoot 'Uninstall-CBT.ps1')

$values = [ordered]@{
  version = $Version
  licensingApiUrl = $LicensingApiUrl.TrimEnd('/')
  licensePublicKeyB64 = $LicensePublicKeyB64
}
$values | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $setupRoot 'deployment-values.json') -Encoding utf8

$manifest = Get-ChildItem -LiteralPath $payloadRoot -File -Recurse | ForEach-Object {
  $relative = [IO.Path]::GetRelativePath($payloadRoot, $_.FullName).Replace('\', '/')
  '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
}
$manifest | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding utf8
Write-Host "Release payload staged at $releaseRoot"
Write-Host 'Compile deployment/windows/CBT-Platform.iss with Inno Setup Compiler to produce the installer.'
