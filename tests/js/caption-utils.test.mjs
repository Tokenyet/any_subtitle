import assert from "node:assert/strict";
import test from "node:test";

import {
  findCueAt,
  LIVE_CAPTION_STALE_MS,
  normalizeCue,
  selectLiveCaptionCue,
  sortAndDedupeCues
} from "../../src/caption-utils.mjs";

test("normalizes cue boundaries", () => {
  assert.deepEqual(normalizeCue({
    startMs: -50,
    endMs: 0,
    text: " hello "
  }), {
    id: "0-2000",
    startMs: 0,
    endMs: 2000,
    text: "hello",
    status: "stable"
  });
});

test("sorts and removes duplicate cues", () => {
  const cues = sortAndDedupeCues([
    { startMs: 2000, endMs: 3000, text: "B" },
    { startMs: 0, endMs: 1000, text: "A" },
    { startMs: 0, endMs: 1000, text: "A" }
  ]);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "A");
  assert.equal(cues[1].text, "B");
});

test("finds a cue using binary search", () => {
  const cues = sortAndDedupeCues([
    { startMs: 0, endMs: 999, text: "A" },
    { startMs: 1000, endMs: 1999, text: "B" },
    { startMs: 2000, endMs: 2999, text: "C" }
  ]);
  assert.equal(findCueAt(cues, 1400)?.text, "B");
  assert.equal(findCueAt(cues, 3500), null);
});

test("selects only cues from the current live update", () => {
  assert.equal(selectLiveCaptionCue([], null), null);
  assert.equal(selectLiveCaptionCue([
    { startMs: 1000, endMs: 2000, text: "stable" }
  ], null)?.text, "stable");
  assert.equal(selectLiveCaptionCue([
    { startMs: 1000, endMs: 2000, text: "stable" }
  ], {
    startMs: 1500,
    endMs: 2500,
    text: "provisional",
    status: "provisional"
  })?.text, "provisional");
  assert.equal(LIVE_CAPTION_STALE_MS, 4000);
});
