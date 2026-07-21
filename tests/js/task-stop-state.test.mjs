import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = process.cwd();
const backgroundSource = fs.readFileSync(path.join(root, "src/background.js"), "utf8");
const offscreenSource = fs.readFileSync(path.join(root, "offscreen/offscreen.js"), "utf8");

function createBackgroundHarness() {
  const calls = [];
  let uuid = 0;
  const event = { addListener() {} };
  const context = vm.createContext({
    AnySubtitleI18n: { msg: (key) => key },
    URL,
    clearTimeout,
    console,
    crypto: { randomUUID: () => `operation-${++uuid}` },
    importScripts() {},
    setTimeout,
    testCalls: calls,
    chrome: {
      cookies: { getAll: async () => [] },
      offscreen: { createDocument: async () => {} },
      permissions: { request: async () => false },
      runtime: {
        getContexts: async () => [],
        getURL: (value) => `chrome-extension://test/${value}`,
        lastError: null,
        onInstalled: event,
        onMessage: event,
        sendMessage: async (message) => calls.push({ channel: "broadcast", message })
      },
      scripting: { executeScript: async () => {} },
      storage: {
        sync: {
          get: async () => ({}),
          set: async () => {}
        }
      },
      tabCapture: { getMediaStreamId: (_options, callback) => callback("stream") },
      tabs: {
        create: async () => {},
        onRemoved: event,
        query: async () => [],
        sendMessage: async () => ({ ok: true })
      }
    }
  });
  vm.runInContext(backgroundSource, context, { filename: "src/background.js" });
  return { calls, context };
}

test("stopCurrent uses the authoritative background task even when popup IDs are empty", async () => {
  const { calls, context } = createBackgroundHarness();
  vm.runInContext(`
    sendOffscreen = async (action, payload) => testCalls.push({ channel: "offscreen", action, payload });
    sendNative = async (payload) => testCalls.push({ channel: "native", payload });
    sendContent = async (tabId, action) => testCalls.push({ channel: "content", tabId, action });
    active = {
      operationId: "operation-active",
      phase: "running",
      tabId: 7,
      sessionId: "session-active",
      jobId: "job-active",
      mode: "accurate",
      audioChunkCount: 0,
      captureState: "running",
      lastRequest: null,
      fallbackAvailable: false,
      authenticationRequired: false
    };
  `, context);

  await vm.runInContext(`handleMessage({
    action: "stopCurrent",
    jobId: "",
    sessionId: ""
  }, {})`, context);

  assert.ok(calls.some((call) => call.channel === "offscreen"
    && call.action === "stopAudioCapture"
    && call.payload.sessionId === "session-active"));
  assert.ok(calls.some((call) => call.channel === "native"
    && call.payload.action === "stopSession"
    && call.payload.sessionId === "session-active"));
  assert.ok(calls.some((call) => call.channel === "native"
    && call.payload.action === "cancelJob"
    && call.payload.jobId === "job-active"));
  assert.ok(calls.some((call) => call.channel === "content"
    && call.tabId === 7
    && call.action === "clearOverlay"));
  assert.equal(vm.runInContext("publicState().busy", context), false);
});

test("a task remains stoppable while an accurate job ID is still pending", async () => {
  const { calls, context } = createBackgroundHarness();
  vm.runInContext(`
    let releaseStartJob;
    let markStartJobRequested;
    const startJobRequested = new Promise((resolve) => { markStartJobRequested = resolve; });
    const delayedStartJob = new Promise((resolve) => { releaseStartJob = resolve; });
    requireActiveTab = async () => ({ id: 7, url: "https://example.test/video", title: "Video" });
    ensureContent = async () => {};
    sendContent = async (_tabId, action) => action === "getMediaInfo"
      ? { media: { tracks: [], currentSrc: "https://example.test/video.mp4" } }
      : {};
    sendNative = async (payload) => {
      testCalls.push({ channel: "native", payload });
      if (payload.action === "loadTrack") return { track: null };
      if (payload.action === "startAccurateJob") {
        markStartJobRequested();
        return delayedStartJob;
      }
      return {};
    };
  `, context);

  const starting = vm.runInContext(`startAccurate({
    targetTabId: 7,
    language: "auto",
    traditionalChinese: true
  })`, context);
  await vm.runInContext("startJobRequested", context);

  const pendingState = vm.runInContext("publicState()", context);
  assert.equal(pendingState.busy, true);
  assert.equal(pendingState.phase, "starting");
  assert.equal(pendingState.jobId, "");

  await vm.runInContext(`handleMessage({ action: "stopCurrent", jobId: "", sessionId: "" }, {})`, context);
  assert.equal(vm.runInContext("publicState().busy", context), false);

  vm.runInContext(`releaseStartJob({ jobId: "job-late" })`, context);
  assert.equal((await starting).cancelled, true);
  assert.ok(calls.some((call) => call.channel === "native"
    && call.payload.action === "cancelJob"
    && call.payload.jobId === "job-late"));
});

test("popup treats pending work as busy and stops without client-side task IDs", () => {
  const popup = fs.readFileSync(path.join(root, "popup/popup.js"), "utf8");
  assert.match(popup, /actionPending \|\| stopPending \|\| backgroundBusy \|\| Boolean\(currentJobId \|\| currentSessionId\)/);
  assert.match(popup, /run\(startLive, \{ startsWork: true \}\)/);
  assert.match(popup, /await send\("stopCurrent"\)/);
  assert.doesNotMatch(popup, /send\("stopCurrent",\s*\{[^}]*jobId/);
});

test("a late stop from an old session cannot stop a newer offscreen capture", async () => {
  const event = { addListener() {} };
  const context = vm.createContext({
    AudioContext: class {},
    AudioWorkletNode: class {},
    Uint8Array,
    btoa: (value) => value,
    chrome: {
      runtime: {
        getURL: (value) => value,
        onMessage: event,
        sendMessage: async () => {}
      }
    },
    navigator: { mediaDevices: {} },
    testTrackStops: 0
  });
  vm.runInContext(offscreenSource, context, { filename: "offscreen/offscreen.js" });
  vm.runInContext(`
    session = { sessionId: "session-new", tabId: 7, mode: "live" };
    mediaStream = { getTracks: () => [{ stop: () => { testTrackStops += 1; } }] };
  `, context);

  assert.equal(await vm.runInContext(`stopAudioCapture("session-old")`, context), false);
  assert.equal(vm.runInContext("session.sessionId", context), "session-new");
  assert.equal(context.testTrackStops, 0);

  assert.equal(await vm.runInContext(`stopAudioCapture("session-new")`, context), true);
  assert.equal(vm.runInContext("session", context), null);
  assert.equal(context.testTrackStops, 1);
});
