[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$service = Get-Service CBTPlatform -ErrorAction SilentlyContinue
if ($service) {
  $wrapper = Join-Path $PSScriptRoot '..\tools\cbt-service.exe'
  if (-not (Test-Path -LiteralPath $wrapper)) { throw 'The CBT service wrapper is missing; remove the CBTPlatform service manually before uninstalling.' }
  if ($service.Status -ne 'Stopped') {
    Stop-Service CBTPlatform -Force
    (Get-Service CBTPlatform).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
  }
  & $wrapper uninstall
  if ($LASTEXITCODE -ne 0) { throw "Could not remove the CBTPlatform Windows service (exit code $LASTEXITCODE)." }
}
$firewallRules = Get-NetFirewallRule -DisplayName 'The Platform CBT web access' -ErrorAction SilentlyContinue
if ($firewallRules) { $firewallRules | Remove-NetFirewallRule -ErrorAction Stop }
# Keep ProgramData, MariaDB, uploaded files and database backups. An operator
# must remove these separately after exporting or intentionally purging data.
