# Any Subtitle Privacy Policy

Last updated: July 17, 2026

Any Subtitle creates subtitles for media playing in the browser. Subtitle
generation runs on the user's Windows computer through the separately installed
Any Subtitle Local Core. Any Subtitle does not provide cloud speech recognition,
advertising, analytics or telemetry.

## Data processed

When the user explicitly starts live or accurate subtitles, Any Subtitle may
process:

- Audio from the selected browser tab.
- The selected page URL, page title and accessible HTML media metadata.
- Existing caption tracks exposed by the page.
- The user's selected subtitle language and Traditional Chinese preference.
- Cookies for the current website, only after the user grants the optional
  website and cookies permission for a protected accurate-subtitle request.

This information is used only to generate and synchronize subtitles for the
user-requested page.

## Storage and retention

- Language and Traditional Chinese preferences are stored in Chromium sync
  storage and may be synchronized by the user's browser account.
- Generated accurate subtitle tracks and their page metadata are stored under
  `%LOCALAPPDATA%\AnySubtitle\tracks` for up to seven days.
- Live audio is processed in short memory buffers and is not retained.
- Full-playback recording mode creates a temporary local audio file. It is
  deleted after transcription, cancellation or failure cleanup.
- Cookies requested for one protected job are written only to a temporary local
  file for the media request and deleted when that request finishes.

## Network activity

The Chrome extension does not send audio, subtitles, browsing activity or
cookies to the developer.

For accurate subtitles, the Local Core may connect directly to the website and
its media delivery hosts to obtain media that the user asked to transcribe. The
Local Core uses yt-dlp and FFmpeg for this user-initiated operation. Users are
responsible for using the feature only with content they are authorized to
access.

During installation or repair, the Local Core downloads tools and models from
their public release sources:

- GitHub releases for yt-dlp, Deno and whisper.cpp.
- Hugging Face for whisper.cpp speech and VAD models.
- gyan.dev for the Windows FFmpeg build.

Any Subtitle does not sell personal data, use it for advertising, use it for
creditworthiness, or transfer it to the developer or data brokers.

## Uninstalling and deleting local data

Uninstall **Any Subtitle Local Core** from Windows Installed Apps to remove its
Native Messaging registration, downloaded tools, models, cached subtitles and
temporary files. Removing only the browser extension does not automatically
remove the separately installed Local Core.

## Contact

Support page: https://www.dowen.idv.tw/any_subtitle/support.html
