[CmdletBinding()]
param([Parameter(Mandatory)][string] $InstallRoot)

$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$dataRoot = Join-Path $env:ProgramData 'The Platform CBT'
$configPath = Join-Path $dataRoot '.env'
$completeMarker = Join-Path $dataRoot 'install-complete'
$serverRoot = Join-Path $InstallRoot 'server'
$nodeExe = Join-Path $InstallRoot 'runtime\node\node.exe'
$winSw = Join-Path $InstallRoot 'tools\cbt-service.exe'
$deployment = Get-Content (Join-Path $InstallRoot 'setup\deployment-values.json') -Raw | ConvertFrom-Json

function Set-RestrictedAcl([string] $Path, [string] $ServicePermission) {
  $isDirectory = (Get-Item -LiteralPath $Path).PSIsContainer
  $inherit = if ($isDirectory) { '(OI)(CI)' } else { '' }
  & icacls.exe $Path /inheritance:r /grant:r "SYSTEM:${inherit}F" "BUILTIN\Administrators:${inherit}F" "NT AUTHORITY\LOCAL SERVICE:${inherit}$ServicePermission" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not secure permissions on $Path" }
}

function Get-PlainText([Security.SecureString] $Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-RandomHex([int] $ByteCount) {
  $bytes = [byte[]]::new($ByteCount)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToHexString($bytes).ToLowerInvariant()
}

function Write-InstallationConfig {
  New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
  $uploads = Join-Path $dataRoot 'uploads'
  $logs = Join-Path $dataRoot 'logs'
  New-Item -ItemType Directory -Path $uploads, $logs, (Join-Path $dataRoot 'backups') -Force | Out-Null
  Set-RestrictedAcl $dataRoot 'RX'
  Set-RestrictedAcl $uploads 'M'
  Set-RestrictedAcl $logs 'M'
  Set-RestrictedAcl (Join-Path $dataRoot 'backups') 'M'

  $dbPassword = New-RandomHex 32
  $apiSecret = New-RandomHex 48
  $refreshSecret = New-RandomHex 48
  $lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if (-not $lanAddress) { $lanAddress = 'localhost' }
  $lines = @(
    'NODE_ENV=production',
    'PORT=5000',
    'HOST=0.0.0.0',
    'APP_NAME="The Platform CBT"',
    "APP_VERSION=$($deployment.version)",
    "DATABASE_URL=`"mysql://cbt_app:$dbPassword@127.0.0.1:3306/cbt_system`"",
    'DATABASE_POOL_SIZE=10',
    'DATABASE_CONNECT_TIMEOUT_MS=10000',
    "LICENSING_API_URL=$($deployment.licensingApiUrl)",
    "LICENSE_PUBLIC_KEY_B64=$($deployment.licensePublicKeyB64)",
    "JWT_ACCESS_SECRET=$apiSecret",
    "JWT_REFRESH_SECRET=$refreshSecret",
    'JWT_ACCESS_EXPIRES_IN=15m',
    'JWT_REFRESH_EXPIRES_IN=7d',
    'BCRYPT_SALT_ROUNDS=12',
    "CORS_ORIGIN=`"http://localhost:5000,http://127.0.0.1:5000,http://${lanAddress}:5000`"",
    'LOG_LEVEL=info',
    'LOG_PRETTY=false',
    "UPLOAD_DIR=`"$uploads`"",
    "STUDENT_APP_DIR=`"$(Join-Path $serverRoot 'public\student')`"",
    "ADMIN_APP_DIR=`"$(Join-Path $serverRoot 'public\admin')`"",
    'MAX_UPLOAD_SIZE_MB=5',
    'AUTH_RATE_LIMIT_WINDOW_MS=900000',
    'AUTH_RATE_LIMIT_MAX=10',
    'GLOBAL_RATE_LIMIT_WINDOW_MS=60000',
    'GLOBAL_RATE_LIMIT_MAX=3000'
  )
  [IO.File]::WriteAllLines($configPath, $lines, [Text.UTF8Encoding]::new($false))
  Set-RestrictedAcl $configPath 'R'
  return $dbPassword
}

function Set-MariaDbLoopback {
  $serviceQuery = (& sc.exe qc MariaDB 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'The MariaDB service was not found. Install MariaDB before continuing.' }
  $imageMatch = [regex]::Match($serviceQuery, '(?im)BINARY_PATH_NAME:\s*(.+)$')
  $iniPath = $null
  if ($imageMatch.Success) {
    $defaultsMatch = [regex]::Match($imageMatch.Groups[1].Value, '--defaults-file=(?:"([^"]+)"|(\S+))')
    if ($defaultsMatch.Success) { $iniPath = if ($defaultsMatch.Groups[1].Success) { $defaultsMatch.Groups[1].Value } else { $defaultsMatch.Groups[2].Value } }
  }
  if (-not $iniPath -or -not (Test-Path -LiteralPath $iniPath)) {
    $ini = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'MariaDB*') -Filter 'my.ini' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ini) { $iniPath = $ini.FullName }
  }
  if (-not $iniPath) { throw 'Could not find the MariaDB my.ini file to restrict the database listener to this computer.' }

  $content = [IO.File]::ReadAllText($iniPath)
  if ($content -match '(?im)^\s*\[mysqld\]\s*$') {
    $section = [regex]::Match($content, '(?ims)^\[mysqld\]\s*$(.*?)(?=^\[|\z)')
    if ($section.Success -and $section.Groups[1].Value -match '(?im)^\s*bind-address\s*=') {
      $start = $section.Groups[1].Index
      $body = [regex]::Replace($section.Groups[1].Value, '(?im)^\s*bind-address\s*=.*$', 'bind-address=127.0.0.1')
      $content = $content.Substring(0, $start) + $body + $content.Substring($start + $section.Groups[1].Length)
    } else {
      $content = [regex]::Replace($content, '(?im)^\[mysqld\]\s*$', "`$0`r`nbind-address=127.0.0.1", 1)
    }
  } else { $content += "`r`n[mysqld]`r`nbind-address=127.0.0.1`r`n" }
  [IO.File]::WriteAllText($iniPath, $content, [Text.UTF8Encoding]::new($false))
  Restart-Service -Name MariaDB -Force
  (Get-Service MariaDB).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
}

