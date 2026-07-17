#define MyAppName "Any Subtitle Local Core"
#define MyAppVersion "0.3.1"
#ifndef ExtensionId
  #error ExtensionId must be provided by scripts/build-installer.ps1
#endif

[Setup]
AppId={{A941A1E1-104D-4BD6-9AD0-69B208AA78AA}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Tokenyet
DefaultDirName={localappdata}\AnySubtitle
DefaultGroupName=Any Subtitle
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=AnySubtitleCoreSetup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
UninstallDisplayName={#MyAppName}
CloseApplications=force
CloseApplicationsFilter=any-subtitle-host.exe
RestartApplications=no

[Files]
Source: "..\native-host\dist\any-subtitle-host.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup-core.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall-core.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\tools"; Flags: uninsalwaysuninstall

[Icons]
Name: "{group}\Repair Any Subtitle Local Core"; Filename: "{win}\System32\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup-core.ps1"" -ExtensionId ""{#ExtensionId}"" -AppDir ""{app}"""

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-core.ps1"" -AppDir ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "AnySubtitleCoreCleanup"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShellPath: String;
  Parameters: String;
  ErrorPath: String;
  ErrorDetails: AnsiString;
begin
  if CurStep <> ssPostInstall then
    Exit;

  WizardForm.StatusLabel.Caption := '正在下載並設定本機字幕核心…';
  if IsWin64 then
    PowerShellPath := ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe')
  else
    PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\setup-core.ps1') + '" -ExtensionId "{#ExtensionId}" -AppDir "' +
    ExpandConstant('{app}') + '"';
  if not Exec(PowerShellPath, Parameters, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
    RaiseException('無法啟動 Any Subtitle 本機核心設定程序。');
  if ResultCode <> 0 then begin
    ErrorPath := ExpandConstant('{app}\install-error.txt');
    if LoadStringFromFile(ErrorPath, ErrorDetails) then
      RaiseException(
        '本機核心設定失敗：' + #13#10 + #13#10 + String(ErrorDetails) + #13#10 + #13#10 +
        '修正問題後可重新執行安裝器；已下載的檔案會接續使用。'
      )
    else
      RaiseException(
        '本機核心設定失敗，但沒有取得詳細錯誤。請重新執行安裝器。'
      );
  end;
end;
