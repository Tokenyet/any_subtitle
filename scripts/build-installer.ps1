param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-p]{32}$")]
  [string]$ExtensionId
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$IsccCandidates = @(
  (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source,
  (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$Iscc = $IsccCandidates | Select-Object -First 1
if (-not $Iscc) {
  throw "Inno Setup 6 is required. Install it with: winget install JRSoftware.InnoSetup"
}

& (Join-Path $PSScriptRoot "build-native.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "Native host build failed."
}

$Iss = Join-Path $Root "installer\AnySubtitleCore.iss"
& $Iscc "/DExtensionId=$ExtensionId" $Iss
if ($LASTEXITCODE -ne 0) {
  throw "Inno Setup build failed."
}

$Output = Join-Path $Root "dist\installer\AnySubtitleCoreSetup.exe"
if (-not (Test-Path -LiteralPath $Output)) {
  throw "Installer output was not created: $Output"
}
Write-Host "Created $Output"