function Read-InstallCredentials {
  $email = (Read-Host 'First administrator email').Trim().ToLowerInvariant()
  if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Enter a valid administrator email address.' }
  $first = (Read-Host 'First administrator given name').Trim()
  $last = (Read-Host 'First administrator family name').Trim()
  if (-not $first -or -not $last) { throw 'Administrator name fields cannot be empty.' }
  $password = Read-Host 'Choose the first administrator password (at least 12 characters)' -AsSecureString
  $confirm = Read-Host 'Confirm the administrator password' -AsSecureString
  $plainPassword = Get-PlainText $password
  $plainConfirm = Get-PlainText $confirm
  if ($plainPassword.Length -lt 12 -or $plainPassword -cne $plainConfirm) { throw 'Passwords must match and contain at least 12 characters.' }
  $rootSecure = Read-Host 'MariaDB root password you set in the MariaDB installer' -AsSecureString
  return @{
    email = $email; firstName = $first; lastName = $last
    password = $plainPassword; rootPassword = Get-PlainText $rootSecure
  }
}

function Invoke-SetupBootstrap($Credentials, [string] $DatabasePassword) {
  $request = @{
    installRoot = $InstallRoot
    configDirectory = $dataRoot
    databaseRootPassword = $Credentials.rootPassword
    databasePassword = $DatabasePassword
    adminEmail = $Credentials.email
    adminFirstName = $Credentials.firstName
    adminLastName = $Credentials.lastName
    adminPassword = $Credentials.password
  } | ConvertTo-Json -Compress
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $nodeExe
  $start.Arguments = ('"{0}"' -f (Join-Path $serverRoot 'bootstrap-installation.mjs'))
  $start.WorkingDirectory = $dataRoot
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.CreateNoWindow = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  [void]$process.Start()
  $process.StandardInput.WriteLine($request)
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($stdout) { Write-Host $stdout.TrimEnd() }
  if ($process.ExitCode -ne 0) { throw "Initial database setup failed. $($stderr.Trim())" }
}

