#define AppName "The Platform CBT"
#define AppPublisher "The Platform"
#define AppVersion GetEnv("CBT_RELEASE_VERSION")
#define ScriptDir SourcePath
#define PayloadDir AddBackslash(ScriptDir) + "build\" + AppVersion + "\payload"
#define DatabasePortStart "3307"
#define DatabasePortEnd "3399"
#define DatabaseService "CBTPlatformMariaDB"

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
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
Compression=lzma2/fast
SolidCompression=no
OutputDir={#ScriptDir}\build\{#AppVersion}
OutputBaseFilename=The-Platform-CBT-Setup-{#AppVersion}
UninstallDisplayIcon={app}\runtime\node\node.exe
SetupLogging=yes
Uninstallable=yes
CloseApplications=no
RestartIfNeededByRun=no
SetupMutex=ThePlatformCbtInstallerMutex

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to the staff portal"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ScriptDir}\Prepare-Upgrade.ps1"; DestDir: "{app}\setup"; Flags: ignoreversion
Source: "{#ScriptDir}\Uninstall-CBT.ps1"; DestDir: "{app}\setup"; Flags: ignoreversion
Source: "{#ScriptDir}\Check-CBTDatabasePort.ps1"; Flags: dontcopy

[Icons]
Name: "{group}\Staff portal"; Filename: "http://localhost:5000/admin/login"
Name: "{group}\Student portal"; Filename: "http://localhost:5000/"
Name: "{autodesktop}\The Platform CBT - Staff"; Filename: "http://localhost:5000/admin/login"; Tasks: desktopicon

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup\Uninstall-CBT.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveCBTService"

[Code]
var
  CredentialsPage: TInputQueryWizardPage;
  DatabaseCredentialsPage: TInputQueryWizardPage;
  UseExistingMariaDbRuntime: Boolean;
  SelectedDatabasePort: Integer;

function CbtJsonEscape(const S: String): String;
var
  I: Integer;
begin
  Result := '';
  for I := 1 to Length(S) do
    case Ord(S[I]) of
      8: Result := Result + '\b';
      9: Result := Result + '\t';
      10: Result := Result + '\n';
      12: Result := Result + '\f';
      13: Result := Result + '\r';
      34: Result := Result + '\"';
      92: Result := Result + '\\';
    else
      Result := Result + S[I];
    end;
end;

procedure InitializeWizard();
begin
  CredentialsPage := CreateInputQueryPage(wpSelectDir,
    'Set up The Platform CBT', 'Create the first administrator account and database credentials.',
    'These values are used once during installation. Use a database password of at least 12 characters.');
  CredentialsPage.Add('Administrator email:', False);
  CredentialsPage.Add('Administrator first name:', False);
  CredentialsPage.Add('Administrator family name:', False);
  CredentialsPage.Add('Administrator password:', True);
  CredentialsPage.Add('Confirm administrator password:', True);
  DatabaseCredentialsPage := CreateInputQueryPage(CredentialsPage.ID,
    'Set the database password', 'Create the MariaDB administrator password.',
    'This password is required to install the dedicated CBT database. Use at least 12 characters.');
  DatabaseCredentialsPage.Add('MariaDB root password:', True);
  DatabaseCredentialsPage.Add('Confirm MariaDB root password:', True);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Email: String;
begin
  Result := True;
  if CurPageID = CredentialsPage.ID then begin
    Email := LowerCase(Trim(CredentialsPage.Values[0]));
    if (Pos('@', Email) = 0) or (Pos('.', Email) = 0) then begin
      MsgBox('Enter a valid administrator email address.', mbError, MB_OK);
      Result := False;
    end else if (Trim(CredentialsPage.Values[1]) = '') or (Trim(CredentialsPage.Values[2]) = '') then begin
      MsgBox('Enter the administrator first and family names.', mbError, MB_OK);
      Result := False;
    end else if (Length(CredentialsPage.Values[3]) < 12) then begin
      MsgBox('The administrator password must contain at least 12 characters.', mbError, MB_OK);
      Result := False;
    end else if CredentialsPage.Values[3] <> CredentialsPage.Values[4] then begin
      MsgBox('The administrator passwords do not match.', mbError, MB_OK);
      Result := False;
    end;
  end else if CurPageID = DatabaseCredentialsPage.ID then begin
    if Length(DatabaseCredentialsPage.Values[0]) < 12 then begin
      MsgBox('The MariaDB root password must contain at least 12 characters.', mbError, MB_OK);
      Result := False;
    end else if DatabaseCredentialsPage.Values[0] <> DatabaseCredentialsPage.Values[1] then begin
      MsgBox('The MariaDB root passwords do not match.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function CbtServiceExists(): Boolean;
var
  ImagePath: string;
begin
  Result := RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Services\CBTPlatform', 'ImagePath', ImagePath);
end;

function CbtMariaDbServiceExists(): Boolean;
var
  ImagePath: string;
begin
  Result := RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Services\{#DatabaseService}', 'ImagePath', ImagePath);
end;

function PrepareToInstall(var NeedsRestart: Boolean): string;
var
  ExitCode: Integer;
  ScriptPath: string;
  PowerShellPath: string;
  ServiceImagePath: string;
  PortText: AnsiString;
begin
  Result := '';
  UseExistingMariaDbRuntime := False;
  SelectedDatabasePort := 0;
  if not CbtServiceExists and not CbtMariaDbServiceExists then begin
    ExtractTemporaryFile('Check-CBTDatabasePort.ps1');
    PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    if not Exec(PowerShellPath,
      '-NoProfile -ExecutionPolicy Bypass -File ' +
      AddQuotes(ExpandConstant('{tmp}\Check-CBTDatabasePort.ps1')) +
      ' -PortRangeStart {#DatabasePortStart} -PortRangeEnd {#DatabasePortEnd}' +
      ' -ServiceName {#DatabaseService} -OutputPath ' +
      AddQuotes(ExpandConstant('{tmp}\cbt-database-port.txt')),
      '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
      Result := 'Could not check the dedicated CBT database port.';
      Exit;
    end else if (ExitCode = 0) or (ExitCode = 2) then begin
      if not LoadStringFromFile(ExpandConstant('{tmp}\cbt-database-port.txt'), PortText) then begin
        Result := 'Could not read the selected CBT database port.';
        Exit;
      end;
      try
        SelectedDatabasePort := StrToInt(Trim(PortText));
      except
        Result := 'The selected CBT database port was invalid.';
        Exit;
      end;
      if (SelectedDatabasePort < {#DatabasePortStart}) or
        (SelectedDatabasePort > {#DatabasePortEnd}) then begin
        Result := 'The selected CBT database port is outside the supported range.';
        Exit;
      end;
      UseExistingMariaDbRuntime := ExitCode = 2;
    end else if ExitCode = 3 then begin
      Result := 'A MariaDB or MySQL installation already exists without a database service. Setup stopped to avoid changing that installation; install or register its service before retrying.';
      Exit;
    end else if ExitCode = 4 then begin
      Result := 'Multiple or unsupported database services are installed. Setup stopped rather than choosing an existing database; resolve the database service layout before retrying.';
      Exit;
    end else if ExitCode <> 0 then begin
      Result := 'No available database port was found in the range {#DatabasePortStart}-{#DatabasePortEnd}. Setup made no database changes.';
      Exit;
    end;
  end;

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
    '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
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
  CredentialsJson: String;
begin
  if CurStep <> ssPostInstall then
    Exit;

  CredentialsJson := '{"email":"' + CbtJsonEscape(LowerCase(Trim(CredentialsPage.Values[0]))) + '",' +
    '"firstName":"' + CbtJsonEscape(Trim(CredentialsPage.Values[1])) + '",' +
    '"lastName":"' + CbtJsonEscape(Trim(CredentialsPage.Values[2])) + '",' +
    '"password":"' + CbtJsonEscape(CredentialsPage.Values[3]) + '",' +
    '"rootPassword":"' + CbtJsonEscape(DatabaseCredentialsPage.Values[0]) + '"}';
  SaveStringToFile(ExpandConstant('{tmp}\cbt-install-credentials.json'), CredentialsJson, False);

  WizardForm.StatusLabel.Caption := 'Preparing the CBT database...';
  WizardForm.ProgressGauge.Position := 90;
  if not CbtServiceExists and not CbtMariaDbServiceExists and not UseExistingMariaDbRuntime then begin
    MariaDbPath := ExpandConstant('{app}\prerequisites\mariadb.msi');
    if SelectedDatabasePort = 0 then
      RaiseException('The installer did not select a free local database port.')
    else
    if not Exec(ExpandConstant('{sys}\msiexec.exe'),
      '/i ' + AddQuotes(MariaDbPath) + ' /qn /norestart SERVICENAME={#DatabaseService} PORT=' + IntToStr(SelectedDatabasePort) + ' DATADIR=' +
      AddQuotes(ExpandConstant('{commonappdata}\The Platform CBT\database')) + ' SKIPNETWORKING=1 PASSWORD=' + AddQuotes(DatabaseCredentialsPage.Values[0]),
      '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
      RaiseException('Could not start the bundled MariaDB installer.')
    else if (ExitCode <> 0) and (ExitCode <> 3010) and (ExitCode <> 1641) then
      RaiseException('MariaDB installation did not complete. Setup has stopped; rerun after resolving the MariaDB installer issue.')
  end;

  WizardForm.StatusLabel.Caption := 'Configuring CBT services and creating the administrator account...';
  WizardForm.ProgressGauge.Position := 95;
  ConfigurePath := ExpandConstant('{app}\setup\Install-CBT.ps1');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ConfigurePath) +
    ' -InstallRoot ' + AddQuotes(ExpandConstant('{app}')) +
    ' -CredentialsFile ' + AddQuotes(ExpandConstant('{tmp}\cbt-install-credentials.json'));
  if SelectedDatabasePort > 0 then
    Parameters := Parameters + ' -DatabasePort ' + IntToStr(SelectedDatabasePort);
  if UseExistingMariaDbRuntime then
    Parameters := Parameters + ' -UseExistingMariaDbRuntime';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters, '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    RaiseException('Could not start CBT provisioning.')
  else if ExitCode <> 0 then
    RaiseException('CBT provisioning did not complete. Review the error above and rerun setup to continue or repair the installation.')
end;
