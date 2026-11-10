import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ffmpegPath from "ffmpeg-static";
import { defaultReviewOrder, filenameDate, keepsDefaultOrder, naturalCompare, planUploadOrder, scriptOrderChange } from "../lib/upload-order";
import { parseMetadataDate, readCaptureDate } from "../lib/video-capture-date";

const local = (date: Date | null) => date && [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];

test("dates written in phone, WhatsApp and screen-recording file names", () => {
  assert.deepEqual(local(filenameDate("WhatsApp Video 2026-11-06 at 14.39.47 (4).mp4")), [2026, 11, 6, 14, 39, 47]);
  assert.deepEqual(local(filenameDate("Grabación de pantalla 2026-11-10 a la(s) 2.15.39 p.m..mov")), [2026, 11, 10, 14, 15, 39]);
  assert.deepEqual(local(filenameDate("Screen Recording 2026-11-10 at 12.05.01 AM.mov")), [2026, 11, 10, 0, 5, 1]);
  assert.deepEqual(local(filenameDate("VID_20261106_143947.mp4")), [2026, 11, 6, 14, 39, 47]);
  assert.deepEqual(local(filenameDate("PXL_20261106_143947123.mp4")), [2026, 11, 6, 14, 39, 47]);
  assert.equal(filenameDate("IMG_8382.MOV"), null, "a camera counter is not a date");
  assert.equal(filenameDate("toma 2026-13-40 at 99.99.99.mp4"), null);
  assert.ok(naturalCompare("IMG_8382.MOV", "IMG_10001.MOV") < 0 && naturalCompare("toma 2.mp4", "toma 10.mp4") < 0);
});

test("one rule for the whole batch: capture date, then the name's number, then the picking order", () => {
  const byDate = planUploadOrder([
    { index: 0, name: "IMG_8390.MOV", capturedAt: new Date("2026-10-31T17:25:00Z") },
    { index: 1, name: "WhatsApp Video 2026-10-31 at 12.10.00 (2).mp4", capturedAt: null },
    { index: 2, name: "IMG_8382.MOV", capturedAt: new Date("2026-10-31T17:20:36Z") },
  ]);
  assert.equal(byDate.strategy, "fecha");
  assert.deepEqual(byDate.order.map((index) => [2, 0].includes(index) ? `cam${index}` : "wa"), new Date(2026, 9, 31, 12, 10).getTime() < Date.parse("2026-10-31T17:20:36Z") ? ["wa", "cam2", "cam0"] : ["cam2", "cam0", "wa"]);
  assert.ok(byDate.notes.every((note) => !note.uncertain));
  assert.match(byDate.notes.find((note) => note.index === 1)!.reason, /^Fecha del nombre/);

  const sameSecond = planUploadOrder([
    { index: 0, name: "WhatsApp Video 2026-11-06 at 14.39.47 (4).mp4", capturedAt: null },
    { index: 1, name: "WhatsApp Video 2026-11-06 at 14.39.47 (2).mp4", capturedAt: null },
    { index: 2, name: "WhatsApp Video 2026-11-06 at 14.39.47.mp4", capturedAt: null },
  ]);
  assert.deepEqual(sameSecond.order, [2, 1, 0], "videos saved together keep WhatsApp's counter order");

  const byName = planUploadOrder([
    { index: 0, name: "escena 10.mp4", capturedAt: null },
    { index: 1, name: "escena 2.mp4", capturedAt: new Date("2026-10-31T17:20:36Z") },
    { index: 2, name: "escena 1.mp4", capturedAt: null },
  ]);
  assert.equal(byName.strategy, "nombre");
  assert.deepEqual(byName.order, [2, 1, 0]);
  assert.ok(byName.notes.find((note) => note.index === 0)!.uncertain && !byName.notes.find((note) => note.index === 1)!.uncertain);

  const picked = planUploadOrder([{ index: 0, name: "cierre.mp4", capturedAt: null }, { index: 1, name: "intro.mp4", capturedAt: null }]);
  assert.equal(picked.strategy, "seleccion");
  assert.deepEqual(picked.order, [0, 1]);
  assert.ok(picked.notes.every((note) => note.uncertain), "without any clue the person is asked to check");
});

test("the script reorders only an untouched montage, and only the included takes", () => {
  const scenes = [{ id: "s1", position: 0 }, { id: "s2", position: 1 }];
  const takes = [{ id: "b", sceneId: "s2", createdAt: "2026-11-10T10:00:00Z" }, { id: "a", sceneId: "s1", createdAt: "2026-11-10T10:01:00Z" }];
  const defaults = defaultReviewOrder(scenes, takes);
  assert.deepEqual(defaults, ["a", "b"]);
  assert.ok(keepsDefaultOrder(["a", "b"], defaults));
  assert.ok(keepsDefaultOrder(["b"], defaults), "rejecting a take is not reordering");
  assert.ok(!keepsDefaultOrder(["b", "a"], defaults), "a manual order is respected");

  const timeline = [
    { segmentId: "1", title: "Cierre", included: true },
    { segmentId: "x", title: "Blooper", included: false },
    { segmentId: "2", title: "Intro", included: true },
    { segmentId: "3", title: "Producto", included: true },
  ];
  const change = scriptOrderChange(timeline, ["2", "3", "1"]);
  assert.ok(change);
  assert.deepEqual(change.next.map((clip) => clip.segmentId), ["2", "x", "3", "1"], "the excluded take keeps its slot");
  assert.deepEqual(change.moved, [{ title: "Intro", from: 2, to: 1 }, { title: "Producto", from: 3, to: 2 }, { title: "Cierre", from: 1, to: 3 }]);
  assert.equal(scriptOrderChange(change.next, ["2", "3", "1"]), null);
});

test("capture date is read from MOV/MP4 headers whether the movie box is first or last", async () => {
  assert.ok(ffmpegPath);
  assert.equal(parseMetadataDate("2026-10-31T12:20:36-0500")?.toISOString(), "2026-10-31T17:20:36.000Z");
  const directory = await mkdtemp(join(tmpdir(), "segmenta-capture-date-"));
  const make = (name: string, extra: string[]) => {
    const output = join(directory, name);
    const result = spawnSync(ffmpegPath!, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", ...extra, output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return openAsBlob(output);
  };
  try {
    const apple = await readCaptureDate(await make("iphone.mov", ["-movflags", "use_metadata_tags", "-metadata", "com.apple.quicktime.creationdate=2026-10-31T12:20:36-0500", "-metadata", "creation_time=2026-10-31T17:57:53Z"]));
    assert.deepEqual(apple && { source: apple.source, at: apple.date.toISOString() }, { source: "apple", at: "2026-10-31T17:20:36.000Z" }, "Apple's capture date wins over the container's export time");
    const tail = await readCaptureDate(await make("android.mp4", ["-metadata", "creation_time=2026-11-06T19:39:47Z"]));
    assert.deepEqual(tail && { source: tail.source, at: tail.date.toISOString() }, { source: "mvhd", at: "2026-11-06T19:39:47.000Z" });
    const head = await readCaptureDate(await make("faststart.mp4", ["-metadata", "creation_time=2026-11-06T19:39:47Z", "-movflags", "+faststart"]));
    assert.equal(head?.date.toISOString(), "2026-11-06T19:39:47.000Z");
    assert.equal(await readCaptureDate(await make("whatsapp.mp4", ["-map_metadata", "-1", "-fflags", "+bitexact"])), null, "a forwarded video without dates gives none");
    assert.equal(await readCaptureDate(new Blob(["not a video at all"])), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
