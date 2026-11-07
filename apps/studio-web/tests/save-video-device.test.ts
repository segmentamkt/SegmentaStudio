import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { saveVideoToDevice, videoDeviceFile, videoDeviceFilename } from '../lib/save-video-device';

function browser(t: TestContext, navigation: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const revoked: string[] = [];
  const scheduled: (() => void)[] = [];
  const link = { href: '', download: '', style: { display: '' }, click: () => { calls.push('click'); }, remove: () => { calls.push('remove'); } };
  const values: Record<string, unknown> = {
    navigator: navigation,
    document: { createElement: (tag: string) => { assert.equal(tag, 'a'); return link; }, body: { appendChild: (element: unknown) => { assert.equal(element, link); calls.push('append'); } } },
    window: { setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 60_000); scheduled.push(callback); return 1; } },
  };
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
  t.mock.method(URL, 'createObjectURL', (file: Blob) => { assert.ok(file instanceof File); calls.push('object-url'); return 'blob:local-video'; });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  return { calls, revoked, scheduled, link };
}

const video = () => new Blob(['recorded-video'], { type: 'video/mp4;codecs=avc1' });

test('uses the actual recording container, sanitizes filenames and preserves bytes', async () => {
  const blob = new Blob(['webm-data'], { type: 'video/webm;codecs=vp9,opus' });
  const file = videoDeviceFile(blob, 'Sesión / escena.mp4');
  assert.equal(file.name, 'Sesión - escena.webm');
  assert.equal(file.type, 'video/webm');
  assert.equal(await file.text(), 'webm-data');
  assert.equal(videoDeviceFilename('..\u202e\\:toma\n.mov', 'video/quicktime'), '--toma.mov');
  assert.equal(videoDeviceFilename('   ', 'video/mp4'), 'video-segmenta.mp4');
  assert.ok(videoDeviceFilename('x'.repeat(300), 'video/mp4').length <= 154);
});

test('infers an empty File MIME from a known video extension but rejects non-video and missing recordings', () => {
  const file = new File(['video'], 'source.MOV', { lastModified: 12345 });
  const output = videoDeviceFile(file, file.name);
  assert.equal(output.type, 'video/quicktime');
  assert.equal(output.name, 'source.mov');
  assert.equal(output.lastModified, 12345);
  assert.throws(() => videoDeviceFile(new Blob([], { type: 'video/mp4' }), 'empty.mp4'), /no hay un video/);
  assert.throws(() => videoDeviceFile(new Blob(['<html>'], { type: 'text/html' }), 'bad.mp4'), /formato/);
  assert.throws(() => videoDeviceFile('https://example.com/video.mp4' as unknown as Blob, 'remote.mp4'), /no hay un video/);
});

test('invokes supported native file sharing immediately within the click and returns an honest mode', async (t) => {
  const events: string[] = [];
  let shared: ShareData | undefined;
  const ui = browser(t, {
    userActivation: { isActive: true },
    canShare: (data: ShareData) => { events.push('canShare'); assert.deepEqual(Object.keys(data), ['files']); return true; },
    share: async (data: ShareData) => { events.push('share'); shared = data; },
  });
  const result = saveVideoToDevice(video(), 'Mi toma.mp4');
  assert.deepEqual(events, ['canShare', 'share']);
  assert.deepEqual(await result, { mode: 'shared', filename: 'Mi toma.mp4' });
  assert.equal(shared?.files?.[0].type, 'video/mp4');
  assert.equal(await shared?.files?.[0].text(), 'recorded-video');
  assert.equal(shared?.url, undefined);
  assert.deepEqual(ui.calls, []);
});

test('cancelled sharing never silently starts a download', async (t) => {
  const ui = browser(t, { canShare: () => true, share: async () => { throw new DOMException('Cancelado', 'AbortError'); } });
  assert.equal((await saveVideoToDevice(video(), 'Toma.mp4')).mode, 'cancelled');
  assert.deepEqual(ui.calls, []);
  assert.deepEqual(ui.revoked, []);
});

test('unsupported file sharing requests a blob download and revokes the URL only after the browser can use it', async (t) => {
  let shareCalled = false;
  const ui = browser(t, { canShare: () => false, share: async () => { shareCalled = true; } });
  assert.deepEqual(await saveVideoToDevice(video(), 'Toma.mp4'), { mode: 'download', filename: 'Toma.mp4' });
  assert.equal(shareCalled, false);
  assert.deepEqual(ui.calls, ['object-url', 'append', 'click', 'remove']);
  assert.equal(ui.link.href, 'blob:local-video');
  assert.equal(ui.link.download, 'Toma.mp4');
  assert.deepEqual(ui.revoked, []);
  ui.scheduled[0]();
  assert.deepEqual(ui.revoked, ['blob:local-video']);
});

test('browser with no share API uses download', async (t) => {
  const ui = browser(t);
  assert.equal((await saveVideoToDevice(video(), 'Toma.mp4')).mode, 'download');
  assert.ok(ui.calls.includes('click'));
});

test('failed native sharing falls back to downloading the same local video', async (t) => {
  const ui = browser(t, { canShare: () => true, share: async () => { throw new DOMException('No se pudo transmitir', 'DataError'); } });
  assert.equal((await saveVideoToDevice(video(), 'Toma.mp4')).mode, 'download');
  assert.ok(ui.calls.includes('click'));
});

test('expired user activation requires another explicit click without sharing or downloading', async (t) => {
  const ui = browser(t, { userActivation: { isActive: false }, canShare: () => true, share: async () => { assert.fail('share must not be called'); } });
  await assert.rejects(saveVideoToDevice(video(), 'Toma.mp4'), /Pulsa de nuevo/);
  assert.deepEqual(ui.calls, []);
});

test('a browser refusing the download cannot be reported as success and releases its object URL', async (t) => {
  const ui = browser(t);
  ui.link.click = () => { throw new Error('blocked'); };
  await assert.rejects(saveVideoToDevice(video(), 'Toma.mp4'), /no pudo iniciar la descarga/);
  assert.deepEqual(ui.revoked, ['blob:local-video']);
  assert.ok(ui.calls.includes('remove'));
  assert.equal(ui.scheduled.length, 0);
});
