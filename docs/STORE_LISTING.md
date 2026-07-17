# Chrome Web Store Listing Draft

## zh-TW

### 名稱

Any Subtitle

### 簡短說明

使用本機 NVIDIA GPU，為目前分頁產生即時或精準字幕；影音不送往雲端辨識。

### 詳細說明

Any Subtitle 會在目前影片播放器上顯示本機產生的字幕。

主要功能：

- 即時字幕：擷取使用者目前選取的分頁音訊，通常在數秒內更新字幕。
- 精準字幕：優先使用頁面字幕或可取得的音訊，透過較大的 Whisper 模型產生完整字幕。
- 本機運算：FFmpeg、yt-dlp 與 CUDA whisper.cpp 由 Windows 本機核心執行，不使用雲端語音辨識。
- 台灣繁體：中文辨識結果可在本機以 OpenCC 正規化為台灣繁體。
- 七天快取：精準字幕會在本機保留七天，再次開啟相同頁面可直接使用。
- 播放器同步：字幕跟隨播放、暫停、跳轉、倍速與全螢幕顯示。

首次使用需要另外安裝免費的 **Any Subtitle Local Core for Windows**。設定頁會提供下載連結並自動檢查安裝狀態。模型與工具不包含在 Chrome Web Store 套件內，完整安裝約需 5 GB 可用空間與 NVIDIA GTX／RTX 顯示卡。

Any Subtitle 不提供影片下載或匯出功能。使用者應只處理自己擁有或獲准存取的內容。受 DRM 保護、純 canvas 播放器、Chrome 內部頁面與 Picture-in-Picture 視窗不保證支援。

### 隱私摘要

字幕辨識在本機執行，沒有雲端 ASR、廣告、分析或遙測。即時音訊不保留；精準字幕快取七天。只有在使用者明確重試受保護內容並授權後，才會暫時讀取目前網站的 cookies。

## en

### Name

Any Subtitle

### Short description

Generate live or accurate captions for the current tab locally with an NVIDIA GPU.

### Detailed description

Any Subtitle displays locally generated captions over the current video player.

- Live captions update every few seconds from user-selected tab audio.
- Accurate captions use existing page tracks when available or transcribe accessible media with a larger Whisper model.
- FFmpeg, yt-dlp and CUDA whisper.cpp run through a local Windows companion; there is no cloud speech recognition.
- Chinese results can be normalized locally to Taiwan Traditional Chinese.
- Accurate tracks are cached locally for seven days.
- Captions follow play, pause, seek, playback speed and fullscreen changes.

First use requires the free **Any Subtitle Local Core for Windows**. The setup page provides the download and checks its status. The complete installation needs about 5 GB of free space and an NVIDIA GTX/RTX GPU.

Any Subtitle does not provide video download or export functionality. Use it only with content you own or are authorized to access. DRM media, canvas-only players, browser internal pages and Picture-in-Picture windows are not guaranteed.

### Privacy summary

Transcription runs locally with no cloud ASR, ads, analytics or telemetry. Live audio is not retained. Accurate tracks are cached for seven days. Current-site cookies are read only after an explicit optional permission grant for a protected request and are deleted after that job.

## Public URLs

- Homepage: `https://www.dowen.idv.tw/any_subtitle/`
- Privacy: `https://www.dowen.idv.tw/any_subtitle/privacy.html`
- Support: `https://www.dowen.idv.tw/any_subtitle/support.html`
- Local Core: `https://github.com/Tokenyet/any_subtitle/releases/latest/download/AnySubtitleCoreSetup.exe`
