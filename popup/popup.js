const MESSAGE_TYPE = "any-subtitle";
const elements = Object.fromEntries([
  "host-state",
  "page-title",
  "page-url",
  "setup-card",
  "setup-message",
  "open-setup",
  "start-live",
  "start-accurate",
  "stop",
  "capture-card",
  "start-capture",
  "finish-capture",
  "cookie-card",
  "retry-cookies",
  "progress-value",
  "progress",
  "status",
  "language",
  "traditional"
].map((id) => [id, document.getElementById(id)]));

let currentJobId = "";
let currentSessionId = "";
let currentSessionHasAudio = false;
let lastAccurateRequest = null;
let currentTargetTabId = 0;
let currentPageAccessible = false;
let accurateCache = { available: false };
let hostAvailability = { connected: false, liveReady: false, accurateReady: false };

document.addEventListener("DOMContentLoaded", initialize);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== MESSAGE_TYPE) {
    return;
  }
  if (message.action === "nativeEvent") {
    handleNativeEvent(message.event || {});
  }
  if (message.action === "stateChanged") {
    applyState(message.state || {});
  }
});

async function initialize() {
  bindActions();
  await loadSettings();
  await refreshPage();
  await checkHost();
  await refreshAccurateCache().catch(() => {
    accurateCache = { available: false };
    updateButtons();
  });
  const response = await send("getState");
  applyState(response.state || {});
}

function bindActions() {
  elements["start-live"].addEventListener("click", () => run(startLive));
  elements["start-accurate"].addEventListener("click", () => run(startAccurate));
  elements.stop.addEventListener("click", () => run(stopCurrent));
  elements["start-capture"].addEventListener("click", () => run(startCapture));
  elements["finish-capture"].addEventListener("click", () => run(finishCapture));
  elements["retry-cookies"].addEventListener("click", () => run(retryWithCookies));
  elements["open-setup"].addEventListener("click", () => run(openSetup));
  elements.language.addEventListener("change", saveSettings);
  elements.traditional.addEventListener("change", saveSettings);
}

async function run(action) {
  try {
    setStatus("處理中…");
    await action();
  } catch (error) {
    setStatus(error.message || String(error));
  }
}

async function startLive() {
  currentSessionHasAudio = false;
  const response = await send("startLive", await actionPayload());
  currentSessionId = response.sessionId || "";
  await refreshPage().catch(() => {});
  setStatus(currentSessionHasAudio
    ? "已收到分頁音訊，正在等待語音辨識結果。"
    : "即時字幕已啟動，正在等待分頁音訊。");
}

async function startAccurate(extra = {}) {
  const request = { ...(await actionPayload()), ...extra };
  lastAccurateRequest = request;
  const response = await send("startAccurate", request);
  if (response.track) {
    accurateCache = {
      available: true,
      cueCount: response.track.cues?.length || 0
    };
    setStatus(response.cached
      ? `已使用七天內的精準字幕，共 ${response.track.cues?.length || 0} 段。`
      : `已載入頁面字幕，共 ${response.track.cues?.length || 0} 段。`);
    updateButtons();
    return;
  }
  currentJobId = response.jobId || "";
  setStatus("已開始產生精準字幕。");
}

async function stopCurrent() {
  await send("stopCurrent", { jobId: currentJobId, sessionId: currentSessionId });
  currentJobId = "";
  currentSessionId = "";
  currentSessionHasAudio = false;
  setStatus("已停止。");
  updateButtons();
}

async function startCapture() {
  currentSessionHasAudio = false;
  const response = await send("startCapture", await actionPayload());
  currentSessionId = response.sessionId || "";
  elements["start-capture"].hidden = true;
  elements["finish-capture"].hidden = false;
  setStatus("錄音中。請從目標位置播放影片，完成後按「完成錄音並轉錄」。");
}

async function finishCapture() {
  const response = await send("finishCapture", settingsPayload());
  currentSessionId = "";
  currentSessionHasAudio = false;
  currentJobId = response.jobId || "";
  elements["start-capture"].hidden = false;
  elements["finish-capture"].hidden = true;
  setStatus("錄音完成，正在產生精準字幕。");
}

