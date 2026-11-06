import assert from "node:assert/strict";
import test from "node:test";
import { decodeSpeechWav, timedCaptionCards, transcriptionFromChunks } from "../lib/transcription-core";

function wav(samples: number[], sampleRate = 16_000) {
  // A RIFF metadata chunk with odd byte padding, as emitted by common audio encoders.
  const buffer = new ArrayBuffer(54 + samples.length * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "JUNK"); view.setUint32(40, 1, true); view.setUint8(44, 123);
  tag(46, "data"); view.setUint32(50, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(54 + index * 2, value, true));
  return buffer;
}

test("decodes endpoint PCM16 audio with RIFF metadata, and rejects invalid, silent or incomplete input", () => {
  const buffer = wav([-32768, 0, 16384, 32767]);
  assert.deepEqual([...decodeSpeechWav(buffer)], [-1, 0, .5, 32767 / 32768]);
  assert.throws(() => decodeSpeechWav(buffer.slice(0, -1)), /incompleto/);
  assert.throws(() => decodeSpeechWav(wav([1000, 2000], 48_000)), /formato/);
  assert.throws(() => decodeSpeechWav(wav([0, 0, 0])), /audible/);
  assert.throws(() => decodeSpeechWav(new ArrayBuffer(30)), /WAV/);
});

test("timestamped recognition preserves words, handles missing final end and does not invent starts", () => {
  const result = transcriptionFromChunks([
    { text: "Hola", timestamp: [.2, .6] },
    { text: "mundo", timestamp: [.6, 1] },
    { text: "Vamos", timestamp: [2, 2.4] },
    { text: "juntos", timestamp: [2.4, null] },
  ], 3, 4);
  assert.equal(result.transcript, "Hola mundo Vamos juntos");
  assert.equal(result.captionCues.length, 2);
  assert.ok(result.captionCues[0].endSeconds < 2);
  assert.equal(result.captionCues[1].endSeconds, 3);
  assert.throws(() => transcriptionFromChunks([{ text: "Desconocido", timestamp: [null, 1] }], 3, 4), /tiempos/);
});

test("close word timestamps never overlap cards or silently discard text at the clip boundary", () => {
  const cards = timedCaptionCards([
    { text: "uno", startInSeconds: 0, endInSeconds: 0 },
    { text: "dos", startInSeconds: 0, endInSeconds: 0 },
    { text: "tres", startInSeconds: .04, endInSeconds: .2 },
    { text: "cuatro", startInSeconds: .2, endInSeconds: .6 },
    { text: "cinco", startInSeconds: .99, endInSeconds: 1 },
  ], 1, 2);
  assert.equal(cards.map((cue) => cue.text).join(" "), "uno dos tres cuatro cinco");
  cards.forEach((cue, index) => {
    assert.ok(cue.endSeconds - cue.startSeconds >= .1);
    assert.ok(cue.startSeconds >= 0 && cue.endSeconds <= 1);
    if (index > 0) assert.ok(cue.startSeconds >= cards[index - 1].endSeconds);
  });
});
