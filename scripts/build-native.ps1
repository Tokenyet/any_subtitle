$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Entry = Join-Path $Root "native-host\any_subtitle_host.py"
$Dist = Join-Path $Root "native-host\dist"
$Build = Join-Path $Root "native-host\build"

New-Item -ItemType Directory -Force -Path $Dist, $Build | Out-Null
$Args = @(
  "--onefile",
  "--clean",
  "--collect-all", "opencc",
  "--name", "any-subtitle-host",
  "--distpath", $Dist,
  "--workpath", $Build,
  "--specpath", $Build,
  $Entry
)

if (Get-Command uv -ErrorAction SilentlyContinue) {
  & uv tool run --with opencc-python-reimplemented pyinstaller @Args
} else {
  python -m pip install --upgrade pyinstaller opencc-python-reimplemented
  python -m PyInstaller @Args
}

Write-Host "Built native host in $Dist"
