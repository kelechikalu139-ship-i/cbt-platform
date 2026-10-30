[CmdletBinding()]
param(
  [Parameter(Mandatory)][string] $InstallRoot,
  [ValidateRange(0, 65535)][int] $DatabasePort = 0,
  [string] $CredentialsFile,
  [switch] $UseExistingMariaDbRuntime
)

$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$dataRoot = Join-Path $env:ProgramData 'The Platform CBT'
$configPath = Join-Path $dataRoot '.env'
$completeMarker = Join-Path $dataRoot 'install-complete'
$serverRoot = Join-Path $InstallRoot 'server'
$nodeExe = Join-Path $InstallRoot 'runtime\node\node.exe'
$winSw = Join-Path $InstallRoot 'tools\cbt-service.exe'
$deployment = Get-Content (Join-Path $InstallRoot 'setup\deployment-values.json') -Raw | ConvertFrom-Json
$databasePort = if ($DatabasePort -gt 0) { $DatabasePort } else { [int]$deployment.databasePort }
$databaseServiceName = [string]$deployment.databaseServiceName
if (($databasePort -lt 3307 -or $databasePort -gt 3399) -or $databaseServiceName -ne 'CBTPlatformMariaDB') {
  throw 'The installer database settings are invalid or unsupported.'
}