async function retryWithCookies() {
  if (!lastAccurateRequest) {
    throw new Error("沒有可重試的工作。");
  }
  await startAccurate({ ...lastAccurateRequest, requestCookies: true });
  elements["cookie-card"].hidden = true;
}

async function checkHost() {
  try {
    const response = await send("ping");
    const status = response.response || {};
    hostAvailability = {
      connected: true,
      liveReady: status.liveReady === true,
      accurateReady: status.accurateReady === true
    };
    const fullyReady = hostAvailability.liveReady && hostAvailability.accurateReady;
    elements["host-state"].textContent = fullyReady
      ? "本機可用"
      : (hostAvailability.liveReady ? "部分可用" : "需完成設定");
    elements["host-state"].className = `badge ${fullyReady ? "ready" : "warning"}`;
    elements["setup-card"].hidden = fullyReady;
    if (!fullyReady) {
      const missing = missingToolLabels(status.tools || {});
      elements["setup-message"].textContent = missing.length
        ? `尚缺少：${missing.join("、")}。`
        : "本機核心已連線，但依賴工具尚未準備完成。";
      setStatus(status.message || elements["setup-message"].textContent);
    }
  } catch (error) {
    hostAvailability = { connected: false, liveReady: false, accurateReady: false };
    elements["host-state"].textContent = "未安裝";
    elements["host-state"].className = "badge error";
    elements["setup-card"].hidden = false;
    elements["setup-message"].textContent = "請先安裝一次 Any Subtitle 本機核心，影音與字幕辨識仍只在這台電腦上處理。";
    setStatus("尚未安裝 Any Subtitle 本機核心。請開啟安裝引導。");
  }
  updateButtons();
}

async function openSetup() {
  await send("openOnboarding");
  window.close();
}

async function refreshPage() {
  const targetTabId = await getCurrentTargetTabId();
  const response = await send("getActivePage", { targetTabId });
  currentPageAccessible = Boolean(response.page?.id && response.page?.url);
  elements["page-title"].textContent = response.page?.title
    || (currentPageAccessible ? "未命名分頁" : "目前分頁無法使用");
  elements["page-url"].textContent = response.page?.url || "";
  if (!currentPageAccessible) {
    setStatus("請切回一般 HTTP(S) 影片分頁，再點工具列上的 Any Subtitle 圖示。");
  }
  updateButtons();
}

async function refreshAccurateCache() {
  if (!currentPageAccessible || !currentTargetTabId) {
    accurateCache = { available: false };
    updateButtons();
    return;
  }
  const response = await send("getAccurateCache", { targetTabId: currentTargetTabId });
  accurateCache = response.cache || { available: false };
  updateButtons();
}

async function loadSettings() {
  const response = await send("getSettings");
  elements.language.value = response.settings?.language || "auto";
  elements.traditional.checked = response.settings?.traditionalChinese !== false;
}

async function saveSettings() {
  await send("saveSettings", settingsPayload());
}

function settingsPayload() {
  return {
    language: elements.language.value,
    traditionalChinese: elements.traditional.checked
  };
}

async function actionPayload() {
  return {
    ...settingsPayload(),
    targetTabId: await getCurrentTargetTabId()
  };
}

async function getCurrentTargetTabId() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find((candidate) => candidate?.id);
  if (!tab?.id) {
    throw new Error("找不到目前的影片分頁。請回到影片分頁後重試。");
  }
  currentTargetTabId = tab.id;
  return currentTargetTabId;
}

