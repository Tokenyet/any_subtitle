importScripts("i18n.js");

const MESSAGE_TYPE = "any-subtitle";
const HOST_NAME = "com.dowen.any_subtitle";
const { msg } = globalThis.AnySubtitleI18n;
const SETTINGS_KEY = "anySubtitleSettings";
const DEFAULT_SETTINGS = {
  language: "auto",
  traditionalChinese: true
};

let nativePort = null;
let pending = new Map();
let active = {
  operationId: "",
  phase: "",
  tabId: 0,
  sessionId: "",
  jobId: "",
  mode: "",
  audioChunkCount: 0,
  captureState: "",
  lastRequest: null,
  fallbackAvailable: false,
  authenticationRequired: false
};
const anchors = new Map();

chrome.runtime.onInstalled.addListener(async (details) => {
  const existing = await chrome.storage.sync.get(SETTINGS_KEY);
  if (!existing[SETTINGS_KEY]) {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
  if (details.reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/index.html") });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_TYPE) {
    return false;
  }
  if (message.target === "offscreen" || ["nativeEvent", "stateChanged"].includes(message.action)) {
    return false;
  }
  handleMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (active.tabId === tabId) {
    stopAll().catch(() => {});
  }
  anchors.delete(tabId);
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case "getSettings":
      return { settings: await loadSettings() };
    case "saveSettings":
      return { settings: await saveSettings(message) };
    case "getState":
      return { state: publicState() };
    case "getActivePage":
      return { page: await activePage(message.targetTabId) };
    case "getAccurateCache":
      return getAccurateCache(message);
    case "ping":
      return { response: await sendNativeOnce({ action: "ping" }, 20000) };
    case "openOnboarding":
      await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/index.html") });
      return {};
    case "startLive":
      return startLive(message);
    case "startAccurate":
      return startAccurate(message);
    case "startCapture":
      return startCapture(message);
    case "finishCapture":
      return finishCapture(message);
    case "stopCurrent":
      await stopAll();
      return {};
    case "reloadTrack":
      return reloadTrack(message);
    case "audioChunk":
      return forwardAudioChunk(message);
    case "audioCaptureState":
      return handleAudioCaptureState(message);
    case "audioCaptureError":
      return handleAudioCaptureError(message);
    case "timelineAnchor":
      return forwardTimelineAnchor(message, sender);
    case "captureEnded":
      return handleCaptureEnded(message);
    default:
      throw new Error(`Unknown action: ${message.action}`);
  }
}

async function startLive(options) {
  const operation = beginOperation("live", options);
  const resources = { tabId: Number(options.targetTabId) || 0, sessionId: "", jobId: "" };
  try {
    await stopSnapshot(operation.previous);
    requireActiveOperation(operation.id);
    const tab = await requireActiveTab(options.targetTabId);
    resources.tabId = tab.id;
    updateActiveOperation(operation.id, { tabId: tab.id });
    await ensureContent(tab.id);
    requireActiveOperation(operation.id);
    await ensureOffscreen();
    requireActiveOperation(operation.id);
    await sendContent(tab.id, "setOverlayStatus", { status: msg("gettingTabAudio") });
    requireActiveOperation(operation.id);
    const streamId = await getTabStreamId(tab.id);
    requireActiveOperation(operation.id);
    const sessionId = crypto.randomUUID();
    resources.sessionId = sessionId;
    updateActiveOperation(operation.id, { sessionId });
    await sendNative({
      action: "startLiveSession",
      sessionId,
      tabId: tab.id,
      url: tab.url || "",
      title: tab.title || "",
      language: normalizeLanguage(options.language),
      traditionalChinese: options.traditionalChinese !== false
    }, 30000);
    requireActiveOperation(operation.id);
    scheduleAudioCaptureCheck(sessionId, tab.id);
    const capture = await sendOffscreen("startAudioCapture", {
      streamId,
      sessionId,
      tabId: tab.id,
      mode: "live"
    });
    requireActiveOperation(operation.id);
    updateActiveOperation(operation.id, {
      captureState: capture.audioContextState || "started",
      phase: "running"
    });
    await sendContent(tab.id, "setOverlayStatus", { status: msg("startingLive") });
    requireActiveOperation(operation.id);
    return { sessionId };
  } catch (error) {
    return handleOperationFailure(operation.id, resources, error);
  }
}

async function startAccurate(options) {
  const operation = beginOperation("accurate", options);
  const resources = { tabId: Number(options.targetTabId) || 0, sessionId: "", jobId: "" };
  try {
    await stopSnapshot(operation.previous);
    requireActiveOperation(operation.id);
    const tab = await requireActiveTab(options.targetTabId);
    resources.tabId = tab.id;
    updateActiveOperation(operation.id, { tabId: tab.id });
    await ensureContent(tab.id);
    requireActiveOperation(operation.id);
    const cached = await sendNative({
      action: "loadTrack",
      url: tab.url || "",
      traditionalChinese: options.traditionalChinese !== false
    }, 20000);
    requireActiveOperation(operation.id);
    if (cached.track) {
      await sendContent(tab.id, "displayTrack", { track: cached.track });
      requireActiveOperation(operation.id);
      completeOperation(operation.id);
      return { track: cached.track, cached: true };
    }
    const media = await sendContent(tab.id, "getMediaInfo");
    requireActiveOperation(operation.id);
    const mediaInfo = media.media || {};
    const existingTrack = chooseExistingTrack(mediaInfo.tracks, options.language);
    if (existingTrack) {
      const track = {
        url: tab.url || mediaInfo.url || "",
        title: mediaInfo.title || tab.title || "",
        durationMs: mediaInfo.durationMs || 0,
        language: existingTrack.language || normalizeLanguage(options.language),
        source: "page-track",
        model: "",
        traditionalChinese: options.traditionalChinese !== false,
        generatedAt: new Date().toISOString(),
        cues: existingTrack.cues || []
      };
      const imported = await sendNative({ action: "importTrack", track }, 20000);
      requireActiveOperation(operation.id);
      const normalizedTrack = imported.track || track;
      await sendContent(tab.id, "displayTrack", { track: normalizedTrack });
      requireActiveOperation(operation.id);
      completeOperation(operation.id);
      return { track: normalizedTrack };
    }

    let cookies = [];
    if (options.requestCookies) {
      cookies = await requestAndCollectCookies(tab.url);
      requireActiveOperation(operation.id);
    }
    const request = {
      url: tab.url || mediaInfo.url || "",
      title: mediaInfo.title || tab.title || "",
      currentSrc: mediaInfo.currentSrc || "",
      durationMs: mediaInfo.durationMs || 0,
      language: normalizeLanguage(options.language),
      traditionalChinese: options.traditionalChinese !== false,
      cookies
    };
    const response = await sendNative({ action: "startAccurateJob", request }, 30000);
    resources.jobId = response.jobId || "";
    requireActiveOperation(operation.id);
    updateActiveOperation(operation.id, { jobId: resources.jobId, phase: "running" });
    await sendContent(tab.id, "setOverlayStatus", { status: msg("generatingAccurate") });
    requireActiveOperation(operation.id);
    return { jobId: resources.jobId };
  } catch (error) {
    return handleOperationFailure(operation.id, resources, error);
  }
}

async function getAccurateCache(options = {}) {
  const tab = await requireActiveTab(options.targetTabId);
  const response = await sendNative({
    action: "trackStatus",
    url: tab.url || ""
  }, 20000);
  return { cache: response.cache || { available: false } };
}

async function startCapture(options) {
  const operation = beginOperation("capture", options);
  const resources = { tabId: Number(options.targetTabId) || 0, sessionId: "", jobId: "" };
  try {
    await stopSnapshot(operation.previous);
    requireActiveOperation(operation.id);
    const tab = await requireActiveTab(options.targetTabId);
    resources.tabId = tab.id;
    updateActiveOperation(operation.id, { tabId: tab.id });
    await ensureContent(tab.id);
    requireActiveOperation(operation.id);
    await ensureOffscreen();
    requireActiveOperation(operation.id);
    const sessionId = crypto.randomUUID();
    resources.sessionId = sessionId;
    updateActiveOperation(operation.id, { sessionId });
    const media = await sendContent(tab.id, "getMediaInfo");
    requireActiveOperation(operation.id);
    await sendContent(tab.id, "setOverlayStatus", { status: msg("gettingTabAudio") });
    requireActiveOperation(operation.id);
    const streamId = await getTabStreamId(tab.id);
    requireActiveOperation(operation.id);
    await sendNative({
      action: "startCaptureSession",
      sessionId,
      request: {
        url: tab.url || "",
        title: media.media?.title || tab.title || "",
        durationMs: media.media?.durationMs || 0,
        language: normalizeLanguage(options.language),
        traditionalChinese: options.traditionalChinese !== false
      }
    }, 20000);
    requireActiveOperation(operation.id);
    const captureInfo = await sendOffscreen("startAudioCapture", {
      streamId,
      sessionId,
      tabId: tab.id,
      mode: "capture"
    });
    requireActiveOperation(operation.id);
    updateActiveOperation(operation.id, {
      captureState: captureInfo?.audioContextState || "started",
      fallbackAvailable: true,
      phase: "running"
    });
    await sendContent(tab.id, "setOverlayStatus", { status: msg("fullPlaybackRecording") });
    requireActiveOperation(operation.id);
    scheduleAudioCaptureCheck(sessionId, tab.id);
    return { sessionId };
  } catch (error) {
    return handleOperationFailure(operation.id, resources, error);
  }
}

async function finishCapture(options) {
  if (!active.sessionId || active.mode !== "capture") {
    throw new Error(msg("noCaptureSession"));
  }
  const operationId = active.operationId;
  const sessionId = active.sessionId;
  await sendOffscreen("stopAudioCapture", { sessionId });
  if (!isActiveOperation(operationId)) {
    return { cancelled: true };
  }
  const response = await sendNative({
    action: "finalizeCapture",
    sessionId,
    language: normalizeLanguage(options.language),
    traditionalChinese: options.traditionalChinese !== false
  }, 30000);
  if (!isActiveOperation(operationId)) {
    if (response.jobId) {
      await sendNative({ action: "cancelJob", jobId: response.jobId }, 15000).catch(() => {});
    }
    return { cancelled: true };
  }
  active.sessionId = "";
  active.jobId = response.jobId || "";
  active.mode = "accurate";
  active.phase = "running";
  broadcastState();
  return { jobId: active.jobId };
}

async function reloadTrack(options = {}) {
  const tab = await requireActiveTab(options.targetTabId);
  await ensureContent(tab.id);
  const response = await sendNative({
    action: "loadTrack",
    url: tab.url || "",
    traditionalChinese: options.traditionalChinese !== false
  }, 20000);
  if (response.track) {
    await sendContent(tab.id, "displayTrack", { track: response.track });
  }
  return { track: response.track || null };
}

async function forwardAudioChunk(message) {
  if (!active.sessionId || message.sessionId !== active.sessionId) {
    return { ignored: true };
  }
  const firstChunk = active.audioChunkCount === 0;
  active.audioChunkCount += 1;
  active.captureState = "active";
  if (firstChunk) {
    const event = {
      event: "audioCaptureActive",
      sessionId: active.sessionId,
      sequence: Number(message.sequence) || 0
    };
    sendContent(active.tabId, "setOverlayStatus", {
      status: active.mode === "capture"
        ? msg("captureAudioReceived")
        : msg("liveAudioCaptureWaiting")
    }).catch(() => {});
    broadcastNativeEvent(event);
    broadcastState();
  }
  const anchor = anchors.get(Number(message.tabId)) || null;
  await sendNative({
    action: "audioChunk",
    sessionId: message.sessionId,
    sequence: Number(message.sequence),
    capturedAtMs: Number(message.capturedAtMs) || Date.now(),
    pcmBase64: String(message.pcmBase64 || ""),
    anchor
  }, 20000);
  return {};
}

async function handleAudioCaptureState(message) {
  if (!active.sessionId || message.sessionId !== active.sessionId) {
    return { ignored: true };
  }
  active.captureState = String(message.state || "unknown");
  broadcastState();
  return {};
}

async function handleAudioCaptureError(message) {
  if (!active.sessionId || message.sessionId !== active.sessionId) {
    return { ignored: true };
  }
  active.captureState = "error";
  const event = {
    event: "audioCaptureError",
    sessionId: active.sessionId,
    error: String(message.error || msg("tabAudioCaptureFailed"))
  };
  sendContent(active.tabId, "setOverlayStatus", {
    status: msg("audioCaptureFailed", [event.error])
  }).catch(() => {});
  broadcastNativeEvent(event);
  broadcastState();
  return {};
}

async function forwardTimelineAnchor(message, sender) {
  const tabId = sender.tab?.id || active.tabId;
  if (!tabId) {
    return {};
  }
  anchors.set(tabId, message.anchor || {});
  if (active.sessionId && active.tabId === tabId) {
    await sendNative({
      action: "timelineAnchor",
      sessionId: active.sessionId,
      anchor: message.anchor || {}
    }, 10000);
  }
  return {};
}

async function handleCaptureEnded(message) {
  if (message.sessionId === active.sessionId && active.mode === "live") {
    await stopAll();
  }
  return {};
}

async function stopAll() {
  const snapshot = active;
  resetActive();
  broadcastState();
  await stopSnapshot(snapshot);
}

async function stopSnapshot(snapshot, { clearOverlay = true } = {}) {
  if (snapshot.sessionId) {
    await sendOffscreen("stopAudioCapture", { sessionId: snapshot.sessionId }).catch(() => {});
    await sendNative({ action: "stopSession", sessionId: snapshot.sessionId }, 15000).catch(() => {});
  }
  if (snapshot.jobId) {
    await sendNative({ action: "cancelJob", jobId: snapshot.jobId }, 15000).catch(() => {});
  }
  if (clearOverlay && snapshot.tabId) {
    await sendContent(snapshot.tabId, "clearOverlay", { remove: false }).catch(() => {});
  }
}

function beginOperation(mode, options) {
  const previous = active;
  const id = crypto.randomUUID();
  active = {
    operationId: id,
    phase: "starting",
    tabId: Number(options.targetTabId) || 0,
    sessionId: "",
    jobId: "",
    mode,
    audioChunkCount: 0,
    captureState: "starting",
    lastRequest: options,
    fallbackAvailable: false,
    authenticationRequired: false
  };
  broadcastState();
  return { id, previous };
}

function isActiveOperation(operationId) {
  return Boolean(operationId && active.operationId === operationId);
}

function requireActiveOperation(operationId) {
  if (!isActiveOperation(operationId)) {
    throw new OperationCancelled();
  }
}

function updateActiveOperation(operationId, changes) {
  requireActiveOperation(operationId);
  Object.assign(active, changes);
  broadcastState();
}

function completeOperation(operationId) {
  requireActiveOperation(operationId);
  resetActive();
  broadcastState();
}

async function handleOperationFailure(operationId, resources, error) {
  const cancelled = error instanceof OperationCancelled || !isActiveOperation(operationId);
  if (isActiveOperation(operationId)) {
    const snapshot = active;
    resetActive();
    broadcastState();
    await stopSnapshot(snapshot);
  } else {
    await stopSnapshot(resources, { clearOverlay: false });
  }
  if (cancelled) {
    return { cancelled: true };
  }
  throw error;
}

async function ensureContent(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPE, action: "pingContent" });
    if (response?.ok) {
      return;
    }
  } catch {
    // Inject below.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/i18n.js", "src/content.js"]
  });
}

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen/offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });
  if (contexts.length) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture current tab audio for local subtitle generation."
  });
}

