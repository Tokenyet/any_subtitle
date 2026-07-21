export function normalizeCue(raw, fallbackId = "") {
  const source = raw && typeof raw === "object" ? raw : {};
  const startMs = Math.max(0, Number(source.startMs) || 0);
  const endMs = Math.max(startMs + 1, Number(source.endMs) || startMs + 2000);
  return {
    id: String(source.id || fallbackId || `${startMs}-${endMs}`),
    startMs,
    endMs,
    text: String(source.text || "").trim(),
    status: source.status === "provisional" ? "provisional" : "stable"
  };
}

export function sortAndDedupeCues(cues) {
  const result = [];
  const seen = new Set();
  for (const [index, raw] of (Array.isArray(cues) ? cues : []).entries()) {
    const cue = normalizeCue(raw, `cue-${index}`);
    if (!cue.text) {
      continue;
    }
    const key = `${Math.round(cue.startMs / 100)}|${Math.round(cue.endMs / 100)}|${cue.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(cue);
  }
  return result.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export const LIVE_CAPTION_STALE_MS = 4000;

export function selectLiveCaptionCue(stableCues, provisionalCue) {
  if (provisionalCue) {
    const cue = normalizeCue(provisionalCue);
    return cue.text ? cue : null;
  }
  const incomingStable = sortAndDedupeCues(stableCues);
  return incomingStable.at(-1) || null;
}

export function findCueAt(cues, timeMs) {
  const list = Array.isArray(cues) ? cues : [];
  const target = Math.max(0, Number(timeMs) || 0);
  let low = 0;
  let high = list.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (list[middle].startMs <= target) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  for (let index = candidate; index >= Math.max(0, candidate - 2); index -= 1) {
    const cue = list[index];
    if (cue && cue.startMs <= target && cue.endMs >= target) {
      return cue;
    }
  }
  return null;
}

export function cuesFromTextTrack(track) {
  const result = [];
  const cues = track?.cues ? Array.from(track.cues) : [];
  for (const [index, cue] of cues.entries()) {
    result.push(normalizeCue({
      id: cue.id || `${track.language || "track"}-${index}`,
      startMs: Number(cue.startTime) * 1000,
      endMs: Number(cue.endTime) * 1000,
      text: cue.text,
      status: "stable"
    }));
  }
  return sortAndDedupeCues(result);
}
