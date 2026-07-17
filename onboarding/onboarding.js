const MESSAGE_TYPE = "any-subtitle";
const CORE_DOWNLOAD_URL = "https://github.com/Tokenyet/any_subtitle/releases/latest/download/AnySubtitleCoreSetup.exe";
const TOOL_LABELS = {
  "ffmpeg": "FFmpeg",
  "ffprobe": "FFprobe",
  "yt-dlp": "yt-dlp",
  "whisper-server": "Whisper 即時核心",
  "whisper-cli": "Whisper 精準核心",
  "small-model": "即時字幕模型",
  "accurate-model": "精準字幕模型",
  "vad-model": "語音偵測模型"
};

const elements = {
  card: document.getElementById("status-card"),
  title: document.getElementById("status-title"),
  detail: document.getElementById("status-detail"),
  download: document.getElementById("download-core"),
  recheck: document.getElementById("recheck"),
  version: document.getElementById("extension-version")
};

document.addEventListener("DOMContentLoaded", () => {
  elements.version.textContent = `Any Subtitle ${chrome.runtime.getManifest().version}`;
  elements.download.addEventListener("click", downloadCore);
  elements.recheck.addEventListener("click", checkCore);
  checkCore();
});

async function downloadCore() {
  await chrome.tabs.create({ url: CORE_DOWNLOAD_URL });
}

async function checkCore() {
  render("checking", "正在檢查本機核心…", "請稍候。");
  try {
    const response = await send("ping");
    const status = response.response || {};
    if (status.liveReady && status.accurateReady) {
      render("ready", "本機核心已就緒", "可以關閉這個分頁，回到影片頁點擊 Any Subtitle。 ");
      return;
    }
    const missing = Object.entries(TOOL_LABELS)
      .filter(([key]) => status.tools?.[key]?.available !== true)
      .map(([, label]) => label);
    render(
      "error",
      "本機核心尚未完成",
      missing.length ? `尚缺少：${missing.join("、")}。請重新執行安裝器。` : "請重新執行安裝器。"
    );
  } catch {
    render("error", "尚未安裝本機核心", "下載並執行 Windows 安裝器，完成後再按「重新檢查」。");
  }
}

function render(state, title, detail) {
  elements.card.className = `status-card ${state}`;
  elements.title.textContent = title;
  elements.detail.textContent = detail;
}

function send(action) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE, action }, (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) {
        reject(new Error(error?.message || response?.error || "無法連線本機核心"));
        return;
      }
      resolve(response);
    });
  });
}
