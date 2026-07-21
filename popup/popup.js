const MESSAGE_TYPE = "any-subtitle";
const { localizeDocument, msg } = globalThis.AnySubtitleI18n;
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
let actionPending = false;
let backgroundBusy = false;
let stopPending = false;
let startAttempt = 0;

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
  localizeDocument();
  bindActions();
  await loadSettings();
  const stateResponse = await send("getState");
  applyState(stateResponse.state || {});
  await refreshPage();
  await checkHost();
  await refreshAccurateCache().catch(() => {
    accurateCache = { available: false };
    updateButtons();
  });
}

function bindActions() {
  elements["start-live"].addEventListener("click", () => run(startLive, { startsWork: true }));
  elements["start-accurate"].addEventListener("click", () => run(startAccurate, { startsWork: true }));
  elements.stop.addEventListener("click", () => run(stopCurrent));
  elements["start-capture"].addEventListener("click", () => run(startCapture, { startsWork: true }));
  elements["finish-capture"].addEventListener("click", () => run(finishCapture));
  elements["retry-cookies"].addEventListener("click", () => run(retryWithCookies, { startsWork: true }));
  elements["open-setup"].addEventListener("click", () => run(openSetup));
  elements.language.addEventListener("change", saveSettings);
  elements.traditional.addEventListener("change", saveSettings);
}

async function run(action, { startsWork = false } = {}) {
  const attempt = startsWork ? ++startAttempt : 0;
  if (startsWork) {
    actionPending = true;
    updateButtons();
  }
  try {
    setStatus(msg("processing"));
    await action(attempt);
  } catch (error) {
    if (!startsWork || attempt === startAttempt) {
      setStatus(error.message || String(error));
    }
  } finally {
    if (startsWork && attempt === startAttempt) {
      actionPending = false;
      updateButtons();
    }
  }
}

async function startLive(attempt) {
  currentSessionHasAudio = false;
  const payload = await actionPayload();
  if (attempt !== startAttempt) return;
  const response = await send("startLive", payload);
  if (response.cancelled || attempt !== startAttempt) return;
  currentSessionId = response.sessionId || "";
  await refreshPage().catch(() => {});
  setStatus(currentSessionHasAudio
    ? msg("audioReceivedWaiting")
    : msg("liveStartedWaiting"));
}

async function startAccurate(attempt, extra = {}) {
  const request = { ...(await actionPayload()), ...extra };
  if (attempt !== startAttempt) return;
  lastAccurateRequest = request;
  const response = await send("startAccurate", request);
  if (response.cancelled || attempt !== startAttempt) return;
  if (response.track) {
    accurateCache = {
      available: true,
      cueCount: response.track.cues?.length || 0
    };
    const cueCount = response.track.cues?.length || 0;
    setStatus(response.cached
      ? msg("cachedTrackUsed", [String(cueCount)])
      : msg("pageTrackLoaded", [String(cueCount)]));
    updateButtons();
    return;
  }
  currentJobId = response.jobId || "";
  setStatus(msg("accurateStarted"));
}

async function stopCurrent() {
  startAttempt += 1;
  actionPending = false;
  stopPending = true;
  updateButtons();
  try {
    await send("stopCurrent");
    backgroundBusy = false;
    currentJobId = "";
    currentSessionId = "";
    currentSessionHasAudio = false;
    setStatus(msg("stopped"));
  } finally {
    stopPending = false;
    updateButtons();
  }
}

async function startCapture(attempt) {
  currentSessionHasAudio = false;
  const payload = await actionPayload();
  if (attempt !== startAttempt) return;
  const response = await send("startCapture", payload);
  if (response.cancelled || attempt !== startAttempt) return;
  currentSessionId = response.sessionId || "";
  elements["start-capture"].hidden = true;
  elements["finish-capture"].hidden = false;
  setStatus(msg("captureRecordingInstructions"));
}

async function finishCapture() {
  const response = await send("finishCapture", settingsPayload());
  if (response.cancelled) return;
  currentSessionId = "";
  currentSessionHasAudio = false;
  currentJobId = response.jobId || "";
  elements["start-capture"].hidden = false;
  elements["finish-capture"].hidden = true;
  setStatus(msg("captureFinished"));
}

async function retryWithCookies(attempt) {
  if (!lastAccurateRequest) {
    throw new Error(msg("noRetryJob"));
  }
  await startAccurate(attempt, { ...lastAccurateRequest, requestCookies: true });
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
      ? msg("hostReady")
      : (hostAvailability.liveReady ? msg("hostPartiallyReady") : msg("setupIncomplete"));
    elements["host-state"].className = `badge ${fullyReady ? "ready" : "warning"}`;
    elements["setup-card"].hidden = fullyReady;
    if (!fullyReady) {
      const missing = missingToolLabels(status.tools || {});
      elements["setup-message"].textContent = missing.length
        ? msg("missingTools", [formatList(missing)])
        : msg("coreDependenciesIncomplete");
      setStatus(status.message || elements["setup-message"].textContent);
    }
  } catch (error) {
    hostAvailability = { connected: false, liveReady: false, accurateReady: false };
    elements["host-state"].textContent = msg("notInstalled");
    elements["host-state"].className = "badge error";
    elements["setup-card"].hidden = false;
    elements["setup-message"].textContent = msg("installCoreFirst");
    setStatus(msg("noCoreStatus"));
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
    || (currentPageAccessible ? msg("unnamedTab") : msg("unavailableTab"));
  elements["page-url"].textContent = response.page?.url || "";
  if (!currentPageAccessible) {
    setStatus(msg("switchToVideo"));
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
    throw new Error(msg("noTargetVideo"));
  }
  currentTargetTabId = tab.id;
  return currentTargetTabId;
}

