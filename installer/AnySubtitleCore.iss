#define MyAppName "Any Subtitle Local Core"
#define MyAppVersion "0.3.0"
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
CloseApplications=no

[Files]
Source: "..\native-host\dist\any-subtitle-host.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup-core.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall-core.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\tools"; Flags: uninsalwaysuninstall

[Icons]
Name: "{group}\Repair Any Subtitle Local Core"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup-core.ps1"" -ExtensionId ""{#ExtensionId}"" -AppDir ""{app}"""

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
begin
  if CurStep <> ssPostInstall then
    Exit;

  WizardForm.StatusLabel.Caption := '正在下載並設定本機字幕核心…';
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\setup-core.ps1') + '" -ExtensionId "{#ExtensionId}" -AppDir "' +
    ExpandConstant('{app}') + '"';
  if not Exec(PowerShellPath, Parameters, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
    RaiseException('無法啟動 Any Subtitle 本機核心設定程序。');
  if ResultCode <> 0 then
    RaiseException('本機核心下載或設定失敗。請確認網路、NVIDIA 驅動程式與可用磁碟空間後，再執行安裝器。');
end;