function Install-CbtService {
  $wrapperConfig = Join-Path (Split-Path $winSw -Parent) 'cbt-service.xml'
  $xml = @"
<service>
  <id>CBTPlatform</id>
  <name>The Platform CBT</name>
  <description>School CBT exam server and LAN portals.</description>
  <executable>$([Security.SecurityElement]::Escape($nodeExe))</executable>
  <arguments>"$([Security.SecurityElement]::Escape((Join-Path $serverRoot 'dist\server.js')) )"</arguments>
  <workingdirectory>$([Security.SecurityElement]::Escape($dataRoot))</workingdirectory>
  <startmode>Automatic</startmode>
  <depend>MariaDB</depend>
  <onfailure action="restart" delay="10 sec" />
  <serviceaccount>
    <username>NT AUTHORITY\LocalService</username>
  </serviceaccount>
  <logpath>$([Security.SecurityElement]::Escape((Join-Path $dataRoot 'logs')))</logpath>
  <log mode="roll" />
</service>
"@
  [IO.File]::WriteAllText($wrapperConfig, $xml, [Text.UTF8Encoding]::new($false))
  if (Get-Service CBTPlatform -ErrorAction SilentlyContinue) {
    & $winSw stop
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the existing CBT service.' }
    & $winSw uninstall
    if ($LASTEXITCODE -ne 0) { throw 'Could not update the existing CBT service registration.' }
  }
  & $winSw install
  if ($LASTEXITCODE -ne 0) { throw 'Could not register the CBT Windows service.' }
  & $winSw start
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the CBT Windows service.' }
  (Get-Service CBTPlatform).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $winSw)) {
  throw 'The installer payload is incomplete (Node runtime or service wrapper is missing).'
}

if ((Test-Path -LiteralPath $configPath) -and (Test-Path -LiteralPath $completeMarker)) {
  # Inno Setup's pre-install hook takes and verifies the database backup before
  # replacing files. Here we apply migrations, then bring the service back.
  try {
    $envLines = Get-Content -LiteralPath $configPath
    foreach ($line in $envLines) {
      if ($line -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"'), 'Process') }
    }
    $service = Get-Service CBTPlatform -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Stopped') { Stop-Service CBTPlatform -Force }
    & $nodeExe (Join-Path $serverRoot 'node_modules\prisma\build\index.js') migrate deploy --config (Join-Path $serverRoot 'prisma.config.ts')
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed with exit code $LASTEXITCODE." }
    Install-CbtService
  } catch {
    if (Get-Service CBTPlatform -ErrorAction SilentlyContinue) { Start-Service CBTPlatform -ErrorAction SilentlyContinue }
    throw
  }
} else {
  $maria = Get-Service MariaDB -ErrorAction SilentlyContinue
  if (-not $maria) { throw 'MariaDB is not installed. Complete the bundled MariaDB setup first.' }
  if ($maria.Status -ne 'Running') { Start-Service MariaDB }
  Set-MariaDbLoopback
  $credentials = Read-InstallCredentials
  if (Test-Path -LiteralPath $configPath) {
    $databaseLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if (-not $databaseLine -or $databaseLine -notmatch 'cbt_app:([a-f0-9]{64})@') { throw 'The incomplete setup has no recoverable generated database password.' }
    $databasePassword = $Matches[1]
  } else {
    $databasePassword = Write-InstallationConfig
  }
  Invoke-SetupBootstrap $credentials $databasePassword
  Install-CbtService
}

try {
  New-NetFirewallRule -DisplayName 'The Platform CBT web access' -Direction Inbound -Protocol TCP -LocalPort 5000 -Profile Domain,Private -Action Allow -ErrorAction Stop | Out-Null
} catch {
  if ($_.Exception.Message -notmatch 'already exists') { throw }
}

$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $null = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/v1/health' -TimeoutSec 2
    $healthy = $true
    break
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) { throw "CBT service is installed but health check failed. Review $dataRoot\logs for details." }
if (-not (Test-Path -LiteralPath $completeMarker)) {
  [IO.File]::WriteAllText($completeMarker, "Installed $($deployment.version)`r`n", [Text.UTF8Encoding]::new($false))
  Set-RestrictedAcl $completeMarker 'R'
}

Write-Host "CBT platform is ready. Staff: http://localhost:5000/admin/login  Student portal: http://localhost:5000/"
