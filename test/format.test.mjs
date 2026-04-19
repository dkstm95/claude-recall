import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  displayWidth,
  truncate,
  progressiveJoin,
  getTerminalWidth,
} from '../dist/format.js';

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

test('getTerminalWidth: $COLUMNS overrides the fallback', () => {
  const saved = process.env.COLUMNS;
  process.env.COLUMNS = '140';
  try {
    assert.equal(getTerminalWidth(), 140);
  } finally {
    if (saved === undefined) delete process.env.COLUMNS;
    else process.env.COLUMNS = saved;
  }
});

test('getTerminalWidth: rejects invalid $COLUMNS (0 / negative) and falls back to 80', () => {
  const saved = process.env.COLUMNS;
  process.env.COLUMNS = '0';
  try {
    assert.equal(getTerminalWidth(), 80);
    process.env.COLUMNS = '-5';
    assert.equal(getTerminalWidth(), 80);
  } finally {
    if (saved === undefined) delete process.env.COLUMNS;
    else process.env.COLUMNS = saved;
  }
});
