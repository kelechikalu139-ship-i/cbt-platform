[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$service = Get-Service CBTPlatform -ErrorAction SilentlyContinue
if ($service) {
  Stop-Service CBTPlatform -Force -ErrorAction SilentlyContinue
  $wrapper = Join-Path $PSScriptRoot '..\tools\cbt-service.exe'
  & $wrapper stop | Out-Null
  & $wrapper uninstall | Out-Null
}
Remove-NetFirewallRule -DisplayName 'The Platform CBT web access' -ErrorAction SilentlyContinue
# Keep ProgramData, MariaDB, uploaded files and database backups. An operator
# must remove these separately after exporting or intentionally purging data.