function Set-RestrictedAcl([string] $Path, [string] $ServicePermission) {
  $isDirectory = (Get-Item -LiteralPath $Path).PSIsContainer
  & icacls.exe $Path /grant '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
  $acl = Get-Acl -LiteralPath $Path
  $credentials = $null
  $databasePassword = $null
  try {
    $administratorsSid = [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
    $acl.SetOwner($administratorsSid)
    Set-Acl -LiteralPath $Path -AclObject $acl
    $acl = Get-Acl -LiteralPath $Path
  } catch {
    & takeown.exe /F $Path /A | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not take ownership of $Path" }
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not reset permissions on $Path" }
    $acl = Get-Acl -LiteralPath $Path
  }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
  $inheritance = if ($isDirectory) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else { [Security.AccessControl.InheritanceFlags]::None }
  foreach ($identity in @('SYSTEM', 'BUILTIN\Administrators')) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  }
  $serviceRights = switch ($ServicePermission) {
    'M' { [Security.AccessControl.FileSystemRights]::Modify }
    'F' { [Security.AccessControl.FileSystemRights]::FullControl }
    default { [Security.AccessControl.FileSystemRights]::ReadAndExecute }
  }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('NT AUTHORITY\LOCAL SERVICE', $serviceRights, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Grant-ServiceAccountAccess([string] $Path, [string] $Identity, [Security.AccessControl.FileSystemRights] $Rights) {
  $acl = Get-Acl -LiteralPath $Path
  $inheritance = if ((Get-Item -LiteralPath $Path).PSIsContainer) {
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else { [Security.AccessControl.InheritanceFlags]::None }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Identity, $Rights, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  Set-Acl -LiteralPath $Path -AclObject $acl
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
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
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
    "DATABASE_URL=`"mysql://cbt_app:$dbPassword@127.0.0.1:$databasePort/cbt_system`"",
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

function Get-MariaDbServiceImage([string] $ServiceName) {
  $serviceInfo = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
  if (-not $serviceInfo) { throw "The $ServiceName service was not found." }
  $imagePath = [string]$serviceInfo.PathName
  if ([string]::IsNullOrWhiteSpace($imagePath)) { throw "Could not read the $ServiceName service executable path." }
  return $imagePath.Trim()
}

function Get-MariaDbIniPath([string] $ServiceName) {
  $imagePath = Get-MariaDbServiceImage $ServiceName
  $defaultsMatch = [regex]::Match($imagePath, '(?:--defaults-file=|\bdefaults-file=)(?:"([^"]+)"|(\S+))', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $defaultsMatch.Success) {
    throw "The $ServiceName service does not identify its MariaDB configuration file."
  }
  $iniPath = if ($defaultsMatch.Groups[1].Success) { $defaultsMatch.Groups[1].Value } else { $defaultsMatch.Groups[2].Value.Trim('"') }
  if (-not (Test-Path -LiteralPath $iniPath -PathType Leaf)) {
    throw "Could not find the MariaDB configuration file for $ServiceName at $iniPath."
  }
  return $iniPath
}

function Set-MariaDbLoopback([string] $ServiceName, [int] $Port) {
  $imagePath = Get-MariaDbServiceImage $ServiceName
  $defaultsMatch = [regex]::Match($imagePath, '(?:--defaults-file=|\bdefaults-file=)(?:"([^"]+)"|(\S+))', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $defaultsMatch.Success) { throw "The $ServiceName service does not identify its MariaDB configuration file." }
  $iniPath = if ($defaultsMatch.Groups[1].Success) { $defaultsMatch.Groups[1].Value } else { $defaultsMatch.Groups[2].Value.Trim('"') }
  $databaseDataRoot = Join-Path $dataRoot 'database'
  if (-not (Test-Path -LiteralPath $iniPath -PathType Leaf)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $iniPath) -Force | Out-Null
    $exeMatch = [regex]::Match($imagePath, '(?i)(?<exe>"[^"]+\\(mariadbd|mysqld)\.exe"|\S+\\(mariadbd|mysqld)\.exe)')
    $serverExe = if ($exeMatch.Success) { $exeMatch.Groups['exe'].Value.Trim('"') } else { '' }
    if ($serverExe) {
      $baseDirectory = Split-Path -Parent (Split-Path -Parent $serverExe)
      $content = "[client]`r`nport=$Port`r`nhost=127.0.0.1`r`n`r`n[mysqld]`r`nbasedir=$baseDirectory`r`ndatadir=$databaseDataRoot`r`nbind-address=127.0.0.1`r`nport=$Port`r`nskip-networking=0`r`n"
    } else {
      $content = "[client]`r`nport=$Port`r`nhost=127.0.0.1`r`n`r`n[mysqld]`r`ndatadir=$databaseDataRoot`r`nbind-address=127.0.0.1`r`nport=$Port`r`nskip-networking=0`r`n"
    }
    [IO.File]::WriteAllText($iniPath, $content, [Text.UTF8Encoding]::new($false))
  }
  $serviceInfo = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
  $serviceAccount = [string]$serviceInfo.StartName
  if ($serviceAccount -and $serviceAccount -notin @('LocalSystem', 'NT AUTHORITY\SYSTEM')) {
    Grant-ServiceAccountAccess $dataRoot $serviceAccount ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
    if (Test-Path -LiteralPath $databaseDataRoot) {
      Grant-ServiceAccountAccess $databaseDataRoot $serviceAccount ([Security.AccessControl.FileSystemRights]::Modify)
    }
  }

  $content = [IO.File]::ReadAllText($iniPath)
  if ($content -match '(?im)^\s*\[mysqld\]\s*$') {
    $section = [regex]::Match($content, '(?ims)^\[mysqld\]\s*$(.*?)(?=^\[|\z)')
    if (-not $section.Success) { throw "Could not parse the [mysqld] section in $iniPath." }
    $start = $section.Groups[1].Index
    $body = "`r`n" + $section.Groups[1].Value
    foreach ($setting in @(@('bind-address', '127.0.0.1'), @('port', [string]$Port), @('skip-networking', '0'))) {
      $pattern = if ($setting[0] -eq 'skip-networking') {
        '(?im)^[ \t]*skip-networking(?:[ \t]*=.*)?$'
      } else {
        '(?im)^[ \t]*' + [regex]::Escape($setting[0]) + '[ \t]*=.*$'
      }
      if ([regex]::IsMatch($body, $pattern)) {
        $body = [regex]::Replace($body, $pattern, "$($setting[0])=$($setting[1])")
      } else {
        $body += "`r`n$($setting[0])=$($setting[1])"
      }
    }
    $content = $content.Substring(0, $start) + $body + $content.Substring($start + $section.Groups[1].Length)
  } else { $content += "`r`n[mysqld]`r`nbind-address=127.0.0.1`r`nport=$Port`r`nskip-networking=0`r`n" }
  [IO.File]::WriteAllText($iniPath, $content, [Text.UTF8Encoding]::new($false))
  $service = Get-Service -Name $ServiceName -ErrorAction Stop
  if ($service.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
  Start-Service -Name $ServiceName
  (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
}

function Get-MariaDbPort([string] $ServiceName) {
  $iniPath = Get-MariaDbIniPath $ServiceName
  $section = [regex]::Match([IO.File]::ReadAllText($iniPath), '(?ims)^\[mysqld\][ \t]*\r?\n(.*?)(?=^\[|\z)')
  if (-not $section.Success) { throw "Could not parse the [mysqld] section in $iniPath." }
  $portMatch = [regex]::Match($section.Groups[1].Value, '(?im)^[ \t]*port[ \t]*=[ \t]*(\d+)[ \t]*$')
  if (-not $portMatch.Success) { throw "No explicit MariaDB port was found in $iniPath." }
  return [int]$portMatch.Groups[1].Value
}

function Install-IsolatedMariaDbInstance([string] $RootPassword) {
  $existingServices = @(Get-CimInstance -ClassName Win32_Service -ErrorAction Stop |
    Where-Object { $_.PathName -match '(?i)(mariadbd|mysqld)\.exe' })
  if ($existingServices.Count -ne 1) {
    throw "Expected one existing MariaDB service to provide the database binaries, found $($existingServices.Count). Setup will not choose or change an existing database."
  }
  $existingService = $existingServices[0]
  if ($existingService.Name -notmatch '(?i)maria' -and $existingService.PathName -notmatch '(?i)mariadb') {
    throw "The existing service '$($existingService.Name)' is not clearly MariaDB. Setup will not use or modify it."
  }
  $exeMatch = [regex]::Match($existingService.PathName, '^\s*(?:"(?<exe>[^"]+\.exe)"|(?<exe>\S+\.exe))', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $exeMatch.Success -or $exeMatch.Groups['exe'].Value -notmatch '(?i)(mariadbd|mysqld)\.exe$') {
    throw 'The existing MariaDB service does not point to a recognized MariaDB server executable; no database changes were made.'
  }
  $binDirectory = Split-Path -Parent $exeMatch.Groups['exe'].Value
  $initializeDb = Join-Path $binDirectory 'mariadb-install-db.exe'
  if (-not (Test-Path -LiteralPath $initializeDb -PathType Leaf)) {
    $initializeDb = Join-Path $binDirectory 'mysql_install_db.exe'
  }
  if (-not (Test-Path -LiteralPath $initializeDb -PathType Leaf)) {
    throw "The existing database service '$($existingService.Name)' has no supported MariaDB instance-creation utility. Setup stopped without changing the existing database."
  }

  $databaseDataRoot = Join-Path $dataRoot 'database'
  if (Test-Path -LiteralPath $databaseDataRoot) {
    $existingEntries = @(Get-ChildItem -LiteralPath $databaseDataRoot -Force -ErrorAction SilentlyContinue)
    if ($existingEntries.Count -gt 0) {
      Grant-ServiceAccountAccess $databaseDataRoot 'BUILTIN\Administrators' ([Security.AccessControl.FileSystemRights]::FullControl)
      Grant-ServiceAccountAccess $databaseDataRoot 'SYSTEM' ([Security.AccessControl.FileSystemRights]::FullControl)
      try {
        Remove-Item -LiteralPath $databaseDataRoot -Recurse -Force -ErrorAction Stop
      } catch {
        throw "A failed CBT database setup is blocking retry. Details saved in $dataRoot. Clear $databaseDataRoot after closing database processes, then rerun setup. $($_.Exception.Message)"
      }
    }
  }
  New-Item -ItemType Directory -Path $databaseDataRoot -Force -ErrorAction Stop | Out-Null
  Set-RestrictedAcl $databaseDataRoot 'M'
  $templatePath = Join-Path $dataRoot 'mariadb-template.ini'
  [IO.File]::WriteAllText($templatePath, "[mysqld]`r`nbind-address=127.0.0.1`r`n", [Text.UTF8Encoding]::new($false))
  Set-RestrictedAcl $templatePath 'R'
  try {
    $arguments = @(
      "--datadir=$databaseDataRoot",
      "--service=$databaseServiceName",
      "--port=$databasePort",
      "--password=$RootPassword",
      "--config=$templatePath"
    )
    & $initializeDb @arguments
    if ($LASTEXITCODE -ne 0) { throw "MariaDB instance creation failed with exit code $LASTEXITCODE." }
  } finally {
    Remove-Item -LiteralPath $templatePath -Force -ErrorAction SilentlyContinue
  }

  $createdService = Get-CimInstance -ClassName Win32_Service -Filter "Name='$databaseServiceName'" -ErrorAction Stop
}

function Read-InstallCredentials {
  if (-not $CredentialsFile -or -not (Test-Path -LiteralPath $CredentialsFile -PathType Leaf)) {
    throw 'The installer credentials file is missing. This installation can only be repaired with a newer The Platform CBT installer.'
  }
  try { $provided = Get-Content -LiteralPath $CredentialsFile -Raw | ConvertFrom-Json } catch { throw 'The installer credentials file could not be read securely.' }
  $email = ([string]$provided.email).Trim().ToLowerInvariant()
  $first = ([string]$provided.firstName).Trim()
  $last = ([string]$provided.lastName).Trim()
  $password = if ($null -ne $provided.adminPassword) { [string]$provided.adminPassword } else { [string]$provided.password }
  $rootPassword = [string]$provided.rootPassword
  if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Enter a valid administrator email address.' }
  if (-not $first -or -not $last) { throw 'Administrator name fields cannot be empty.' }
  if ($password.Length -lt 12) { throw 'The administrator password must contain at least 12 characters.' }
  if ($rootPassword.Length -lt 12) { throw 'The MariaDB root password must contain at least 12 characters.' }
  Remove-Item -LiteralPath $CredentialsFile -Force -ErrorAction SilentlyContinue
  return @{ email = $email; firstName = $first; lastName = $last; password = $password; rootPassword = $rootPassword }
}

function Invoke-SetupBootstrap($Credentials, [string] $DatabasePassword) {
  $request = @{
    installRoot = $InstallRoot
    configDirectory = $dataRoot
    databaseRootPassword = $Credentials.rootPassword
    databasePassword = $DatabasePassword
    databasePort = $databasePort
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
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(600000)) {
    $process.Kill()
    throw 'Initial database setup timed out after 10 minutes. Run again after reviewing the installer-provisioning log.'
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($stdout) { Write-Host $stdout.TrimEnd() }
  if ($process.ExitCode -ne 0) { throw "Initial database setup failed. $($stderr.Trim())" }
}

function Reset-MariaDbRootAuthentication([string] $ServiceName, [string] $RootPassword, [int] $Port) {
  $imagePath = Get-MariaDbServiceImage $ServiceName
  $exeMatch = [regex]::Match($imagePath, '(?i)(?<exe>"[^"]+\\(mariadbd|mysqld)\.exe"|\S+\\(mariadbd|mysqld)\.exe)')
  if (-not $exeMatch.Success) { throw 'Could not locate the MariaDB server executable.' }
  $serverExe = $exeMatch.Groups['exe'].Value.Trim('"')
  $binDirectory = Split-Path -Parent $serverExe
  $clientExe = Join-Path $binDirectory 'mariadb.exe'
  if (-not (Test-Path -LiteralPath $clientExe -PathType Leaf)) {
    $clientExe = Join-Path $binDirectory 'mysql.exe'
  }
  if (-not (Test-Path -LiteralPath $clientExe -PathType Leaf)) {
    throw 'MariaDB client executable was not found; cannot normalize root authentication.'
  }

  $sqlPassword = $RootPassword.Replace('\', '\\').Replace('"', '\"')
  $sql = @(
    "ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD(""$sqlPassword"");"
    "ALTER USER 'root'@'127.0.0.1' IDENTIFIED VIA mysql_native_password USING PASSWORD(""$sqlPassword"");"
    "FLUSH PRIVILEGES;"
  ) -join "`r`n"
  $sqlPath = Join-Path $env:TEMP 'cbt-reset-root.sql'
  [IO.File]::WriteAllText($sqlPath, $sql, [Text.UTF8Encoding]::new($false))
  try {
    & $clientExe '--protocol=TCP' "--host=127.0.0.1" "--port=$Port" '--user=root' "--password=$RootPassword" "--execute=$($sql -replace '`r?`n', ' ')" 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "MariaDB root authentication could not be normalized (exit code $LASTEXITCODE)."
    }
  } finally {
    Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue
  }
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
  <depend>$([Security.SecurityElement]::Escape($databaseServiceName))</depend>
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

try {
if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $winSw)) {
  throw 'The installer payload is incomplete (Node runtime or service wrapper is missing).'
}

if ($DatabasePort -eq 0 -and (Get-Service -Name $databaseServiceName -ErrorAction SilentlyContinue)) {
  $databasePort = Get-MariaDbPort $databaseServiceName
}

if ((Test-Path -LiteralPath $configPath) -and (Test-Path -LiteralPath $completeMarker)) {
  # Inno Setup's pre-install hook takes and verifies the database backup before
  # replacing files. Here we apply migrations, then bring the service back.
  try {
    $envLines = Get-Content -LiteralPath $configPath
    foreach ($line in $envLines) {
      if ($line -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim('"'), 'Process') }
    }
    $databaseLine = $envLines | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if (-not $databaseLine -or $databaseLine -notmatch '127\.0\.0\.1:(\d+)/cbt_system') { throw 'Existing CBT database configuration is not in the supported local format.' }
    $existingDatabasePort = [int]$Matches[1]
    $databasePort = $existingDatabasePort
    if ($existingDatabasePort -eq 3306) {
      $databaseServiceName = 'MariaDB'
    } elseif ($existingDatabasePort -ge 3307 -and $existingDatabasePort -le 3399) {
      $databasePort = $existingDatabasePort
      $databaseServiceName = [string]$deployment.databaseServiceName
    } else {
      throw "The existing CBT installation uses unsupported MariaDB port $existingDatabasePort; no database settings were changed."
    }
    $databaseService = Get-Service -Name $databaseServiceName -ErrorAction SilentlyContinue
    if (-not $databaseService) { throw "The MariaDB service '$databaseServiceName' required by the existing installation is missing." }
    if ($databaseService.Status -ne 'Running') { Start-Service -Name $databaseServiceName }
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
  $databasePassword = $null
  if (Test-Path -LiteralPath $configPath) {
    $databaseLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if (-not $databaseLine -or $databaseLine -notmatch '127\.0\.0\.1:(\d+)/cbt_system') {
      throw 'An incomplete install has unsupported database settings. Setup stopped without changing any database.'
    }
    $existingDatabasePort = [int]$Matches[1]
    if ($existingDatabasePort -lt 3307 -or $existingDatabasePort -gt 3399) {
      throw "An incomplete prior install uses unsupported MariaDB port $existingDatabasePort. Setup will not reuse or alter that database; contact support before retrying."
    }
    $databasePort = $existingDatabasePort
    if ($databaseLine -notmatch 'cbt_app:([a-f0-9]{64})@') { throw 'The incomplete setup has no recoverable generated database password.' }
    $databasePassword = $Matches[1]
  }
  $credentials = Read-InstallCredentials
  $maria = Get-Service -Name $databaseServiceName -ErrorAction SilentlyContinue
  if (-not $maria -and $UseExistingMariaDbRuntime) {
    Install-IsolatedMariaDbInstance $credentials.rootPassword
    $maria = Get-Service -Name $databaseServiceName -ErrorAction SilentlyContinue
  }
  if (-not $maria) { throw 'The dedicated MariaDB service is not installed. Setup stopped without modifying another database.' }
  if ($maria.Status -ne 'Running') { Start-Service -Name $databaseServiceName }
  Set-MariaDbLoopback $databaseServiceName $databasePort
  Reset-MariaDbRootAuthentication $databaseServiceName $credentials.rootPassword $databasePort
  if (-not (Test-Path -LiteralPath $configPath)) {
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
} catch {
  $message = $_.Exception.Message
  foreach ($secret in @($credentials.rootPassword, $credentials.password, $databasePassword)) {
    if ($secret) { $message = $message.Replace([string]$secret, '[REDACTED]') }
  }
  $logDirectory = Join-Path $dataRoot 'logs'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $logPath = Join-Path $logDirectory 'installer-provisioning.log'
  [IO.File]::AppendAllText(
    $logPath,
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') $message`r`n",
    [Text.UTF8Encoding]::new($false)
  )
  try { Set-RestrictedAcl $logDirectory 'M' } catch {}
  try { Set-RestrictedAcl $logPath 'R' } catch {}
  Write-Host "CBT provisioning failed: $message`nDetails saved to $logPath" -ForegroundColor Red
  exit 1
}
