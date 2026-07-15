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

test('displayWidth: grapheme clusters match terminal cells', () => {
  assert.equal(displayWidth('e\u0301'), 1, 'combining accent');
  assert.equal(displayWidth('\u1100\u1161'), 2, 'decomposed Hangul Jamo');
  assert.equal(displayWidth('😀'), 2, 'emoji presentation');
  assert.equal(displayWidth('👩‍💻'), 2, 'ZWJ emoji sequence');
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

test('truncate: never splits a grapheme cluster', () => {
  assert.equal(truncate('👩‍💻XYZ', 3), '👩‍💻…');
  assert.equal(truncate('\u1100\u1161ABC', 3), '\u1100\u1161…');
});

test('truncate: strips terminal and bidi controls from external text', () => {
  const text = 'safe\x1b[2Jclear\x1b]0;PWNED\x07end\u202etext';
  const out = truncate(text, 100);
  assert.ok(!/[\x00-\x1f\x7f-\x9f\u202a-\u202e]/.test(out), JSON.stringify(out));
  assert.equal(out, 'safeclearendtext');
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

test('progressiveJoin: may drop every right segment to preserve the left budget', () => {
  const segs = [
    { text: 'single', width: 6 },
  ];
  const out = progressiveJoin(segs, 5, 10);
  assert.equal(out.text, '');
  assert.equal(out.width, 0);
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

test('getTerminalWidth: rejects invalid $COLUMNS (0 / negative) and falls back to 120', () => {
  withStreamColumns({ stdout: undefined, stderr: undefined }, () => {
    withEnvColumns('0', () => {
      assert.equal(getTerminalWidth(), 120);
    });
    withEnvColumns('-5', () => {
      assert.equal(getTerminalWidth(), 120);
    });
  });
});

// Regression (v6.2.4): older Claude Code versions did not propagate a usable
// width into statusline commands. Current versions pass COLUMNS, but the 120-col
// fallback still protects older/non-Claude invocations from Line 3's L1
// compaction hiding the 7d reset text by default.
test('getTerminalWidth: falls back to 120 when every source is unavailable', () => {
  withStreamColumns({ stdout: undefined, stderr: undefined }, () => {
    withEnvColumns(undefined, () => {
      assert.equal(getTerminalWidth(), 120);
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

test('getTerminalWidth: rejects partial, exponential, infinite, and excessive widths', () => {
  withStreamColumns({ stdout: Infinity, stderr: undefined }, () => {
    for (const invalid of ['80px', '1e3', '9'.repeat(400), '10001']) {
      withEnvColumns(invalid, () => {
        assert.equal(getTerminalWidth(), 120, `must reject COLUMNS=${invalid.slice(0, 20)}`);
      });
    }
  });
});
