const MESSAGE_TYPE = "any-subtitle";
const CORE_DOWNLOAD_URL = "https://github.com/Tokenyet/any_subtitle/releases/latest/download/AnySubtitleCoreSetup.exe";
const { localizeDocument, msg } = globalThis.AnySubtitleI18n;
const TOOL_LABELS = {
  "ffmpeg": "FFmpeg",
  "ffprobe": "FFprobe",
  "yt-dlp": "yt-dlp",
  "whisper-server": msg("toolWhisperLive"),
  "whisper-cli": msg("toolWhisperAccurate"),
  "small-model": msg("toolSmallModel"),
  "accurate-model": msg("toolAccurateModel"),
  "vad-model": msg("toolVadModel")
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
  localizeDocument();
  elements.version.textContent = `Any Subtitle ${chrome.runtime.getManifest().version}`;
  elements.download.addEventListener("click", downloadCore);
  elements.recheck.addEventListener("click", checkCore);
  checkCore();
});

async function downloadCore() {
  await chrome.tabs.create({ url: CORE_DOWNLOAD_URL });
}

async function checkCore() {
  render("checking", msg("checkingCore"), msg("pleaseWait"));
  try {
    const response = await send("ping");
    const status = response.response || {};
    if (status.liveReady && status.accurateReady) {
      render("ready", msg("coreReadyTitle"), msg("coreReadyDetail"));
      return;
    }
    const missing = Object.entries(TOOL_LABELS)
      .filter(([key]) => status.tools?.[key]?.available !== true)
      .map(([, label]) => label);
    render(
      "error",
      msg("coreIncompleteTitle"),
      missing.length
        ? msg("missingInstallerTools", [formatList(missing)])
        : msg("rerunInstaller")
    );
  } catch {
    render("error", msg("coreNotInstalledTitle"), msg("coreNotInstalledDetail"));
  }
}

function render(state, title, detail) {
  elements.card.className = `status-card ${state}`;
  elements.title.textContent = title;
  elements.detail.textContent = detail;
}

function formatList(items) {
  const locale = chrome.i18n.getMessage("@@ui_locale").replaceAll("_", "-") || "en";
  return new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(items);
}

function send(action) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE, action }, (response) => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) {
        reject(new Error(error?.message || response?.error || msg("coreConnectionFailed")));
        return;
      }
      resolve(response);
    });
  });
}
