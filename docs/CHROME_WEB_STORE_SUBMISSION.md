# Chrome Web Store Submission Draft

This document is paste-ready for the current package. Confirm the live dashboard
values once more before submitting the item for review.

## Package

- Version: `0.3.0`
- Chrome Web Store extension ID: `eafleifhjcogliglgohddcgfbpeaioni`
- ZIP: `dist/any-subtitle.zip`
- Target: Unlisted beta, Windows, Chrome/Edge/Vivaldi 116+
- Companion: `AnySubtitleCoreSetup.exe`

## Single purpose

Generate and display local live or accurate subtitles for media playing in the
user-selected browser tab.

## Permission justifications

### activeTab

Granted only when the user clicks the Any Subtitle toolbar button. It identifies
the selected HTTP(S) media page and lets the extension communicate with the
caption overlay for that tab. Inactive tabs are not scanned.

### scripting

Injects the packaged `src/content.js` into the user-selected tab after the user
starts or loads subtitles. The script reads accessible HTML media timing and
caption tracks and renders the subtitle overlay. It is not injected into browser
internal pages.

### tabCapture

Captures audio from the user-selected tab only after the user starts live
captions or full-playback recording. The audio is sent through Native Messaging
to the Local Core on the same computer for transcription.

### offscreen

Keeps the tab audio capture and packaged AudioWorklet running after the toolbar
popup closes. It also routes the captured audio back to the tab output so the
user continues to hear the media.

### storage

Stores the selected language and Taiwan Traditional Chinese preference in
`chrome.storage.sync`. No audio, cookies or generated subtitle tracks are stored
in extension storage. Subtitle tracks are stored by the Local Core on the local
Windows filesystem for up to seven days.

### nativeMessaging

Connects to the separately installed `com.dowen.any_subtitle` Windows Local Core.
The Local Core performs local FFmpeg, yt-dlp and CUDA Whisper processing and
returns caption cues and job status. It does not send data to the developer.

### Optional cookies

Requested only when an accurate-subtitle request fails because the selected
content requires the user's existing website session and the user chooses the
explicit retry action. Cookies are limited to the current website and used only
for that job.

### Optional HTTP(S) website access

Requested only for the current website together with the optional cookies
permission. It permits Chrome to return the current site's cookies for the
user-requested protected media operation. Broad website access is not granted at
installation time.

## Website access

The extension runs only on the active HTTP(S) tab after a toolbar action. It
reads accessible page title, URL, HTML video/audio timing, current media source
and caption tracks to generate and synchronize subtitles. It adds a Shadow DOM
subtitle overlay to the page. It does not scan browsing history or other tabs.

## Remote code

Select: **No, I am not using remote code.**

Paste:

> All JavaScript, HTML, CSS and AudioWorklet code executed by the extension is
> packaged inside the submitted Chrome Web Store ZIP. The extension does not
> download or execute remote JavaScript or WebAssembly. A separately installed
> Windows Native Messaging companion runs local native executables and speech
> models outside the extension process; this companion is disclosed in the
> listing and reviewer instructions.

## Privacy practices

### Data categories to select

- Website content: selected-tab audio, accessible media metadata and caption
  tracks are processed to generate subtitles.
- Authentication information: only if the dashboard treats explicitly granted
  current-site cookies as collection, select this category conservatively.

### Data categories not used

- Personally identifiable information
- Health information
- Financial and payment information
- Personal communications
- Location
- Web history as an analytics or profiling dataset
- User activity such as clicks, mouse position or keystrokes

### Data use statement

> Selected-tab audio, page metadata, caption tracks and optional current-site
> cookies are used only to generate subtitles requested by the user. Processing
> occurs in the browser and in the separately installed Local Core on the same
> computer. Data is not sold, transferred to the developer, used for advertising,
> used for creditworthiness or sent to a cloud speech-recognition service.

### Limited-use certification

The extension uses data only to provide its prominent single purpose. It does
not use or transfer user data for personalized advertising, lending or credit,
or unrelated purposes. Human access by the developer is not available because
the developer does not receive the processed data.

## Public URLs

- Homepage: `https://www.dowen.idv.tw/any_subtitle/`
- Privacy policy: `https://www.dowen.idv.tw/any_subtitle/privacy.html`
- Support: `https://www.dowen.idv.tw/any_subtitle/support.html`

## Reviewer instructions

1. Install the Chrome Web Store package on Windows 10/11 with an NVIDIA GTX/RTX GPU.
2. The first-run page opens automatically. Download and run Any Subtitle Local Core.
3. Allow the installer to download approximately 2.5–3 GB of tools and models.
4. Return to the first-run page and choose **I installed it, check again**. The page should report that both live and accurate modes are ready.
5. Open an ordinary HTTP(S) page with an accessible HTML5 video, start playback and click the Any Subtitle toolbar button.
6. Choose **Start live captions** to test tab audio capture and local captions.
7. Choose **Generate accurate captions** to test existing page tracks or local transcription.
8. Browser internal pages, DRM media, Picture-in-Picture windows and canvas-only players are outside the supported scope.

The Local Core installer must be compiled with the final store extension ID or
Chrome will reject the Native Messaging connection.

## Submission checklist

- [x] Create the first Chrome Web Store draft and record its permanent extension ID.
- [x] Build `AnySubtitleCoreSetup.exe` with that extension ID.
- [x] Publish the public Local Core release asset and verify the stable URL.
- [x] Publish and visually verify homepage, privacy and support URLs.
- [x] Replace the pending markers above with live verification results.
- [x] Upload the extension ZIP.
- [ ] Upload the store assets.
- [ ] Paste the permission and privacy answers above.
- [ ] Set distribution to Unlisted for the first review.
- [ ] Test the store-installed extension against the published installer before submitting for review.
