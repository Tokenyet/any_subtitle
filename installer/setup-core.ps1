param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-p]{32}$")]
  [string]$ExtensionId,

  [string]$AppDir = (Join-Path $env:LOCALAPPDATA "AnySubtitle"),

  [switch]$ForceUpdate
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$HostName = "com.dowen.any_subtitle"
$ProductKey = "any_subtitle"
$SharedStateDir = Join-Path $env:LOCALAPPDATA "com.dowen.local_exporter"
$SettingsPath = Join-Path $SharedStateDir "settings.json"
$ToolchainRoot = Join-Path $AppDir "tools"
$CudaDir = Join-Path $ToolchainRoot "cuda"
$ModelsDir = Join-Path $ToolchainRoot "models"
$DownloadsDir = Join-Path $AppDir "downloads"
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ("any-subtitle-core-" + [Guid]::NewGuid().ToString("N"))
$HostPath = Join-Path $AppDir "any-subtitle-host.exe"
$ManifestPath = Join-Path $AppDir "$HostName.json"
$ErrorPath = Join-Path $AppDir "install-error.txt"
$Succeeded = $false
$CurrentStep = "Starting setup"

function Write-Utf8NoBom {
  param([string]$Path, [string]$Value)
  [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination,
    [long]$MinimumBytes = 1
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  if ((Test-Path -LiteralPath $Destination) -and -not $ForceUpdate) {
    if ((Get-Item -LiteralPath $Destination).Length -ge $MinimumBytes) {
      Write-Host "Reusing $Destination"
      return
    }
  }

  $Partial = "$Destination.partial"
  if ($ForceUpdate -and (Test-Path -LiteralPath $Partial)) {
    Remove-Item -LiteralPath $Partial -Force
  }
  Write-Host "Downloading $Url"
  & curl.exe --fail --location --retry 5 --retry-all-errors --connect-timeout 30 `
    --continue-at - --output $Partial $Url
  if ($LASTEXITCODE -ne 0) {
    throw "Download failed with exit code ${LASTEXITCODE}: $Url"
  }
  $Size = (Get-Item -LiteralPath $Partial).Length
  if ($Size -lt $MinimumBytes) {
    throw "Downloaded file is incomplete ($Size bytes): $Url"
  }
  Move-Item -LiteralPath $Partial -Destination $Destination -Force
}

function Expand-DownloadedArchive {
  param([string]$Archive, [string]$Destination)
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
}

function Save-ToolchainSettings {
  New-Item -ItemType Directory -Force -Path $SharedStateDir | Out-Null
  $Settings = [ordered]@{
    schemaVersion = 1
    root = (Join-Path $SharedStateDir "toolchain")
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
      Write-Warning "Existing local-exporter settings could not be read; recreating them."
    }
  }
  $Settings.products[$ProductKey] = [ordered]@{
    mode = "custom"
    root = (Resolve-Path -LiteralPath $ToolchainRoot).Path
  }
  Write-Utf8NoBom $SettingsPath ($Settings | ConvertTo-Json -Depth 6)
}

function Register-NativeHost {
  if (-not (Test-Path -LiteralPath $HostPath)) {
    throw "Native host executable is missing: $HostPath"
  }
  $Manifest = [ordered]@{
    name = $HostName
    description = "Any Subtitle local native messaging host"
    path = $HostPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }
  Write-Utf8NoBom $ManifestPath ($Manifest | ConvertTo-Json -Depth 4)
  foreach ($Target in @(
    "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
    "HKCU\Software\Chromium\NativeMessagingHosts\$HostName",
    "HKCU\Software\Vivaldi\NativeMessagingHosts\$HostName"
  )) {
    & reg.exe add $Target /ve /t REG_SZ /d $ManifestPath /f | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not register native host: $Target"
    }
  }
}

try {
  New-Item -ItemType Directory -Force -Path $AppDir, $ToolchainRoot, $CudaDir, $ModelsDir, $DownloadsDir, $TempDir | Out-Null
  if (Test-Path -LiteralPath $ErrorPath) {
    Remove-Item -LiteralPath $ErrorPath -Force
  }

  $CurrentStep = "Checking the NVIDIA driver"
  $NvidiaCandidates = @(
    (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue).Source,
    (Join-Path $env:WINDIR "System32\nvidia-smi.exe"),
    (Join-Path $env:WINDIR "Sysnative\nvidia-smi.exe"),
    $(if ($env:ProgramW6432) { Join-Path $env:ProgramW6432 "NVIDIA Corporation\NVSMI\nvidia-smi.exe" }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "NVIDIA Corporation\NVSMI\nvidia-smi.exe" })
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $NvidiaSmi = $NvidiaCandidates | Select-Object -First 1
  if (-not $NvidiaSmi) {
    throw "找不到 NVIDIA 驅動程式。Any Subtitle 目前需要 NVIDIA GTX/RTX 顯示卡。"
  }

  $CurrentStep = "Installing yt-dlp"
  Write-Host "[1/6] $CurrentStep"
  Download-File `
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" `
    (Join-Path $ToolchainRoot "yt-dlp.exe") `
    10000000

  $CurrentStep = "Installing Deno"
  Write-Host "[2/6] $CurrentStep"
  $DenoPath = Join-Path $ToolchainRoot "deno.exe"
  if ($ForceUpdate -or -not (Test-Path -LiteralPath $DenoPath)) {
    $DenoZip = Join-Path $DownloadsDir "deno-x86_64-pc-windows-msvc.zip"
    Download-File `
      "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" `
      $DenoZip `
      10000000
    $DenoExtract = Join-Path $TempDir "deno"
    Expand-DownloadedArchive $DenoZip $DenoExtract
    $DenoExe = Get-ChildItem -LiteralPath $DenoExtract -Recurse -Filter deno.exe | Select-Object -First 1
    if (-not $DenoExe) { throw "Deno archive did not contain deno.exe" }
    Copy-Item -LiteralPath $DenoExe.FullName -Destination $DenoPath -Force
  } else {
    Write-Host "Reusing $DenoPath"
  }

  $CurrentStep = "Installing FFmpeg"
  Write-Host "[3/6] $CurrentStep"
  $FfmpegReady = @("ffmpeg.exe", "ffprobe.exe") |
    ForEach-Object { Test-Path -LiteralPath (Join-Path $ToolchainRoot $_) } |
    Where-Object { -not $_ }
  if ($ForceUpdate -or $FfmpegReady.Count -gt 0) {
    $FfmpegZip = Join-Path $DownloadsDir "ffmpeg-release-essentials.zip"
    Download-File `
      "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" `
      $FfmpegZip `
      50000000
    $FfmpegExtract = Join-Path $TempDir "ffmpeg"
    Expand-DownloadedArchive $FfmpegZip $FfmpegExtract
    foreach ($Name in @("ffmpeg.exe", "ffprobe.exe")) {
      $Executable = Get-ChildItem -LiteralPath $FfmpegExtract -Recurse -Filter $Name | Select-Object -First 1
      if (-not $Executable) { throw "FFmpeg archive did not contain $Name" }
      Copy-Item -LiteralPath $Executable.FullName -Destination (Join-Path $ToolchainRoot $Name) -Force
    }
  } else {
    Write-Host "Reusing FFmpeg in $ToolchainRoot"
  }

  $CurrentStep = "Installing CUDA whisper.cpp"
  Write-Host "[4/6] $CurrentStep"
  $WhisperRelease = "existing"
  $CudaMissing = @("whisper-cli.exe", "whisper-server.exe", "ggml-cuda.dll") |
    ForEach-Object { Test-Path -LiteralPath (Join-Path $CudaDir $_) } |
    Where-Object { -not $_ }
  if ($ForceUpdate -or $CudaMissing.Count -gt 0) {
    $Release = Invoke-RestMethod `
      -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest" `
      -Headers @{ "User-Agent" = "AnySubtitle-Installer" }
    $WhisperRelease = [string]$Release.tag_name
    $CudaAsset = $Release.assets |
      ForEach-Object {
        $Match = [regex]::Match($_.name, "^whisper-cublas-(\d+\.\d+\.\d+)-bin-x64\.zip$")
        if ($Match.Success) {
          [PSCustomObject]@{ Asset = $_; Version = [version]$Match.Groups[1].Value }
        }
      } |
      Sort-Object Version -Descending |
      Select-Object -First 1
    if (-not $CudaAsset) {
      throw "The latest whisper.cpp release does not contain a Windows x64 CUDA archive."
    }
    $CudaZip = Join-Path $DownloadsDir $CudaAsset.Asset.name
    Download-File $CudaAsset.Asset.browser_download_url $CudaZip 100000000
    $CudaExtract = Join-Path $TempDir "whisper-cuda"
    Expand-DownloadedArchive $CudaZip $CudaExtract
    $WhisperCli = Get-ChildItem -LiteralPath $CudaExtract -Recurse -Filter whisper-cli.exe | Select-Object -First 1
    if (-not $WhisperCli) { throw "CUDA whisper.cpp archive did not contain whisper-cli.exe" }
    Get-ChildItem -LiteralPath $WhisperCli.Directory.FullName -File |
      Copy-Item -Destination $CudaDir -Force
    foreach ($Name in @("whisper-cli.exe", "whisper-server.exe", "ggml-cuda.dll")) {
      if (-not (Test-Path -LiteralPath (Join-Path $CudaDir $Name))) {
        throw "CUDA whisper.cpp archive did not contain $Name"
      }
    }
  } else {
    Write-Host "Reusing CUDA whisper.cpp in $CudaDir"
  }

  $CurrentStep = "Installing subtitle models"
  Write-Host "[5/6] $CurrentStep"
  Download-File `
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" `
    (Join-Path $ModelsDir "ggml-small.bin") `
    400000000
  Download-File `
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin" `
    (Join-Path $ModelsDir "ggml-large-v3-turbo.bin") `
    1500000000
  Download-File `
    "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin" `
    (Join-Path $ModelsDir "ggml-silero-v6.2.0.bin") `
    500000

  $CurrentStep = "Registering Any Subtitle with Chromium browsers"
  Write-Host "[6/6] $CurrentStep"
  Save-ToolchainSettings
  Register-NativeHost

  $InstallState = [ordered]@{
    version = "0.3.1"
    installedAt = (Get-Date).ToString("o")
    extensionId = $ExtensionId
    toolchainRoot = $ToolchainRoot
    whisperRelease = $WhisperRelease
  }
  Write-Utf8NoBom (Join-Path $AppDir "install-state.json") ($InstallState | ConvertTo-Json -Depth 4)
  $Succeeded = $true
  Write-Host ""
  Write-Host "Any Subtitle 本機核心已安裝完成。" -ForegroundColor Green
  Write-Host "請回到擴充功能設定頁按『重新檢查』。"
} catch {
  $ErrorRecord = $_
  $ErrorDetails = @(
    "Any Subtitle Local Core setup failed."
    "Time: $((Get-Date).ToString('o'))"
    "Step: $CurrentStep"
    "Error: $($ErrorRecord.Exception.Message)"
    ""
    ($ErrorRecord | Out-String).Trim()
  ) -join [Environment]::NewLine
  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
  Write-Utf8NoBom $ErrorPath $ErrorDetails
  [Console]::Error.WriteLine($ErrorDetails)
  exit 1
} finally {
  if (Test-Path -LiteralPath $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($Succeeded -and (Test-Path -LiteralPath $DownloadsDir)) {
    Remove-Item -LiteralPath $DownloadsDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
