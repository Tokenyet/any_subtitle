(() => {
  if (globalThis.__anySubtitleLoaded) {
    return;
  }
  globalThis.__anySubtitleLoaded = true;

  const MESSAGE_TYPE = "any-subtitle";
  let utilsPromise = null;
  let host = null;
  let shadow = null;
  let captionBox = null;
  let statusBox = null;
  let stableCues = [];
  let provisionalCue = null;
  let trackCues = [];
  let renderTimer = null;
  let anchorTimer = null;
  let seekEpoch = 0;
  let boundMedia = null;
  let overlayPositionFrame = 0;
  let overlayResizeObserver = null;
  let observedOverlayMedia = null;
  let captionsStarted = false;
  let overlayListenersBound = false;

  function utils() {
    utilsPromise ||= import(chrome.runtime.getURL("src/caption-utils.mjs"));
    return utilsPromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPE) {
      return false;
    }
    handleMessage(message)
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  });

  async function handleMessage(message) {
    switch (message.action) {
      case "pingContent":
        return { ready: true };
      case "getMediaInfo":
        return { media: await getMediaInfo() };
      case "captionUpdate":
        await applyCaptionUpdate(message.event || {});
        return {};
      case "displayTrack":
        await displayTrack(message.track || {});
        return {};
      case "setOverlayStatus":
        ensureOverlay();
        setStatus(String(message.status || ""));
        return {};
      case "clearOverlay":
        clearOverlay(Boolean(message.remove));
        return {};
      default:
        throw new Error(`Unknown content action: ${message.action}`);
    }
  }

  function ensureOverlay() {
    if (host?.isConnected) {
      moveOverlayForFullscreen();
      return;
    }
    host = document.createElement("div");
    host.id = "any-subtitle-overlay-host";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        display: block;
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        overflow: hidden;
        container-type: inline-size;
        font-family: "Microsoft JhengHei UI", "Microsoft JhengHei", "Noto Sans TC", sans-serif;
        font-synthesis: none;
      }
      .layer {
        position: absolute;
        left: 50%;
        bottom: max(8%, 52px);
        width: min(92%, 1100px);
        transform: translateX(-50%);
        text-align: center;
        color: white;
        text-shadow:
          0 2px 3px rgba(0,0,0,.92),
          0 0 1px rgba(0,0,0,.9);
      }
      .caption {
        display: inline;
        padding: .18em .48em .24em;
        border: 1px solid rgba(126, 190, 255, .62);
        border-radius: .34em;
        background: rgba(10, 27, 48, .9);
        box-shadow: 0 5px 18px rgba(0,0,0,.58);
        backdrop-filter: blur(5px);
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        font-size: clamp(20px, 4.5cqw, 40px);
        font-weight: 700;
        line-height: 1.38;
        white-space: pre-line;
      }
      .caption[data-provisional="true"] {
        opacity: .86;
      }
      .status {
        margin: 0 auto 8px;
        width: max-content;
        max-width: 80%;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(126, 190, 255, .42);
        background: rgba(10, 27, 48, .9);
        color: #d7deea;
        font-size: 13px;
        font-weight: 600;
      }
      .status:empty, .caption:empty {
        display: none;
      }
      [hidden] {
        display: none !important;
      }
    `;
    const layer = document.createElement("div");
    layer.className = "layer";
    statusBox = document.createElement("div");
    statusBox.className = "status";
    captionBox = document.createElement("div");
    captionBox.className = "caption";
    layer.append(statusBox, captionBox);
    shadow.append(style, layer);
    (document.fullscreenElement || document.documentElement).appendChild(host);
    if (!overlayListenersBound) {
      overlayListenersBound = true;
      document.addEventListener("fullscreenchange", scheduleOverlayPosition);
      window.addEventListener("resize", scheduleOverlayPosition, { passive: true });
      window.addEventListener("scroll", scheduleOverlayPosition, { passive: true, capture: true });
    }
    scheduleOverlayPosition();
  }

  function moveOverlayForFullscreen() {
    if (!host) {
      return;
    }
    const fullscreen = document.fullscreenElement;
    const target = fullscreen || document.documentElement;
    if (host.parentElement !== target) {
      target.appendChild(host);
    }
    if (fullscreen) {
      setOverlayRect({ left: 0, top: 0, width: fullscreen.clientWidth, height: fullscreen.clientHeight }, "absolute");
      return;
    }

    const media = getPrimaryMedia();
    observeMediaForOverlay(media);
    const rect = media?.tagName === "VIDEO" ? media.getBoundingClientRect() : null;
    if (rect && rect.width >= 160 && rect.height >= 90) {
      setOverlayRect(rect, "fixed");
      return;
    }
    setOverlayRect({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }, "fixed");
  }

  function setOverlayRect(rect, position) {
    if (!host) {
      return;
    }
    host.style.position = position;
    host.style.inset = "auto";
    host.style.left = `${Math.round(rect.left || 0)}px`;
    host.style.top = `${Math.round(rect.top || 0)}px`;
    host.style.width = `${Math.max(0, Math.round(rect.width || 0))}px`;
    host.style.height = `${Math.max(0, Math.round(rect.height || 0))}px`;
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
  }

  function scheduleOverlayPosition() {
    cancelAnimationFrame(overlayPositionFrame);
    overlayPositionFrame = requestAnimationFrame(() => {
      overlayPositionFrame = 0;
      moveOverlayForFullscreen();
    });
  }

  function observeMediaForOverlay(media) {
    if (media === observedOverlayMedia) {
      return;
    }
    overlayResizeObserver?.disconnect();
    observedOverlayMedia = media || null;
    if (!media || typeof ResizeObserver !== "function") {
      return;
    }
    overlayResizeObserver = new ResizeObserver(scheduleOverlayPosition);
    overlayResizeObserver.observe(media);
  }

  function setStatus(text) {
    if (statusBox) {
      statusBox.textContent = text;
      statusBox.hidden = captionsStarted;
    }
  }

  function setCaption(text, provisional = false) {
    ensureOverlay();
    const caption = limitLines(text, 2);
    captionBox.textContent = caption;
    captionBox.dataset.provisional = String(Boolean(provisional));
    captionsStarted ||= Boolean(caption);
    statusBox.hidden = captionsStarted;
    scheduleOverlayPosition();
  }

  function limitLines(text, maxLines) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) {
      return "";
    }
    const maxChars = 74;
    const chunks = [];
    let rest = clean;
    while (rest.length > maxChars && chunks.length < maxLines - 1) {
      let split = rest.lastIndexOf(" ", maxChars);
      if (split < Math.floor(maxChars * 0.55)) {
        split = maxChars;
      }
      chunks.push(rest.slice(0, split).trim());
      rest = rest.slice(split).trim();
    }
    chunks.push(rest);
    return chunks.slice(-maxLines).join("\n");
  }

  async function applyCaptionUpdate(event) {
    ensureOverlay();
    const captionUtils = await utils();
    const incomingStable = captionUtils.sortAndDedupeCues(event.stableCues || []);
    if (incomingStable.length) {
      stableCues = captionUtils.sortAndDedupeCues([...stableCues, ...incomingStable]).slice(-500);
    }
    provisionalCue = event.provisionalCue ? captionUtils.normalizeCue(event.provisionalCue) : null;
    const latest = provisionalCue || stableCues.at(-1) || null;
    setCaption(latest?.text || "", Boolean(provisionalCue));
    setStatus(event.language ? `即時字幕 · ${event.language}` : "即時字幕");
  }

  async function displayTrack(track) {
    const captionUtils = await utils();
    trackCues = captionUtils.sortAndDedupeCues(track.cues || []);
    stableCues = [];
    provisionalCue = null;
    captionsStarted = false;
    ensureOverlay();
    setStatus("");
    bindMediaEvents();
    startTrackRenderer();
    renderTrackCue();
  }

  function startTrackRenderer() {
    clearInterval(renderTimer);
    renderTimer = setInterval(renderTrackCue, 200);
  }

  async function renderTrackCue() {
    if (!trackCues.length) {
      return;
    }
    const media = getPrimaryMedia();
    if (!media) {
      setStatus("找不到可同步的播放器");
      return;
    }
    const captionUtils = await utils();
    const cue = captionUtils.findCueAt(trackCues, media.currentTime * 1000);
    setCaption(cue?.text || "", false);
  }

  function clearOverlay(remove) {
    stableCues = [];
    trackCues = [];
    provisionalCue = null;
    clearInterval(renderTimer);
    renderTimer = null;
    setCaption("");
    setStatus("");
    if (remove && host) {
      overlayResizeObserver?.disconnect();
      overlayResizeObserver = null;
      observedOverlayMedia = null;
      host.remove();
      host = null;
      shadow = null;
      captionBox = null;
      statusBox = null;
    }
  }

  function getPrimaryMedia() {
    const media = Array.from(document.querySelectorAll("video, audio"))
      .filter((element) => Number.isFinite(element.duration) || !element.paused);
    if (!media.length) {
      return null;
    }
    return media.sort((left, right) => mediaScore(right) - mediaScore(left))[0];
  }

  function mediaScore(element) {
    const rect = element.getBoundingClientRect();
    return (rect.width * rect.height) + (element.paused ? 0 : 1_000_000);
  }

  async function getMediaInfo() {
    const media = getPrimaryMedia();
    if (!media) {
      return {
        url: location.href,
        title: document.title,
        currentSrc: "",
        durationMs: 0,
        currentTimeMs: 0,
        tracks: []
      };
    }
    const tracks = await collectTracks(media);
    bindMediaEvents(media);
    return {
      url: location.href,
      title: document.title,
      currentSrc: /^https?:/i.test(media.currentSrc || "") ? media.currentSrc : "",
      durationMs: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : 0,
      currentTimeMs: Math.round(media.currentTime * 1000),
      paused: media.paused,
      playbackRate: media.playbackRate,
      tracks
    };
  }

  async function collectTracks(media) {
    const captionUtils = await utils();
    const elements = Array.from(media.querySelectorAll("track"));
    for (const element of elements) {
      if (element.track && element.track.mode === "disabled") {
        element.track.mode = "hidden";
      }
    }
    if (elements.length) {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    return Array.from(media.textTracks || []).map((track, index) => ({
      id: track.id || `track-${index}`,
      label: track.label || "",
      language: track.language || "",
      kind: track.kind || "subtitles",
      cues: captionUtils.cuesFromTextTrack(track)
    })).filter((track) => track.cues.length);
  }

  function bindMediaEvents(media = getPrimaryMedia()) {
    if (!media || boundMedia === media) {
      scheduleOverlayPosition();
      startAnchorTimer();
      return;
    }
    boundMedia = media;
    for (const eventName of ["play", "pause", "ratechange", "loadedmetadata"]) {
      media.addEventListener(eventName, sendTimelineAnchor, { passive: true });
    }
    media.addEventListener("seeking", () => {
      seekEpoch += 1;
      sendTimelineAnchor();
    }, { passive: true });
    observeMediaForOverlay(media);
    scheduleOverlayPosition();
    startAnchorTimer();
  }

  function startAnchorTimer() {
    clearInterval(anchorTimer);
    anchorTimer = setInterval(sendTimelineAnchor, 1000);
    sendTimelineAnchor();
  }

  function sendTimelineAnchor() {
    const media = getPrimaryMedia();
    if (!media) {
      return;
    }
    scheduleOverlayPosition();
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPE,
      action: "timelineAnchor",
      anchor: {
        mediaTimeMs: Math.round(media.currentTime * 1000),
        playbackRate: Number(media.playbackRate) || 1,
        paused: Boolean(media.paused),
        seekEpoch,
        capturedAtMs: Date.now()
      }
    }).catch(() => {});
  }
})();