function getTabStreamId(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(
        msg("streamTimeout")
      ));
    }, 8000);
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const error = chrome.runtime.lastError?.message;
      if (error || !streamId) {
        reject(new Error(
          error || msg("streamUnavailable")
        ));
        return;
      }
      resolve(streamId);
    });
  });
}

function scheduleAudioCaptureCheck(sessionId, tabId) {
  setTimeout(() => {
    if (
      active.sessionId !== sessionId
      || active.tabId !== tabId
      || active.audioChunkCount > 0
    ) {
      return;
    }
    active.captureState = "timeout";
    const event = { event: "audioCaptureTimeout", sessionId };
    sendContent(tabId, "setOverlayStatus", {
      status: msg("tabAudioTimeout")
    }).catch(() => {});
    broadcastNativeEvent(event);
    broadcastState();
  }, 5000);
}

async function sendOffscreen(action, payload) {
  let timeout;
  const response = await Promise.race([
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPE,
      target: "offscreen",
      action,
      ...payload
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(
        msg("offscreenTimeout")
      )), 10000);
    })
  ]).finally(() => clearTimeout(timeout));
  if (!response?.ok) {
    throw new Error(response?.error || "Offscreen audio request failed");
  }
  return response;
}

async function sendContent(tabId, action, payload = {}) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPE,
    action,
    ...payload
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Content script request failed");
  }
  return response;
}

