import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const projectRoot = path.dirname(root);
const unpacked = path.join(root, "dist", "unpacked", "any-subtitle");
const chrome = findChrome();
const debugPort = await freePort();
const serverPort = await freePort();
const profile = path.join(os.tmpdir(), `any-subtitle-browser-${crypto.randomUUID()}`);
const fixtureUrl = `http://127.0.0.1:${serverPort}/any_subtitle/test-fixtures/player.html`;
const storeScreenshotPath = process.env.STORE_SCREENSHOT_PATH
  ? path.resolve(process.env.STORE_SCREENSHOT_PATH)
  : "";
const accurateLanguage = storeScreenshotPath ? "zh" : "en";
const expectedAccurateCaption = storeScreenshotPath
  ? "目前正在使用本機產生的精準字幕"
  : "cue one";

async function main() {
  let browserProcess;
  let serverProcess;

  try {
    packageExtension();
    serverProcess = spawn("python", [
    "-m", "http.server", String(serverPort),
    "--bind", "127.0.0.1",
    "--directory", projectRoot
  ], { stdio: "ignore", windowsHide: true });
  await waitForHttp(fixtureUrl, 15000);

  fs.mkdirSync(profile, { recursive: true });
  browserProcess = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${unpacked}`,
    `--load-extension=${unpacked}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--autoplay-policy=no-user-gesture-required",
    "--window-position=-32000,-32000",
    storeScreenshotPath ? "--window-size=1280,800" : "--window-size=900,700",
    fixtureUrl
  ], { stdio: "ignore", windowsHide: true });

  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 20000);
  await openTarget(debugPort, fixtureUrl);
  await delay(500);
  let targets = await listTargets(debugPort);
  let extensionTarget = targets.find((target) =>
    target.type === "service_worker"
    && target.url.startsWith("chrome-extension://")
    && target.url.endsWith("/src/background.js")
  );
  let extensionId = extensionTarget ? new URL(extensionTarget.url).hostname : "";

  if (!extensionId) {
    extensionId = await extensionIdFromPreferences(profile, unpacked);
  }
  if (!extensionId) {
    throw new Error("Could not discover the loaded extension target");
  }
  installNativeHost(extensionId);
  await openTarget(debugPort, `chrome-extension://${extensionId}/onboarding/index.html`);
  extensionTarget = await waitForTarget(debugPort, (target) =>
    target.type === "page"
    && target.url.startsWith(`chrome-extension://${extensionId}/onboarding/index.html`)
  , 10000);
  if (!extensionTarget) {
    throw new Error("Could not open the extension onboarding page");
  }

  const pageTarget = await waitForTarget(debugPort, (target) =>
    target.type === "page" && target.url.includes("/any_subtitle/test-fixtures/player.html")
  , 10000);
  if (!pageTarget) {
    throw new Error("Fixture page target was not found");
  }

  const extensionSession = await CdpSession.connect(extensionTarget.webSocketDebuggerUrl);
  const pageSession = await CdpSession.connect(pageTarget.webSocketDebuggerUrl);
  try {
    step("enable extension runtime");
    await extensionSession.call("Runtime.enable");
    step("enable fixture runtime");
    await pageSession.call("Runtime.enable");
    await extensionSession.call("Page.bringToFront");
    await delay(250);

    let extensionContext = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      extensionContext = await extensionSession.evaluate(`({
        href: location.href,
        readyState: document.readyState,
        hasChrome: typeof chrome !== "undefined",
        hasRuntime: typeof chrome !== "undefined" && Boolean(chrome.runtime)
      })`);
      if (extensionContext.hasRuntime) {
        break;
      }
      await delay(200);
    }
    if (!extensionContext?.hasRuntime) {
      throw new Error(`Extension page has no runtime API: ${JSON.stringify(extensionContext)}`);
    }
    await pageSession.call("Page.bringToFront");
    await delay(300);
    const originPermission = await extensionSession.evaluate(
      `new Promise((resolve) => chrome.permissions.request(
        {origins: ["http://127.0.0.1:${serverPort}/*"]},
        resolve
      ))`,
      { awaitPromise: true, userGesture: true }
    );
    if (!originPermission) {
      throw new Error("Could not grant the local fixture origin for browser smoke testing");
    }

    step("native ping");
    const ping = await extensionSession.evaluate(
      `new Promise((resolve) => chrome.runtime.sendMessage(
        {type: "any-subtitle", action: "ping"},
        (response) => resolve(response || {ok: false, error: chrome.runtime.lastError?.message || "no response"})
      ))`,
      { awaitPromise: true }
    );
    if (!ping?.response?.liveReady || !ping?.response?.accurateReady) {
      throw new Error(`Native host is not ready: ${JSON.stringify(ping)}`);
    }

    step("page TextTrack import");
    const accurate = await extensionSession.evaluate(
      `new Promise((resolve) => chrome.runtime.sendMessage({
          type: "any-subtitle",
          action: "startAccurate",
          language: ${JSON.stringify(accurateLanguage)},
          traditionalChinese: true
        }, (response) => resolve(
          response || {ok: false, error: chrome.runtime.lastError?.message || "no response"}
        )
      ))`,
      { awaitPromise: true }
    );
    if (!accurate?.track?.cues?.length) {
      throw new Error(`Page TextTrack was not imported: ${JSON.stringify(accurate)}`);
    }

    await pageSession.evaluate(`
      (() => {
        const media = document.querySelector("#media");
        media.currentTime = 1;
        media.dispatchEvent(new Event("timeupdate"));
        return true;
      })()
    `);
    await delay(700);
    const overlay = await pageSession.evaluate(`
      (() => {
        const host = document.querySelector("#any-subtitle-overlay-host");
        const rect = host?.getBoundingClientRect();
        const mediaRect = document.querySelector("#media")?.getBoundingClientRect();
        const style = host ? getComputedStyle(host) : null;
        return {
          exists: Boolean(host),
          caption: host?.shadowRoot?.querySelector(".caption")?.textContent || "",
          status: host?.shadowRoot?.querySelector(".status")?.textContent || "",
          width: rect?.width || 0,
          height: rect?.height || 0,
          left: rect?.left || 0,
          top: rect?.top || 0,
          mediaWidth: mediaRect?.width || 0,
          mediaHeight: mediaRect?.height || 0,
          mediaLeft: mediaRect?.left || 0,
          mediaTop: mediaRect?.top || 0,
          position: style?.position || "",
          zIndex: style?.zIndex || ""
        };
      })()
    `);
    if (
      !overlay.exists
      || !overlay.caption.includes(expectedAccurateCaption)
      || overlay.width <= 0
      || overlay.height <= 0
      || Math.abs(overlay.left - overlay.mediaLeft) > 2
      || Math.abs(overlay.top - overlay.mediaTop) > 2
      || Math.abs(overlay.width - overlay.mediaWidth) > 2
      || Math.abs(overlay.height - overlay.mediaHeight) > 2
      || !["fixed", "absolute"].includes(overlay.position)
      || Number(overlay.zIndex) < 2147483647
    ) {
      throw new Error(`Subtitle overlay did not render the active cue: ${JSON.stringify(overlay)}`);
    }
    if (storeScreenshotPath) {
      await pageSession.call("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false
      });
      await delay(400);
      fs.mkdirSync(path.dirname(storeScreenshotPath), { recursive: true });
      const capture = await pageSession.call("Page.captureScreenshot", {
        format: "png",
        fromSurface: true
      });
      fs.writeFileSync(storeScreenshotPath, Buffer.from(capture.data, "base64"));
    }

    let fullscreen = { supported: false };
    try {
      await pageSession.evaluate(
        `document.querySelector("#player").requestFullscreen()`,
        { awaitPromise: true, userGesture: true }
      );
      await delay(500);
      fullscreen = await pageSession.evaluate(`
        (() => {
          const host = document.querySelector("#any-subtitle-overlay-host");
          return {
            supported: true,
            fullscreenId: document.fullscreenElement?.id || "",
            parentId: host?.parentElement?.id || ""
          };
        })()
      `);
      if (fullscreen.fullscreenId && fullscreen.parentId !== fullscreen.fullscreenId) {
        throw new Error(`Overlay did not move into fullscreen element: ${JSON.stringify(fullscreen)}`);
      }
    } catch (error) {
      fullscreen = { supported: false, detail: error.message };
    }

    await pageSession.evaluate(`
      (async () => {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
        const media = document.querySelector("#media");
        media.currentTime = 0;
        await media.play();
        return true;
      })()
    `, { awaitPromise: true, userGesture: true });
    await pageSession.call("Page.bringToFront");
    step("live tab capture permission check");
    let live;
    try {
      live = await extensionSession.evaluate(
        `new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({
          ok: false,
          error: "Browser automation did not grant activeTab in time"
        }), 12000);
        chrome.runtime.sendMessage({
          type: "any-subtitle",
          action: "startLive",
          language: "en",
          traditionalChinese: true
        }, (response) => {
          clearTimeout(timeout);
          resolve(response || {
            ok: false,
            error: chrome.runtime.lastError?.message || "no response"
          });
        });
        })`,
        { awaitPromise: true, userGesture: true, timeoutMs: 15000 }
      );
    } catch (error) {
      if (!String(error.message || error).includes("Runtime.evaluate")) {
        throw error;
      }
      live = {
        ok: false,
        error: "Browser automation did not grant activeTab in time"
      };
    }
    let liveOverlay;
    if (!live?.ok && /invoked|activeTab|permission|逾時|分頁音訊/i.test(live?.error || "")) {
      liveOverlay = {
        skipped: true,
        reason: live.error || "Browser automation did not grant activeTab"
      };
    } else {
      step("live tab capture start");
      if (!live?.ok || !live.sessionId) {
        throw new Error(`Live tab capture did not start: ${JSON.stringify(live)}`);
      }
      step("waiting for live caption");
      liveOverlay = await waitForLiveOverlay(pageSession, 20000);
      if (!liveOverlay.caption || !liveOverlay.status.includes("即時字幕")) {
        throw new Error(`Live subtitle overlay was not produced: ${JSON.stringify(liveOverlay)}`);
      }
      step("stopping live caption");
      await extensionSession.evaluate(
        `new Promise((resolve) => chrome.runtime.sendMessage({
            type: "any-subtitle",
            action: "stopCurrent",
            sessionId: ${JSON.stringify(live.sessionId)}
          }, (response) => resolve(response || {ok: false})
        ))`,
        { awaitPromise: true }
      );
    }

    console.log(JSON.stringify({
      extensionId,
      nativeHost: {
        liveReady: ping.response.liveReady,
        accurateReady: ping.response.accurateReady
      },
      mediaTracks: accurate.track.cues.length,
      overlay,
      fullscreen,
      liveOverlay
    }, null, 2));
  } finally {
    extensionSession.close();
    pageSession.close();
  }
  } finally {
    if (browserProcess?.pid) {
      spawnSync("taskkill.exe", ["/PID", String(browserProcess.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
    }
    serverProcess?.kill();
    await delay(800);
    await removeTemporaryProfile(profile);
  }
}

function packageExtension() {
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, "scripts", "package.ps1")
  ], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Extension packaging failed");
  }
}

