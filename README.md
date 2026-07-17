# Any Subtitle

Any Subtitle is a Windows-first Chromium extension that generates subtitles locally for the current tab.

- **Live subtitles** capture the active tab audio and update an overlay every few seconds.
- **Accurate subtitles** reuse page caption tracks when available, otherwise download or record audio and run a larger local Whisper model.
- Accurate tracks are cached per video-page URL for seven days. While a cache is valid, the popup offers **Use accurate subtitles** instead of retranscribing.
- Audio and transcripts stay on the computer. There is no cloud ASR or telemetry.

## Architecture

`toolbar popup → MV3 service worker (tab stream ID) → offscreen AudioWorklet → native messaging host → CUDA whisper.cpp`

The content script places a Shadow DOM subtitle layer at the lower center of the page and moves it into the fullscreen element when necessary.

## Requirements

- Windows 10/11
- Chrome, Edge, Chromium, or Vivaldi 116+
- NVIDIA GTX/RTX GPU with a current NVIDIA driver
- About 5 GB of free disk space

## Install from the Chrome Web Store

Any Subtitle has two parts. The Chrome Web Store package captures the current tab
audio and displays captions. The separately installed **Any Subtitle Local Core**
runs FFmpeg, yt-dlp and CUDA Whisper on the computer.

1. Install Any Subtitle from the Chrome Web Store.
2. The first-run page opens automatically. Choose **Download Any Subtitle Local Core**.
3. Run `AnySubtitleCoreSetup.exe` and allow it to finish the model downloads.
4. Return to the first-run page and choose **I installed it, check again**.

The bootstrap installer downloads approximately 2.5–3 GB and uses approximately
4 GB after installation. It obtains tools and models from their public release
sources on GitHub, Hugging Face and the FFmpeg build provider. It does not bundle
the multi-gigabyte models into the Chrome Web Store ZIP.

## Install for development

Development can reuse the shared local-exporter toolchain at
`%LOCALAPPDATA%\com.dowen.local_exporter\toolchain`. Python 3.11+ is required when
running the source native host.

1. Prepare the missing models and verify the existing CUDA whisper.cpp tools:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\update-tools.ps1
   ```

2. Package the extension:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1
   ```

3. Load `dist\unpacked\any-subtitle` with **Load unpacked**, then copy its extension ID.

4. Register the native host:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install-native.ps1 -ExtensionId <extension-id>
   ```

5. Open a video page, click the Any Subtitle toolbar icon, and choose live or accurate subtitles.

## Build the public Windows core installer

The Chrome Web Store assigns a permanent extension ID after the first draft item
is created. Build the companion installer with that ID so its Native Messaging
allowlist accepts only the published extension:

```powershell
winget install JRSoftware.InnoSetup
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1 `
  -ExtensionId <chrome-web-store-extension-id>
```

Output: `dist\installer\AnySubtitleCoreSetup.exe`.

The first-run page currently points to the stable release asset URL
`https://github.com/Tokenyet/any_subtitle/releases/latest/download/AnySubtitleCoreSetup.exe`.
That public release location must exist before submitting the store package.

After updating the unpacked files, reload Any Subtitle from the browser extension
manager. For live subtitles, open the popup by clicking the Any Subtitle toolbar
icon on the video tab; the service worker records that exact tab ID. If the popup
was left open while switching tabs, click the toolbar icon again on the new video
tab before starting subtitles.

The live status should progress from obtaining tab audio, to receiving audio, to
waiting for speech recognition. If no PCM arrives within five seconds, the page
overlay and toolbar popup show an audio-capture warning instead of remaining stuck.
The offscreen AudioContext resume is non-blocking, and the silent AudioWorklet
output remains connected to the destination so Chromium continues processing it.
Paused or muted players produce PCM silence. Live sessions discard near-silent
windows before calling whisper-server, preventing the VAD plus auto-language
no-speech crash and avoiding repeated model reloads.

Cookie access is optional. It is requested for the current origin only when the user retries a protected accurate-subtitle job.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the complete local data and network
behavior disclosure.

## Validation

```powershell
npm test
npm run smoke
npm run smoke:browser
python .\scripts\ping-host.py
python .\scripts\validate-gpu.py "<local-media-file>"
powershell -ExecutionPolicy Bypass -File .\scripts\package.ps1
```

`smoke:browser` verifies unpacked loading, native messaging, page TextTrack import,
the overlay, seek synchronization, and fullscreen placement. Automated DevTools
sessions do not receive Chrome's `activeTab` grant, so tab capture is reported as
skipped there; `validate-gpu.py` validates the live PCM-to-CUDA transcription path
with real audio.

## Current v1 boundaries

- One GPU transcription job at a time.
- Accurate synchronization requires an accessible HTML `<video>` or `<audio>` element.
- DRM-protected media, browser internal pages, Picture-in-Picture windows, and canvas-only players are not guaranteed.
- Translation, speaker diarization, Firefox, and mobile browsers are not included.