async function requireActiveTab(preferredTabId = 0) {
  const tab = await resolveTargetTab(preferredTabId);
  if (!tab) {
    throw new Error(
      msg("inaccessibleTab")
    );
  }
  return tab;
}

async function resolveTargetTab(preferredTabId = 0) {
  const candidateIds = [preferredTabId]
    .map((value) => Number(value) || 0)
    .filter((value, index, values) => value && values.indexOf(value) === index);

  for (const tabId of candidateIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (/^https?:/i.test(tab.url || "")) {
        return tab;
      }
    } catch {
      // The stored tab was closed; try the focused browser window below.
    }
  }

  const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const fallback = focused.find((tab) => tab?.id && /^https?:/i.test(tab.url || ""));
  return fallback || null;
}

async function activePage(preferredTabId = 0) {
  const tab = await resolveTargetTab(preferredTabId);
  return {
    id: tab?.id || 0,
    url: tab?.url || "",
    title: tab?.title || ""
  };
}

function chooseExistingTrack(tracks, requestedLanguage) {
  const list = Array.isArray(tracks) ? tracks.filter((track) => track?.cues?.length) : [];
  if (!list.length) {
    return null;
  }
  if (requestedLanguage && requestedLanguage !== "auto") {
    return list.find((track) => String(track.language || "").toLowerCase().startsWith(requestedLanguage)) || null;
  }
  return list[0];
}

