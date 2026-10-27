[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateRange(1, 65535)][int] $PortRangeStart,
  [Parameter(Mandatory)][ValidateRange(1, 65535)][int] $PortRangeEnd,
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string] $ServiceName,
  [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string] $OutputPath
)

$ErrorActionPreference = 'Stop'
if ($PortRangeEnd -lt $PortRangeStart) { throw 'The database port range is invalid.' }

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  $serviceInfo = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'"
  if ($serviceInfo.PathName -notmatch '(?i)(mariadbd|mysqld)\.exe' -or
      $serviceInfo.PathName -notmatch '(?i)--defaults-file=') {
    throw "Windows service '$ServiceName' exists but is not a recognizable MariaDB instance. Setup will not modify it."
  }
  exit 0
}

$selectedPort = $null
for ($candidate = $PortRangeStart; $candidate -le $PortRangeEnd; $candidate++) {
  if (Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue) { continue }
  $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
  try {
    $probe.Start()
    $selectedPort = $candidate
    break
  } catch [Net.Sockets.SocketException] {
    continue
  } finally {
    if ($probe.Server.IsBound) { $probe.Stop() }
  }
}
if (-not $selectedPort) { throw "No free TCP port was found in the range $PortRangeStart-$PortRangeEnd. Setup made no database changes." }
[IO.File]::WriteAllText($OutputPath, "$selectedPort`r`n", [Text.UTF8Encoding]::new($false))

$databaseServices = Get-CimInstance -ClassName Win32_Service |
  Where-Object { $_.PathName -match '(?i)(mariadbd|mysqld)\.exe' }
if ($databaseServices) {
  if (@($databaseServices).Count -ne 1 -or
      ($databaseServices[0].Name -notmatch '(?i)maria' -and $databaseServices[0].PathName -notmatch '(?i)mariadb')) {
    exit 4
  }
  exit 2
}

$databaseProducts = @(
  Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match '(?i)(MariaDB|MySQL Server)' }
)
if ($databaseProducts.Count) { exit 3 }