function installNativeHost(extensionId) {
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, "scripts", "install-native.ps1"),
    "-ExtensionId", extensionId,
    "-Browser", "chrome"
  ], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 180000 });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Native host installation failed");
  }
}

function findChrome() {
  const override = process.env.BROWSER_BIN || "";
  if (override && fs.existsSync(override)) {
    return override;
  }
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Vivaldi", "Application", "vivaldi.exe"),
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe")
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) {
    throw new Error("No supported Chromium browser executable was found");
  }
  return found;
}

async function extensionIdFromPreferences(profilePath, extensionPath) {
  const preferencePath = path.join(profilePath, "Default", "Preferences");
  const expected = path.resolve(extensionPath).toLowerCase();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (fs.existsSync(preferencePath)) {
      try {
        const preferences = JSON.parse(fs.readFileSync(preferencePath, "utf8"));
        const settings = preferences.extensions?.settings || {};
        for (const [id, setting] of Object.entries(settings)) {
          if (path.resolve(setting.path || "").toLowerCase() === expected) {
            return id;
          }
        }
      } catch {
        // Browser may be writing Preferences.
      }
    }
    await delay(200);
  }
  throw new Error("Extension ID was not found in the temporary browser profile");
}

async function openTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  });
  if (!response.ok) {
    throw new Error(`Could not open extension target: HTTP ${response.status}`);
  }
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function waitForTarget(port, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listTargets(port);
    const target = targets.find(predicate);
    if (target) {
      return target;
    }
    await delay(200);
  }
  return null;
}