async function requestAndCollectCookies(urlValue) {
  const url = new URL(urlValue);
  const originPattern = `${url.protocol}//${url.host}/*`;
  const granted = await chrome.permissions.request({
    permissions: ["cookies"],
    origins: [originPattern]
  });
  if (!granted) {
    throw new Error(msg("cookiesPermissionDenied"));
  }
  const cookies = await chrome.cookies.getAll({ domain: url.hostname });
  return cookies.map((cookie) => ({
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    path: cookie.path || "/",
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    expirationDate: cookie.expirationDate || 0,
    name: cookie.name,
    value: cookie.value
  }));
}

async function loadSettings() {
  const result = await chrome.storage.sync.get({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return normalizeSettings(result[SETTINGS_KEY]);
}

async function saveSettings(value) {
  const settings = normalizeSettings(value);
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
  return settings;
}

function normalizeSettings(value) {
  return {
    language: normalizeLanguage(value?.language),
    traditionalChinese: value?.traditionalChinese !== false
  };
}

function normalizeLanguage(value) {
  const language = String(value || "auto").toLowerCase();
  return ["auto", "zh", "en", "ja", "ko"].includes(language) ? language : "auto";
}

function getNativePort() {
  if (nativePort) {
    return nativePort;
  }
  nativePort = chrome.runtime.connectNative(HOST_NAME);
  nativePort.onMessage.addListener(handleNativeMessage);
  nativePort.onDisconnect.addListener(handleNativeDisconnect);
  return nativePort;
}

function sendNativeOnce(payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("Native host did not respond in time"));
    }, timeoutMs);
    chrome.runtime.sendNativeMessage(HOST_NAME, payload, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const error = chrome.runtime.lastError?.message;
      if (error || !response) {
        reject(new Error(error || "Native host did not return a response"));
        return;
      }
      if (response.ok === false) {
        reject(new Error(response.error || "Native host request failed"));
        return;
      }
      resolve(response);
    });
  });
}

