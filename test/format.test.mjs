import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayWidth,
  truncate,
  progressiveJoin,
} from '../dist/format.js';

test('displayWidth: ASCII counts one column per char', () => {
  assert.equal(displayWidth(''), 0);
  assert.equal(displayWidth('hello'), 5);
  assert.equal(displayWidth('  spaces  '), 10);
});

test('displayWidth: Korean (Hangul) counts two columns per char', () => {
  assert.equal(displayWidth('가'), 2);
  assert.equal(displayWidth('한글'), 4);
  assert.equal(displayWidth('가나다'), 6);
});

test('displayWidth: mixed ASCII + CJK', () => {
  assert.equal(displayWidth('a가b'), 4);
  assert.equal(displayWidth('v6.0.3 세션'), 6 + 1 + 4);
});

test('displayWidth: CJK punctuation range', () => {
  assert.equal(displayWidth('、。'), 4);
});

test('truncate: no-op when text fits in budget', () => {
  assert.equal(truncate('hello', 10), 'hello');
  assert.equal(truncate('hello', 5), 'hello');
});

test('truncate: appends ellipsis when over budget', () => {
  const out = truncate('abcdefghij', 5);
  assert.ok(out.endsWith('\u2026'), `expected ellipsis, got "${out}"`);
  assert.ok(displayWidth(out) <= 5, `width ${displayWidth(out)} > 5`);
});

test('truncate: CJK never overflows target cols', () => {
  // Korean chars are 2 cols; must reserve 1 col for ellipsis, so at most 2 chars fit in 5 cols
  const out = truncate('가나다라마', 5);
  assert.ok(displayWidth(out) <= 5, `width ${displayWidth(out)} > 5 for "${out}"`);
  assert.ok(out.endsWith('\u2026'));
});

test('truncate: mixed-width does not straddle the last column', () => {
  const out = truncate('aa가나다', 4);
  assert.ok(displayWidth(out) <= 4, `width ${displayWidth(out)} > 4 for "${out}"`);
});

test('truncate: replaces newline/tab/cr with spaces before measuring', () => {
  assert.equal(truncate('a\nb\tc\rd', 10), 'a b c d');
});

test('progressiveJoin: all segments fit within budget', () => {
  const segs = [
    { text: 'one', width: 3 },
    { text: 'two', width: 3 },
  ];
  const out = progressiveJoin(segs, 20, 5);
  assert.equal(out.text, 'one  two');
  assert.equal(out.width, 3 + 2 + 3);
});

test('progressiveJoin: drops rightmost segments when budget tight', () => {
  const segs = [
    { text: 'keep', width: 4 },
    { text: 'drop', width: 4 },
  ];
  const out = progressiveJoin(segs, 20, 15);
  assert.equal(out.text, 'keep');
  assert.equal(out.width, 4);
});

test('progressiveJoin: keeps at least one segment even if minLeft cannot be satisfied', () => {
  const segs = [
    { text: 'single', width: 6 },
  ];
  const out = progressiveJoin(segs, 5, 10);
  assert.equal(out.text, 'single');
});

test('progressiveJoin: empty array returns empty', () => {
  const out = progressiveJoin([], 20, 5);
  assert.equal(out.text, '');
  assert.equal(out.width, 0);
});
