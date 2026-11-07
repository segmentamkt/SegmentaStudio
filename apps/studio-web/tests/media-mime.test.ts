import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingMimeType } from "../lib/media-mime";

test("camera recordings preserve WebM containers when MediaRecorder includes codecs", () => {
  assert.equal(recordingMimeType("video/webm;codecs=vp9,opus"), "video/webm");
  assert.equal(recordingMimeType("video/webm;codecs=vp8,opus"), "video/webm");
  assert.equal(recordingMimeType('video/mp4;codecs="avc1.42E01E,mp4a.40.2"'), "video/mp4");
  assert.equal(recordingMimeType("", "IMG_1409.MOV"), "video/quicktime");
});