function sendNative(payload, timeoutMs) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Native host did not respond in time"));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    try {
      getNativePort().postMessage({ id, ...payload });
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(error);
    }
  });
}

function handleNativeMessage(message) {
  if (message?.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.ok === false) {
      request.reject(new Error(message.error || "Native host request failed"));
    } else {
      request.resolve(message);
    }
    return;
  }
  if (!message?.event) {
    return;
  }
  if (message.jobId && active.operationId && active.mode === "accurate" && !active.jobId) {
    active.jobId = message.jobId;
    active.phase = "running";
  }
  if (message.event === "captionUpdate" && active.tabId) {
    sendContent(active.tabId, "captionUpdate", { event: message }).catch(() => {});
  }
  if (message.event === "trackReady" && active.tabId && message.track) {
    sendContent(active.tabId, "displayTrack", { track: message.track }).catch(() => {});
    if (!message.jobId || message.jobId === active.jobId) {
      active.jobId = "";
      active.operationId = "";
      active.phase = "";
    }
  }
  if (message.event === "error") {
    active.fallbackAvailable = Boolean(message.fallbackAvailable);
    active.authenticationRequired = Boolean(message.authenticationRequired);
    if (message.jobId === active.jobId) {
      active.jobId = "";
      active.operationId = "";
      active.phase = "";
    }
  }
  if (message.event === "sessionStopped" && message.sessionId === active.sessionId) {
    active.sessionId = "";
    active.operationId = "";
    active.phase = "";
  }
  broadcastNativeEvent(message);
  broadcastState();
}

