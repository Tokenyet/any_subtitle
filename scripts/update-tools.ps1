param(
  [ValidateSet("Shared", "Custom")]
  [string]$ToolchainMode = "Shared",
  [string]$ToolchainRoot = "",
  [switch]$ForceUpdate
)

$ErrorActionPreference = "Stop"
$SharedRoot = Join-Path $env:LOCALAPPDATA "com.dowen.local_exporter\toolchain"
if ($ToolchainMode -eq "Custom") {
  if (-not $ToolchainRoot) { throw "-ToolchainRoot is required for Custom mode." }
  $Root = $ToolchainRoot
} else {
  $Root = if ($ToolchainRoot) { $ToolchainRoot } else { $SharedRoot }
}
$Models = Join-Path $Root "models"
$Cuda = Join-Path $Root "cuda"
New-Item -ItemType Directory -Force -Path $Models | Out-Null

$RequiredCuda = @("whisper-server.exe", "whisper-cli.exe", "ggml-cuda.dll")
foreach ($File in $RequiredCuda) {
  if (-not (Test-Path -LiteralPath (Join-Path $Cuda $File))) {
    throw "Missing CUDA whisper.cpp tool: $(Join-Path $Cuda $File). Install the shared CUDA whisper.cpp toolchain first."
  }
}

function Download-Model {
  param([string]$Name, [string]$Url, [long]$MinimumBytes)
  $Destination = Join-Path $Models $Name
  $ExistingSize = if (Test-Path -LiteralPath $Destination) {
    (Get-Item -LiteralPath $Destination).Length
  } else {
    0
  }
  if ($ForceUpdate -or $ExistingSize -lt $MinimumBytes) {
    $Partial = "$Destination.partial"
    if ($ForceUpdate -and (Test-Path -LiteralPath $Partial)) {
      Remove-Item -LiteralPath $Partial -Force
    }
    if ((Test-Path -LiteralPath $Destination) -and $ExistingSize -gt 0 -and -not (Test-Path -LiteralPath $Partial)) {
      Move-Item -LiteralPath $Destination -Destination $Partial
    } elseif (Test-Path -LiteralPath $Destination) {
      Remove-Item -LiteralPath $Destination -Force
    }
    Write-Host "Downloading $Name"
    & curl.exe -L --fail --retry 5 --retry-delay 2 --continue-at - --output $Partial $Url
    if ($LASTEXITCODE -ne 0) {
      throw "curl failed while downloading $Name"
    }
    $DownloadedSize = (Get-Item -LiteralPath $Partial).Length
    if ($DownloadedSize -lt $MinimumBytes) {
      throw "Downloaded $Name is incomplete: $DownloadedSize bytes"
    }
    Move-Item -LiteralPath $Partial -Destination $Destination -Force
  } else {
    Write-Host "Reusing $Destination"
  }
}

Download-Model "ggml-small.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" 400000000
Download-Model "ggml-large-v3-turbo.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin" 1500000000
Download-Model "ggml-silero-v6.2.0.bin" "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin" 500000

Write-Host "Any Subtitle models are ready in $Models"
