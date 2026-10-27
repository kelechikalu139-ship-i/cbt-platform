[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$dataRoot = Join-Path $env:ProgramData 'The Platform CBT'
$envPath = Join-Path $dataRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) { exit 0 }

$service = Get-Service CBTPlatform -ErrorAction SilentlyContinue
if (-not $service) { throw 'Existing installation config is present, but the CBTPlatform service is missing. Repair it before upgrading.' }

$urlLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $urlLine) { throw 'Existing CBT configuration has no DATABASE_URL; refusing upgrade without a verified backup.' }
$urlText = $urlLine.Substring('DATABASE_URL='.Length).Trim().Trim('"')
if ($urlText -notmatch '^mysql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?]+)') { throw 'Existing DATABASE_URL is not in the supported local MariaDB format.' }
$dbUser = [Uri]::UnescapeDataString($Matches[1])
$dbPassword = [Uri]::UnescapeDataString($Matches[2])
$dbHost = $Matches[3]
$dbPort = $Matches[4]
$dbName = [Uri]::UnescapeDataString($Matches[5])
if ($dbHost -notin @('127.0.0.1', 'localhost') -or $dbName -ne 'cbt_system') { throw 'Upgrade backup only supports the local cbt_system database.' }

$databaseServiceName = if ($dbPort -eq '3306') { 'MariaDB' } elseif ([int]$dbPort -ge 3307 -and [int]$dbPort -le 3399) { 'CBTPlatformMariaDB' } else { throw "Unsupported local MariaDB port $dbPort; refusing to upgrade without a verified backup." }
$databaseService = Get-CimInstance -ClassName Win32_Service -Filter "Name='$databaseServiceName'" -ErrorAction SilentlyContinue
if (-not $databaseService) { throw "MariaDB service '$databaseServiceName' was not found; refusing to upgrade without a verified backup." }
$exeMatch = [regex]::Match($databaseService.PathName, '^\s*(?:"(?<exe>[^"]+\.exe)"|(?<exe>\S+\.exe))', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
if (-not $exeMatch.Success) { throw "Could not read the $databaseServiceName executable path; refusing to upgrade without a verified backup." }
$binDirectory = Split-Path -Parent $exeMatch.Groups['exe'].Value
$dumpPath = Join-Path $binDirectory 'mariadb-dump.exe'
if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { $dumpPath = Join-Path $binDirectory 'mysqldump.exe' }
if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { throw "MariaDB dump utility was not found beside '$databaseServiceName'; refusing to upgrade without a backup." }

if ($service.Status -ne 'Stopped') {
  Stop-Service CBTPlatform -Force
  (Get-Service CBTPlatform).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $dataRoot 'backups'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$defaultsFile = Join-Path $dataRoot "db-backup-$timestamp.cnf"
$backupFile = Join-Path $backupDir "cbt_system-$timestamp.sql"
$cnf = "[client]`r`nuser=$dbUser`r`npassword=`"$dbPassword`"`r`nhost=$dbHost`r`nport=$dbPort`r`nprotocol=tcp`r`n"
[IO.File]::WriteAllText($defaultsFile, $cnf, [Text.UTF8Encoding]::new($false))
& icacls.exe $defaultsFile /inheritance:r /grant:r 'SYSTEM:F' 'BUILTIN\Administrators:F' 'NT AUTHORITY\LOCAL SERVICE:R' | Out-Null
if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $defaultsFile -Force; throw 'Could not secure temporary backup credentials.' }
try {
  & $dumpPath "--defaults-extra-file=$defaultsFile" '--single-transaction' '--routines' '--events' "--result-file=$backupFile" $dbName
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupFile) -or (Get-Item -LiteralPath $backupFile).Length -lt 100) {
    throw 'MariaDB backup failed or produced an empty file; the upgrade was stopped.'
  }
  $hash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$backupFile.sha256", "$hash  $(Split-Path -Leaf $backupFile)`r`n", [Text.UTF8Encoding]::new($false))
  Write-Host "Verified pre-upgrade backup created: $backupFile"
} catch {
  Start-Service CBTPlatform -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item -LiteralPath $defaultsFile -Force -ErrorAction SilentlyContinue
}
