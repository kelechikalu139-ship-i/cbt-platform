#define AppName "The Platform CBT"
#define AppPublisher "The Platform"
#define AppVersion GetEnv("CBT_RELEASE_VERSION")
#define ScriptDir SourcePath
#define PayloadDir AddBackslash(ScriptDir) + "build\" + AppVersion + "\payload"

#if AppVersion == ""
  #error Set CBT_RELEASE_VERSION before compiling the installer.
#endif

[Setup]
AppId={{86B98863-05A7-40A4-A7F8-51B2EE86B5D7}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\The Platform CBT
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
OutputDir={#ScriptDir}\build\{#AppVersion}
OutputBaseFilename=The-Platform-CBT-Setup-{#AppVersion}-unsigned
UninstallDisplayIcon={app}\runtime\node\node.exe
SetupLogging=yes
Uninstallable=yes
CloseApplications=no
RestartIfNeededByRun=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to the staff portal"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ScriptDir}\Prepare-Upgrade.ps1"; DestDir: "{app}\setup"; Flags: ignoreversion
Source: "{#ScriptDir}\Uninstall-CBT.ps1"; DestDir: "{app}\setup"; Flags: ignoreversion

[Icons]
Name: "{group}\Staff portal"; Filename: "http://localhost:5000/admin/login"
Name: "{group}\Student portal"; Filename: "http://localhost:5000/"
Name: "{autodesktop}\The Platform CBT - Staff"; Filename: "http://localhost:5000/admin/login"; Tasks: desktopicon

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup\Uninstall-CBT.ps1"""; Flags: runhidden waituntilterminated

[Code]
function MariaDbServiceExists(): Boolean;
var
  ImagePath: string;
begin
  Result := RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Services\MariaDB', 'ImagePath', ImagePath);
end;

function PrepareToInstall(var NeedsRestart: Boolean): string;
var
  ExitCode: Integer;
  ScriptPath: string;
  PowerShellPath: string;
  ServiceImagePath: string;
begin
  Result := '';
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Services\CBTPlatform', 'ImagePath', ServiceImagePath) then
    Exit;

  ScriptPath := ExpandConstant('{app}\setup\Prepare-Upgrade.ps1');
  if not FileExists(ScriptPath) then begin
    Result := 'The existing CBT service has no supported backup script. Do not upgrade this installation with this package.';
    Exit;
  end;
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  if not Exec(PowerShellPath,
    '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ScriptPath),
    '', SW_SHOW, ewWaitUntilTerminated, ExitCode) then
    Result := 'Could not start the CBT upgrade backup step.'
  else if ExitCode <> 0 then
    Result := 'Upgrade stopped because the CBT service could not be stopped and backed up. Review the installer output and retry.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ExitCode: Integer;
  MariaDbPath: string;
  ConfigurePath: string;
  Parameters: string;
begin
  if CurStep <> ssPostInstall then
    Exit;

  if not MariaDbServiceExists then begin
    MariaDbPath := ExpandConstant('{app}\prerequisites\mariadb.msi');
    if not Exec(ExpandConstant('{sys}\msiexec.exe'),
      '/i ' + AddQuotes(MariaDbPath) + ' SERVICENAME=MariaDB PORT=3306',
      '', SW_SHOW, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Could not start the bundled MariaDB installer.')
    else if ExitCode <> 0 then
      RaiseException('MariaDB installation did not complete. Setup has stopped; rerun after resolving the MariaDB installer issue.')
  end;

  ConfigurePath := ExpandConstant('{app}\setup\Install-CBT.ps1');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ConfigurePath) +
    ' -InstallRoot ' + AddQuotes(ExpandConstant('{app}'));
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters, '', SW_SHOW, ewWaitUntilTerminated, ExitCode) then
    RaiseException('Could not start CBT provisioning.')
  else if ExitCode <> 0 then
    RaiseException('CBT provisioning did not complete. Review the error above and rerun setup to continue or repair the installation.')
end;
