param(
  [string]$AppDir = (Join-Path $env:LOCALAPPDATA "AnySubtitle")
)

$ErrorActionPreference = "SilentlyContinue"
$HostName = "com.dowen.any_subtitle"
$ProductKey = "any_subtitle"
$ManifestPath = Join-Path $AppDir "$HostName.json"
$SettingsPath = Join-Path $env:LOCALAPPDATA "com.dowen.local_exporter\settings.json"

foreach ($Target in @(
  "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
  "HKCU\Software\Chromium\NativeMessagingHosts\$HostName",
  "HKCU\Software\Vivaldi\NativeMessagingHosts\$HostName"
)) {
  $Current = (& reg.exe query $Target /ve 2>$null) -join "`n"
  if ($Current -and $Current.Contains($ManifestPath)) {
    & reg.exe delete $Target /f | Out-Null
  }
}

if (Test-Path -LiteralPath $SettingsPath) {
  try {
    $Settings = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json
    $Products = [ordered]@{}
    foreach ($Property in @($Settings.products.PSObject.Properties)) {
      if ($Property.Name -ne $ProductKey) {
        $Products[$Property.Name] = [ordered]@{
          mode = [string]$Property.Value.mode
          root = [string]$Property.Value.root
        }
      }
    }
    $Output = [ordered]@{
      schemaVersion = if ($Settings.schemaVersion) { [int]$Settings.schemaVersion } else { 1 }
      root = [string]$Settings.root
      products = $Products
    }
    [IO.File]::WriteAllText(
      $SettingsPath,
      ($Output | ConvertTo-Json -Depth 6),
      [Text.UTF8Encoding]::new($false)
    )
  } catch {
    # Preserve an unreadable shared settings file rather than deleting it.
  }
}