function handleNativeEvent(event) {
  if (event.jobId) {
    currentJobId = event.jobId;
  }
  if (event.sessionId && event.event !== "sessionStopped") {
    if (event.sessionId !== currentSessionId) {
      currentSessionHasAudio = false;
    }
    currentSessionId = event.sessionId;
  }
  if (event.event === "jobProgress") {
    setProgress(event.percent, event.detail);
  } else if (event.event === "trackReady") {
    setProgress(100, msg("subtitlesComplete"));
    currentJobId = "";
    accurateCache = { available: true };
  } else if (event.event === "sessionReady") {
    if (!currentSessionHasAudio) {
      setStatus(msg("modelReadyWaitingAudio"));
    }
  } else if (event.event === "audioCaptureActive") {
    currentSessionHasAudio = true;
    setStatus(msg("audioReceivedWaiting"));
  } else if (event.event === "captionUpdate") {
    currentSessionHasAudio = true;
    setStatus(msg("liveRecognizing"));
  } else if (event.event === "audioCaptureTimeout") {
    setStatus(msg("noAudioTimeout"));
  } else if (event.event === "audioCaptureError") {
    setStatus(msg("audioCaptureFailed", [event.error || msg("unknownError")]));
  } else if (event.event === "error") {
    setStatus(event.error || event.detail || msg("jobFailed"));
    elements["capture-card"].hidden = !event.fallbackAvailable;
    elements["cookie-card"].hidden = !event.authenticationRequired;
    currentJobId = "";
  } else if (event.event === "sessionStopped") {
    currentSessionId = "";
    currentSessionHasAudio = false;
  }
  updateButtons();
}

function applyState(state) {
  const previousSessionId = currentSessionId;
  backgroundBusy = state.busy === true || Boolean(state.jobId || state.sessionId);
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
      setStatus(msg("liveCaptureFailed"));
    } else if (state.captureState === "timeout") {
      setStatus(msg("noAudio"));
    } else if (currentSessionHasAudio) {
      setStatus(msg("liveRecognizing"));
    } else {
      setStatus(msg("liveStartedWaiting"));
    }
  } else if (currentSessionId && state.mode === "capture") {
    setStatus(currentSessionHasAudio
      ? msg("captureAudioReceived")
      : msg("captureWaiting"));
  }
  elements["capture-card"].hidden = !state.fallbackAvailable;
  elements["cookie-card"].hidden = !state.authenticationRequired;
  updateButtons();
}

function updateButtons() {
  const busy = actionPending || stopPending || backgroundBusy || Boolean(currentJobId || currentSessionId);
  elements.stop.disabled = !busy || stopPending;
  elements["start-live"].disabled = busy || !currentPageAccessible || !hostAvailability.liveReady;
  elements["start-accurate"].disabled = busy || !currentPageAccessible || !hostAvailability.accurateReady;
  elements["start-accurate"].textContent = accurateCache.available
    ? msg("useAccurate")
    : msg("generateAccurate");
  elements["start-accurate"].title = accurateCache.available && accurateCache.expiresAt
    ? msg("cacheValidUntil", [new Date(accurateCache.expiresAt).toLocaleString(uiLocale())])
    : "";
  elements["start-capture"].disabled = busy || !currentPageAccessible || !hostAvailability.accurateReady;
}

function missingToolLabels(tools) {
  const labels = {
    "ffmpeg": "FFmpeg",
    "ffprobe": "FFprobe",
    "yt-dlp": "yt-dlp",
    "whisper-server": msg("toolWhisperLive"),
    "whisper-cli": msg("toolWhisperAccurate"),
    "small-model": msg("toolSmallModel"),
    "accurate-model": msg("toolAccurateModel"),
    "vad-model": msg("toolVadModel")
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

function uiLocale() {
  return chrome.i18n.getMessage("@@ui_locale").replaceAll("_", "-") || "en";
}

function formatList(items) {
  return new Intl.ListFormat(uiLocale(), { style: "short", type: "conjunction" }).format(items);
}

async function send(action, payload = {}) {
  const timeoutMs = ["startLive", "startCapture"].includes(action) ? 12000 : 35000;
  let timeout;
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type: MESSAGE_TYPE, action, ...payload }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(
        msg("extensionNoResponse")
      )), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
  if (!response?.ok) {
    throw new Error(response?.error || "Extension request failed");
  }
  return response;
}
