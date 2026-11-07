import assert from 'node:assert/strict';
import test from 'node:test';
import { fitVisualResources, prepareVisualImage } from '../lib/visual-resource-editing';
import type { VisualResource } from '../lib/visual-resources';

function resource(id: string, startSeconds: number, endSeconds: number): VisualResource {
  return { id, keyword: 'idea', startSeconds, endSeconds, layout: 'corner', image: { kind: 'builtin', assetId: 'ideas' } };
}

test('manual trimming keeps overlapping images in source time without mutating the saved draft', () => {
  const resources = [resource('before', 0, 1), resource('opening', 1, 4), resource('inside', 4, 6), resource('closing', 7, 10), resource('after', 10, 12)];
  const original = structuredClone(resources);
  const result = fitVisualResources(resources, 2, 8);
  assert.deepEqual(result.map(({ id, startSeconds, endSeconds }) => ({ id, startSeconds, endSeconds })), [
    { id: 'opening', startSeconds: 2, endSeconds: 4 },
    { id: 'inside', startSeconds: 4, endSeconds: 6 },
    { id: 'closing', startSeconds: 7, endSeconds: 8 },
  ]);
  assert.deepEqual(resources, original);
  assert.notEqual(result[1], resources[2]);
  assert.equal(result[1].image, resources[2].image);
});

test('splitting a take keeps only the visible portion on either side of the cut', () => {
  const source = [resource('spanning-cut', 3, 7), resource('right-only', 8, 9)];
  assert.deepEqual(fitVisualResources(source, 0, 5).map(({ id, startSeconds, endSeconds }) => [id, startSeconds, endSeconds]), [['spanning-cut', 3, 5]]);
  assert.deepEqual(fitVisualResources(source, 5, 10).map(({ id, startSeconds, endSeconds }) => [id, startSeconds, endSeconds]), [['spanning-cut', 5, 7], ['right-only', 8, 9]]);
});

test('images in late source segments retain their absolute timestamps', () => {
  const result = fitVisualResources([resource('late', 498, 506)], 500, 510);
  assert.equal(result[0].startSeconds, 500);
  assert.equal(result[0].endSeconds, 506);
});

test('a 100ms overlap survives decimal subtraction while shorter remnants are removed', () => {
  const source = [resource('exact', 1, 1.2), resource('too-short', 1.2, 1.25)];
  assert.deepEqual(fitVisualResources(source, 1.1, 1.25).map((item) => item.id), ['exact']);
  assert.deepEqual(fitVisualResources([resource('touching', 1, 2)], 2, 3), []);
});

test('invalid ranges and non-finite stored timings never become active resources', () => {
  const source = [resource('valid', 1, 2), resource('nan', Number.NaN, 3), resource('infinity', 1, Number.POSITIVE_INFINITY), resource('reversed', 4, 2)];
  assert.deepEqual(fitVisualResources(source, 0, 5).map((item) => item.id), ['valid']);
  for (const [from, to] of [[-1, 3], [3, 3], [4, 2], [Number.NaN, 5], [0, Number.POSITIVE_INFINITY]]) {
    assert.deepEqual(fitVisualResources(source, from, to), []);
  }
});

test('image upload rejects SVG and oversized files before using browser decode APIs', async () => {
  await assert.rejects(prepareVisualImage(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' })), /PNG, JPEG o WebP/);
  await assert.rejects(prepareVisualImage(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })), /hasta 8 MB/);
});
