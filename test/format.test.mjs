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

function withStreamColumns(values, fn) {
  const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const stderrDesc = Object.getOwnPropertyDescriptor(process.stderr, 'columns');
  Object.defineProperty(process.stdout, 'columns', { value: values.stdout, configurable: true, writable: true });
  Object.defineProperty(process.stderr, 'columns', { value: values.stderr, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (stdoutDesc) Object.defineProperty(process.stdout, 'columns', stdoutDesc);
    else delete process.stdout.columns;
    if (stderrDesc) Object.defineProperty(process.stderr, 'columns', stderrDesc);
    else delete process.stderr.columns;
  }
}

function withEnvColumns(value, fn) {
  const saved = process.env.COLUMNS;
  if (value === undefined) delete process.env.COLUMNS;
  else process.env.COLUMNS = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env.COLUMNS;
    else process.env.COLUMNS = saved;
  }
}

test('getTerminalWidth: stdout.columns takes highest precedence', () => {
  withStreamColumns({ stdout: 120, stderr: 200 }, () => {
    withEnvColumns('140', () => {
      assert.equal(getTerminalWidth(), 120);
    });
  });
});

test('getTerminalWidth: falls back to stderr.columns when stdout is piped (the Claude Code case)', () => {
  withStreamColumns({ stdout: undefined, stderr: 178 }, () => {
    withEnvColumns('140', () => {
      assert.equal(getTerminalWidth(), 178);
    });
  });
});

test('getTerminalWidth: $COLUMNS used when neither stdout nor stderr has columns', () => {
  withStreamColumns({ stdout: undefined, stderr: undefined }, () => {
    withEnvColumns('140', () => {
      assert.equal(getTerminalWidth(), 140);
    });
  });
});

test('getTerminalWidth: rejects invalid $COLUMNS (0 / negative) and falls back to 80', () => {
  withStreamColumns({ stdout: undefined, stderr: undefined }, () => {
    withEnvColumns('0', () => {
      assert.equal(getTerminalWidth(), 80);
    });
    withEnvColumns('-5', () => {
      assert.equal(getTerminalWidth(), 80);
    });
  });
});

test('getTerminalWidth: rejects zero-column streams (piped/non-TTY)', () => {
  withStreamColumns({ stdout: 0, stderr: 0 }, () => {
    withEnvColumns('140', () => {
      assert.equal(getTerminalWidth(), 140);
    });
  });
});
