import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("AudioWorklet emits one second of 16 kHz PCM", () => {
  const messages = [];
  let Processor = null;
  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        postMessage(message) {
          messages.push(message);
        }
      };
    }
  }
  const source = fs.readFileSync(
    new URL("../../offscreen/audio-worklet.mjs", import.meta.url),
    "utf8"
  );
  vm.runInNewContext(source, {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    Float32Array,
    Int16Array,
    Math,
    sampleRate: 48000,
    registerProcessor(_name, value) {
      Processor = value;
    }
  });

  const processor = new Processor({ processorOptions: { sourceSampleRate: 48000 } });
  for (let frame = 0; frame < 375; frame += 1) {
    processor.process(
      [[new Float32Array(128).fill(0.25)]],
      [[new Float32Array(128)]]
    );
  }

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "pcm");
  assert.equal(messages[0].pcm.byteLength, 32000);
});
