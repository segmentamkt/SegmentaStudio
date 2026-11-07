import assert from 'node:assert/strict';
import test from 'node:test';
import { LARGE_DEVICE_COPY_MESSAGE, MAX_DEVICE_COPY_BYTES, readTakeDeviceCopy } from '../lib/take-device-copy';

function signal() { return new AbortController().signal; }

test('prepares original video bytes with the response container, not a conflicting metadata type', async () => {
  const blob = await readTakeDeviceCopy(new Response('webm-source', { headers: { 'content-type': 'video/webm;codecs=vp9,opus' } }), signal(), 'video/mp4');
  assert.equal(blob.type, 'video/webm');
  assert.equal(await blob.text(), 'webm-source');
});

test('uses recorded container metadata only when storage provides a generic content type', async () => {
  const blob = await readTakeDeviceCopy(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } }), signal(), 'video/quicktime');
  assert.equal(blob.type, 'video/quicktime');
  assert.equal(blob.size, 3);
});

test('a declared file larger than 100 MiB is rejected before reading its body', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await assert.rejects(readTakeDeviceCopy(new Response(body, { headers: { 'content-type': 'video/mp4', 'content-length': String(MAX_DEVICE_COPY_BYTES + 1) } }), signal()), { message: LARGE_DEVICE_COPY_MESSAGE });
  assert.equal(cancelled, true);
});

test('the stream byte limit rejects a misleading small Content-Length without loading an unbounded blob', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1)); controller.enqueue(new Uint8Array(MAX_DEVICE_COPY_BYTES)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readTakeDeviceCopy(new Response(body, { headers: { 'content-type': 'video/mp4', 'content-length': '1' } }), signal()), { message: LARGE_DEVICE_COPY_MESSAGE });
  assert.equal(cancelled, true);
});

test('cancelling a pending read releases the response and does not return a partial video', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const pending = readTakeDeviceCopy(new Response(body, { headers: { 'content-type': 'video/mp4' } }), controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('rejects expired sessions, empty videos and an HTML login page disguised by metadata', async () => {
  await assert.rejects(readTakeDeviceCopy(new Response('unauthorized', { status: 401 }), signal()), /sesión venció/);
  await assert.rejects(readTakeDeviceCopy(new Response('', { headers: { 'content-type': 'video/mp4' } }), signal()), /vacío/);
  await assert.rejects(readTakeDeviceCopy(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }), signal(), 'video/mp4'), /formato/);
});