function handleNativeEvent(event) {
  if (event.jobId) {
    currentJobId = event.jobId;
  }
  if (event.sessionId) {
    if (event.sessionId !== currentSessionId) {
      currentSessionHasAudio = false;
    }
    currentSessionId = event.sessionId;
  }
  if (event.event === "jobProgress") {
    setProgress(event.percent, event.detail);
  } else if (event.event === "trackReady") {
    setProgress(100, "字幕已完成");
    currentJobId = "";
    accurateCache = { available: true };
  } else if (event.event === "sessionReady") {
    if (!currentSessionHasAudio) {
      setStatus("模型已就緒，正在等待分頁音訊。");
    }
  } else if (event.event === "audioCaptureActive") {
    currentSessionHasAudio = true;
    setStatus("已收到分頁音訊，正在等待語音辨識結果。");
  } else if (event.event === "captionUpdate") {
    currentSessionHasAudio = true;
    setStatus("即時字幕辨識中，字幕會顯示在播放器上。");
  } else if (event.event === "audioCaptureTimeout") {
    setStatus("尚未收到分頁音訊。請確認影片正在播放且分頁有聲音，再停止後重試。");
  } else if (event.event === "audioCaptureError") {
    setStatus(`音訊擷取失敗：${event.error || "未知錯誤"}`);
  } else if (event.event === "error") {
    setStatus(event.error || event.detail || "工作失敗");
    elements["capture-card"].hidden = !event.fallbackAvailable;
    elements["cookie-card"].hidden = !event.authenticationRequired;
    currentJobId = "";
  }
  updateButtons();
}

function applyState(state) {
  const previousSessionId = currentSessionId;
  currentJobId = state.jobId || "";
  currentSessionId = state.sessionId || "";
  if (!currentSessionId) {
    currentSessionHasAudio = false;
  } else if (Number(state.audioChunkCount) > 0) {
    currentSessionHasAudio = true;
  } else if (currentSessionId !== previousSessionId) {
    currentSessionHasAudio = false;
  }
  if (currentSessionId && state.mode === "live") {
    if (state.captureState === "error") {
      setStatus("音訊擷取失敗，請停止後重試。");
    } else if (state.captureState === "timeout") {
      setStatus("尚未收到分頁音訊。請確認影片正在播放且有聲音。");
    } else if (currentSessionHasAudio) {
      setStatus("即時字幕辨識中，字幕會顯示在播放器上。");
    } else {
      setStatus("即時字幕已啟動，正在等待分頁音訊。");
    }
  } else if (currentSessionId && state.mode === "capture") {
    setStatus(currentSessionHasAudio
      ? "完整播放錄音中，已收到分頁音訊。"
      : "完整播放錄音中，正在等待分頁音訊。");
  }
  elements["capture-card"].hidden = !state.fallbackAvailable;
  elements["cookie-card"].hidden = !state.authenticationRequired;
  updateButtons();
}

function updateButtons() {
  const busy = Boolean(currentJobId || currentSessionId);
  elements.stop.disabled = !busy;
  elements["start-live"].disabled = busy || !currentPageAccessible || !hostAvailability.liveReady;
  elements["start-accurate"].disabled = busy || !currentPageAccessible || !hostAvailability.accurateReady;
  elements["start-accurate"].textContent = accurateCache.available
    ? "使用精準字幕"
    : "產生精準字幕";
  elements["start-accurate"].title = accurateCache.available && accurateCache.expiresAt
    ? `快取有效至 ${new Date(accurateCache.expiresAt).toLocaleString()}`
    : "";
  elements["start-capture"].disabled = busy || !currentPageAccessible || !hostAvailability.accurateReady;
}

function missingToolLabels(tools) {
  const labels = {
    "ffmpeg": "FFmpeg",
    "ffprobe": "FFprobe",
    "yt-dlp": "yt-dlp",
    "whisper-server": "Whisper 即時核心",
    "whisper-cli": "Whisper 精準核心",
    "small-model": "即時字幕模型",
    "accurate-model": "精準字幕模型",
    "vad-model": "語音偵測模型"
  };
  return Object.entries(labels)
    .filter(([key]) => tools[key]?.available !== true)
    .map(([, label]) => label);
}

function setProgress(percent, detail) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  elements.progress.value = value;
  elements["progress-value"].textContent = `${Math.round(value)}%`;
  setStatus(detail || "");
}

function setStatus(text) {
  elements.status.textContent = String(text || "");
}

async function send(action, payload = {}) {
  const timeoutMs = ["startLive", "startCapture"].includes(action) ? 12000 : 35000;
  let timeout;
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE, action, ...payload }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(
        "擴充套件沒有回應。請關閉 popup，重新點擊工具列上的 Any Subtitle 後再試。"
      )), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed");
  }
  return response;
}
