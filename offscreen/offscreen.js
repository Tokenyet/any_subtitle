const MESSAGE_TYPE = "any-subtitle";

let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let workletNode = null;
let session = null;
let sequence = 0;
let chunkSendFailed = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_TYPE || message.target !== "offscreen") {
    return false;
  }
  handleMessage(message)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message) {
  if (message.action === "startAudioCapture") {
    const capture = await startAudioCapture(message);
    return { started: true, ...capture };
  }
  if (message.action === "stopAudioCapture") {
    const stopped = await stopAudioCapture(message.sessionId);
    return { stopped };
  }
  throw new Error(`Unknown offscreen action: ${message.action}`);
}

async function startAudioCapture(message) {
  await stopAudioCapture();
  session = {
    sessionId: String(message.sessionId || ""),
    tabId: Number(message.tabId),
    mode: String(message.mode || "live")
  };
  sequence = 0;
  chunkSendFailed = false;
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: message.streamId
      }
    },
    video: false
  });
  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL("offscreen/audio-worklet.mjs"));
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, "any-subtitle-pcm", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { sourceSampleRate: audioContext.sampleRate }
  });
  workletNode.port.onmessage = ({ data }) => {
    if (data?.type !== "pcm" || !session) {
      return;
    }
    sendChunk(new Uint8Array(data.pcm));
  };
  workletNode.onprocessorerror = () => {
    reportCaptureError("AudioWorklet processor stopped unexpectedly");
  };
  audioContext.onstatechange = reportCaptureState;
  sourceNode.connect(audioContext.destination);
  sourceNode.connect(workletNode);
  // The processor outputs silence, so connecting it directly keeps the worklet
  // render quantum alive without duplicating the captured tab audio.
  workletNode.connect(audioContext.destination);
  if (audioContext.state === "suspended") {
    audioContext.resume().catch((error) => reportCaptureError(
      `AudioContext resume failed: ${error.message || error}`
    ));
  }
  for (const track of mediaStream.getTracks()) {
    track.addEventListener("ended", () => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPE,
        action: "captureEnded",
        sessionId: session?.sessionId || ""
      }).catch(() => {});
    }, { once: true });
  }
  return {
    audioContextState: audioContext.state,
    trackState: mediaStream.getAudioTracks()[0]?.readyState || "unknown"
  };
}

function sendChunk(bytes) {
  const current = session;
  if (!current) {
    return;
  }
  let binary = "";
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPE,
    action: "audioChunk",
    sessionId: current.sessionId,
    tabId: current.tabId,
    mode: current.mode,
    sequence,
    capturedAtMs: Date.now(),
    pcmBase64: btoa(binary)
  }).catch((error) => {
    if (!chunkSendFailed) {
      chunkSendFailed = true;
      reportCaptureError(`PCM delivery failed: ${error.message || error}`);
    }
  });
  sequence += 1;
}

function reportCaptureState() {
  if (!session || !audioContext) {
    return;
  }
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPE,
    action: "audioCaptureState",
    sessionId: session.sessionId,
    state: audioContext.state
  }).catch(() => {});
}

function reportCaptureError(error) {
  if (!session) {
    return;
  }
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPE,
    action: "audioCaptureError",
    sessionId: session.sessionId,
    error: String(error || "Audio capture failed")
  }).catch(() => {});
}

async function stopAudioCapture(expectedSessionId = "") {
  if (expectedSessionId && session && session.sessionId !== expectedSessionId) {
    return false;
  }
  session = null;
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }
  try {
    workletNode?.disconnect();
    sourceNode?.disconnect();
  } catch {
    // Nodes may already be disconnected.
  }
  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }
  audioContext = null;
  mediaStream = null;
  sourceNode = null;
  workletNode = null;
  chunkSendFailed = false;
  return true;
}