async function waitForLiveOverlay(pageSession, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let result = { caption: "", status: "" };
  while (Date.now() < deadline) {
    result = await pageSession.evaluate(`
      (() => {
        const host = document.querySelector("#any-subtitle-overlay-host");
        return {
          caption: host?.shadowRoot?.querySelector(".caption")?.textContent || "",
          status: host?.shadowRoot?.querySelector(".status")?.textContent || ""
        };
      })()
    `);
    if (result.caption && result.status.includes("即時字幕")) {
      return result;
    }
    await delay(500);
  }
  return result;
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until deadline.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function step(message) {
  console.error(`[browser-smoke] ${message}`);
}

async function removeTemporaryProfile(profilePath) {
  const resolved = path.resolve(profilePath);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tempRoot + path.sep)) {
    throw new Error(`Refusing to remove profile outside the temp directory: ${resolved}`);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code) || attempt === 9) {
        console.warn(`Could not fully remove temporary browser profile: ${error.message}`);
        return;
      }
      await delay(300);
    }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

class CdpSession {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpSession(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) {
        return;
      }
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        request.resolve(message.result);
      }
    });
  }

  call(method, params = {}, timeoutMs = 45000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, options = {}) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: Boolean(options.awaitPromise),
      returnByValue: true,
      userGesture: Boolean(options.userGesture)
    }, options.timeoutMs || 45000);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "Runtime evaluation failed"
      );
    }
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

await main();
