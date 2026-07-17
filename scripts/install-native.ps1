param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-p]{32}$")]
  [string]$ExtensionId,

  [ValidateSet("chrome", "edge", "chromium", "vivaldi", "all")]
  [string]$Browser = "all",

  [ValidateSet("Shared", "Custom")]
  [string]$ToolchainMode = "Shared",

  [string]$ToolchainRoot = "",

  [string]$AppDir = (Join-Path $env:LOCALAPPDATA "AnySubtitle")
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$HostName = "com.dowen.any_subtitle"
$ProductKey = "any_subtitle"
$SharedStateDir = Join-Path $env:LOCALAPPDATA "com.dowen.local_exporter"
$DefaultSharedRoot = Join-Path $SharedStateDir "toolchain"
$SettingsPath = Join-Path $SharedStateDir "settings.json"

if ($ToolchainMode -eq "Custom") {
  if (-not $ToolchainRoot) {
    throw "-ToolchainRoot is required when -ToolchainMode Custom is used."
  }
  $ResolvedToolchainRoot = $ToolchainRoot
} else {
  $ResolvedToolchainRoot = if ($ToolchainRoot) { $ToolchainRoot } else { $DefaultSharedRoot }
}

New-Item -ItemType Directory -Force -Path $SharedStateDir, $ResolvedToolchainRoot, $AppDir | Out-Null
$Settings = [ordered]@{
  schemaVersion = 1
  root = $DefaultSharedRoot
  products = [ordered]@{}
}
if (Test-Path -LiteralPath $SettingsPath) {
  try {
    $Existing = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json
    if ($Existing.root) { $Settings.root = [string]$Existing.root }
    foreach ($Property in @($Existing.products.PSObject.Properties)) {
      $Settings.products[$Property.Name] = [ordered]@{
        mode = [string]$Property.Value.mode
        root = [string]$Property.Value.root
      }
    }
  } catch {
    Write-Warning "Could not read existing toolchain settings; rebuilding them."
  }
}
$Settings.products[$ProductKey] = [ordered]@{
  mode = $ToolchainMode.ToLowerInvariant()
  root = (Resolve-Path -LiteralPath $ResolvedToolchainRoot).Path
}
$Settings | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $SettingsPath

$NativeDest = Join-Path $AppDir "native-host"
$ScriptsDest = Join-Path $AppDir "scripts"
$ManifestPath = Join-Path $AppDir "$HostName.json"
$LauncherPath = Join-Path $AppDir "any-subtitle-host.cmd"
$BuiltHost = Join-Path $Root "native-host\dist\any-subtitle-host.exe"
$InstalledHost = Join-Path $AppDir "any-subtitle-host.exe"

function Copy-FileWithRetry {
  param([string]$Source, [string]$Destination)
  for ($Attempt = 1; $Attempt -le 20; $Attempt += 1) {
    try {
      Copy-Item -LiteralPath $Source -Destination $Destination -Force
      return
    } catch [IO.IOException] {
      if ($Attempt -eq 20) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
}

New-Item -ItemType Directory -Force -Path $NativeDest, $ScriptsDest | Out-Null
Copy-Item -Path (Join-Path $Root "native-host\*") -Destination $NativeDest -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "scripts\update-tools.ps1") -Destination $ScriptsDest -Force

if (Test-Path -LiteralPath $BuiltHost) {
  Copy-FileWithRetry $BuiltHost $InstalledHost
  $HostPath = $InstalledHost
} else {
  $RuntimeDir = Join-Path $AppDir "runtime"
  $RuntimePython = Join-Path $RuntimeDir "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $RuntimePython)) {
    python -m venv $RuntimeDir
  }
  & $RuntimePython -m pip install --disable-pip-version-check --upgrade opencc-python-reimplemented
@"
@echo off
set PYTHONUTF8=1
"$RuntimePython" "%~dp0native-host\any_subtitle_host.py"
"@ | Set-Content -Encoding ASCII -LiteralPath $LauncherPath
  $HostPath = $LauncherPath
}

$Manifest = [ordered]@{
  name = $HostName
  description = "Any Subtitle local native messaging host"
  path = $HostPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$Manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $ManifestPath

$RegistryTargets = @()
if ($Browser -in @("chrome", "all")) {
  $RegistryTargets += "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName"
}
if ($Browser -in @("edge", "all")) {
  $RegistryTargets += "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
}
if ($Browser -in @("chromium", "all")) {
  $RegistryTargets += "HKCU\Software\Chromium\NativeMessagingHosts\$HostName"
}
if ($Browser -in @("vivaldi", "all")) {
  $RegistryTargets += "HKCU\Software\Vivaldi\NativeMessagingHosts\$HostName"
}
foreach ($Target in $RegistryTargets) {
  & reg.exe add $Target /ve /t REG_SZ /d $ManifestPath /f | Out-Null
}

Write-Host "Installed native host manifest: $ManifestPath"
Write-Host "Host path: $HostPath"
Write-Host "Toolchain: $ResolvedToolchainRoot"
