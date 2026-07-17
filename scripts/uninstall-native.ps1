param(
  [ValidateSet("chrome", "edge", "chromium", "vivaldi", "all")]
  [string]$Browser = "all",
  [string]$AppDir = (Join-Path $env:LOCALAPPDATA "AnySubtitle"),
  [switch]$RemoveFiles
)

$ErrorActionPreference = "Stop"
$HostName = "com.dowen.any_subtitle"
$Targets = @()
if ($Browser -in @("chrome", "all")) { $Targets += "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName" }
if ($Browser -in @("edge", "all")) { $Targets += "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" }
if ($Browser -in @("chromium", "all")) { $Targets += "HKCU\Software\Chromium\NativeMessagingHosts\$HostName" }
if ($Browser -in @("vivaldi", "all")) { $Targets += "HKCU\Software\Vivaldi\NativeMessagingHosts\$HostName" }
foreach ($Target in $Targets) {
  & reg.exe delete $Target /f 2>$null | Out-Null
}
if ($RemoveFiles -and (Test-Path -LiteralPath $AppDir)) {
  $Resolved = (Resolve-Path -LiteralPath $AppDir).Path
  $ExpectedRoot = (Resolve-Path -LiteralPath $env:LOCALAPPDATA).Path
  if (-not $Resolved.StartsWith($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove app directory outside LOCALAPPDATA: $Resolved"
  }
  Remove-Item -LiteralPath $Resolved -Recurse -Force
}
Write-Host "Removed Any Subtitle native host registry entries."