function handleNativeDisconnect() {
  const error = chrome.runtime.lastError?.message || "Native host disconnected";
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error(error));
  }
  pending = new Map();
  nativePort = null;
}

function resetActive() {
  active = {
    operationId: "",
    phase: "",
    tabId: 0,
    sessionId: "",
    jobId: "",
    mode: "",
    audioChunkCount: 0,
    captureState: "",
    lastRequest: null,
    fallbackAvailable: false,
    authenticationRequired: false
  };
}

function publicState() {
  return {
    busy: Boolean(active.operationId || active.sessionId || active.jobId),
    phase: active.phase,
    tabId: active.tabId,
    sessionId: active.sessionId,
    jobId: active.jobId,
    mode: active.mode,
    audioChunkCount: active.audioChunkCount,
    captureState: active.captureState,
    fallbackAvailable: active.fallbackAvailable,
    authenticationRequired: active.authenticationRequired
  };
}

function broadcastNativeEvent(event) {
  chrome.runtime.sendMessage({ type: MESSAGE_TYPE, action: "nativeEvent", event }).catch(() => {});
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: MESSAGE_TYPE, action: "stateChanged", state: publicState() }).catch(() => {});
}

class OperationCancelled extends Error {
  constructor() {
    super("Operation cancelled");
    this.name = "OperationCancelled";
  }
}
