import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");
const coreSetup = fs.readFileSync(path.join(root, "installer/setup-core.ps1"), "utf8");
const coreInstaller = fs.readFileSync(path.join(root, "installer/AnySubtitleCore.iss"), "utf8");
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === packageJson.version, "Manifest and package versions must match");
assert(manifest.minimum_chrome_version === "116", "Chrome 116 is the required baseline");
for (const permission of [
  "activeTab",
  "scripting",
  "tabCapture",
  "offscreen",
  "storage",
  "nativeMessaging"
]) {
  assert(manifest.permissions.includes(permission), `Missing permission: ${permission}`);
}
assert(!manifest.host_permissions, "Broad host permissions must not be mandatory");
assert(manifest.optional_permissions.includes("cookies"), "cookies must remain optional");
assert(manifest.optional_host_permissions.includes("https://*/*"), "HTTPS optional hosts are required");
assert(manifest.action?.default_popup === "popup/popup.html", "The toolbar action must open the popup");
assert(manifest.icons?.[128] === "icons/icon128.png", "The extension must expose a 128px store icon");
assert(manifest.action?.default_icon?.[16] === "icons/icon16.png", "The toolbar must expose a 16px icon");
assert(!manifest.side_panel, "The extension must not expose a side panel");

for (const file of [
  "src/background.js",
  "src/content.js",
  "src/caption-utils.mjs",
  "offscreen/offscreen.html",
  "offscreen/offscreen.js",
  "offscreen/audio-worklet.mjs",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css",
  "onboarding/index.html",
  "onboarding/onboarding.js",
  "onboarding/onboarding.css",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "native-host/any_subtitle_host.py",
  "native-host/any_subtitle/host.py",
  "scripts/install-native.ps1",
  "scripts/update-tools.ps1"
]) {
  assert(fs.existsSync(path.join(root, file)), `${file} is missing`);
}

const background = fs.readFileSync(path.join(root, "src/background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "src/content.js"), "utf8");
const popupScript = fs.readFileSync(path.join(root, "popup/popup.js"), "utf8");
const offscreen = fs.readFileSync(path.join(root, "offscreen/offscreen.js"), "utf8");
assert(
  background.includes("chrome.tabCapture.getMediaStreamId"),
  "The service worker must obtain the tab stream ID for offscreen consumption"
);
assert(
  !popupScript.includes("chrome.tabCapture.getMediaStreamId"),
  "The popup must not create a stream ID consumed by the offscreen document"
);
assert(
  popupScript.includes("lastFocusedWindow: true")
    && popupScript.includes('currentSessionId = state.sessionId || ""'),
  "The popup must target the currently focused video tab and clear stopped sessions"
);
assert(
  popupScript.includes("currentSessionHasAudio")
    && popupScript.includes('event.event === "captionUpdate"')
    && popupScript.includes("if (!currentSessionHasAudio)"),
  "Late sessionReady events must not overwrite active audio or caption status"
);
assert(
  !background.includes("chrome.sidePanel")
    && !background.includes("TARGET_TAB_KEY"),
  "The popup architecture must not retain side-panel target-tab state"
);
assert(
  !background.includes("active: true, currentWindow: true"),
  "The service worker must not resolve a video tab through its own currentWindow"
);
assert(
  !offscreen.includes("await audioContext.resume()")
    && !offscreen.includes("silentGain")
    && offscreen.includes("workletNode.connect(audioContext.destination)"),
  "Offscreen capture must not block on resume or use an optimizable zero-gain worklet branch"
);
assert(
  !content.includes('host.style.all = "initial"')
    && content.includes("z-index: 2147483647")
    && content.includes("display: block")
    && content.includes("setOverlayRect")
    && content.includes("ResizeObserver"),
  "The overlay host must stay visible and follow the primary video rectangle"
);
assert(
  content.includes('font-family: "Microsoft JhengHei UI", "Microsoft JhengHei"')
    && content.includes("font-synthesis: none")
    && !content.includes("-webkit-text-stroke"),
  "Traditional Chinese captions must use a native UI font without synthetic weight or hard strokes"
);
for (const action of [
  "startLiveSession",
  "audioChunk",
  "timelineAnchor",
  "stopSession",
  "startAccurateJob",
  "startCaptureSession",
  "finalizeCapture",
  "cancelJob",
  "trackStatus",
  "loadTrack"
]) {
  assert(background.includes(action), `Background does not reference ${action}`);
}

const popup = fs.readFileSync(path.join(root, "popup/popup.html"), "utf8");
const onboarding = fs.readFileSync(path.join(root, "onboarding/onboarding.js"), "utf8");
for (const id of [
  "start-live",
  "start-accurate",
  "stop",
  "start-capture",
  "finish-capture"
]) {
  assert(popup.includes(`id="${id}"`), `Popup is missing #${id}`);
}
assert(!popup.includes('id="reload-track"'), "The accurate button must replace the separate reload-track control");
assert(
  popupScript.includes('"使用精準字幕"')
    && background.includes('action: "trackStatus"'),
  "A fresh accurate track must switch the primary action to cached subtitle playback"
);
assert(
  background.includes('details.reason === "install"')
    && background.includes('onboarding/index.html')
    && popup.includes('id="setup-card"')
    && popupScript.includes("hostAvailability"),
  "First install and unavailable-core states must lead to onboarding"
);
assert(
  background.includes("chrome.runtime.sendNativeMessage")
    && background.includes("sendNativeOnce"),
  "Health checks must not keep the native host executable locked during repair"
);
assert(
  onboarding.includes("AnySubtitleCoreSetup.exe")
    && onboarding.includes('send("ping")'),
  "Onboarding must expose the stable core installer and a native-host recheck"
);
assert(
  coreSetup.includes('install-error.txt')
    && coreSetup.includes('Step: $CurrentStep')
    && coreInstaller.includes('LoadStringFromFile(ErrorPath, ErrorDetails)')
    && coreInstaller.includes('CloseApplications=force')
    && coreInstaller.includes('CloseApplicationsFilter=any-subtitle-host.exe')
    && coreInstaller.includes("ExpandConstant('{sysnative}\\WindowsPowerShell"),
  "The Local Core installer must close a locked host, use 64-bit PowerShell and display the real setup error"
);

console.log("Smoke checks passed.");
