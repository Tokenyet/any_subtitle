param(
  [string]$Output = "dist/any-subtitle.zip",
  [string]$UnpackedOutput = "dist/unpacked/any-subtitle"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Destination = Join-Path $Root $Output
$UnpackedDestination = Join-Path $Root $UnpackedOutput
$PackageItems = @("manifest.json", "src", "offscreen", "popup", "onboarding", "icons")

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
if (Test-Path -LiteralPath $Destination) {
  Remove-Item -LiteralPath $Destination -Force
}

if (Test-Path -LiteralPath $UnpackedDestination) {
  $ResolvedRoot = (Resolve-Path -LiteralPath $Root).Path
  $ResolvedUnpacked = (Resolve-Path -LiteralPath $UnpackedDestination).Path
  if (-not $ResolvedUnpacked.StartsWith($ResolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unpacked output outside workspace: $ResolvedUnpacked"
  }
  Remove-Item -LiteralPath $UnpackedDestination -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $UnpackedDestination | Out-Null
foreach ($Item in $PackageItems) {
  Copy-Item -LiteralPath (Join-Path $Root $Item) -Destination $UnpackedDestination -Recurse -Force
}

$Paths = $PackageItems | ForEach-Object { Join-Path $Root $_ }
Compress-Archive -Path $Paths -DestinationPath $Destination -Force
Write-Host "Created $Destination"
Write-Host "Created $UnpackedDestination"
