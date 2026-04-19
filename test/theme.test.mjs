import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getThemeColors, detectBackgroundTheme } from '../dist/config.js';

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('getThemeColors: default theme emits ANSI codes', () => {
  withEnv({ NO_COLOR: undefined }, () => {
    const tc = getThemeColors('default');
    assert.ok(tc.focus('x').includes('\x1b['), 'focus should emit ANSI');
    assert.ok(tc.accents.length >= 1);
  });
});

test('getThemeColors: minimal yellow and red are visually distinguishable', () => {
  // Regression: both were \x1b[1m, making 50% and 80% rate-limit bars identical.
  withEnv({ NO_COLOR: undefined }, () => {
    const tc = getThemeColors('minimal');
    const y = tc.yellow('BAR');
    const r = tc.red('BAR');
    assert.notEqual(y, r, 'minimal yellow must differ from red');
    // Red uses reverse video (7) so it cannot collapse into plain bold
    assert.ok(r.includes('7'), `minimal red should use reverse video, got ${JSON.stringify(r)}`);
  });
});

test('getThemeColors: vivid prompt is not bright-white (invisible on light bg)', () => {
  withEnv({ NO_COLOR: undefined }, () => {
    const tc = getThemeColors('vivid');
    const p = tc.prompt('P');
    assert.ok(!p.includes('97'), `vivid prompt must not use bright-white 97m, got ${JSON.stringify(p)}`);
  });
});

test('getThemeColors: light theme exists and avoids yellow-on-white', () => {
  withEnv({ NO_COLOR: undefined }, () => {
    const tc = getThemeColors('light');
    const y = tc.yellow('Y');
    // light yellow should route through 256-color orange (38;5;166), NOT 16-color yellow (33)
    assert.ok(y.includes('38;5;166'), `light yellow should be 256-color orange, got ${JSON.stringify(y)}`);
    const m = tc.model('M');
    assert.ok(!m.includes('\x1b[33m'), `light model must not use plain yellow 33m, got ${JSON.stringify(m)}`);
  });
});

test('getThemeColors: NO_COLOR env disables every color (all themes)', () => {
  for (const theme of ['default', 'minimal', 'vivid', 'light']) {
    withEnv({ NO_COLOR: '' }, () => {
      const tc = getThemeColors(theme);
      assert.equal(tc.focus('hello'), 'hello', `${theme} focus must be identity under NO_COLOR`);
      assert.equal(tc.red('x'), 'x', `${theme} red must be identity under NO_COLOR`);
      assert.equal(tc.accents.length, 1, `${theme} accents collapses to 1 identity under NO_COLOR`);
      assert.equal(tc.accents[0]('x'), 'x', `${theme} accent must be identity`);
    });
  }
});

test('detectBackgroundTheme: absent COLORFGBG returns default', () => {
  withEnv({ COLORFGBG: undefined }, () => {
    assert.equal(detectBackgroundTheme(), 'default');
  });
});

test('detectBackgroundTheme: bg=0 (dark) returns default', () => {
  withEnv({ COLORFGBG: '15;0' }, () => {
    assert.equal(detectBackgroundTheme(), 'default');
  });
});

test('detectBackgroundTheme: bg=15 (white) returns light', () => {
  withEnv({ COLORFGBG: '0;15' }, () => {
    assert.equal(detectBackgroundTheme(), 'light');
  });
});

test('detectBackgroundTheme: bg=7 (light gray) returns light', () => {
  withEnv({ COLORFGBG: '0;7' }, () => {
    assert.equal(detectBackgroundTheme(), 'light');
  });
});

test('detectBackgroundTheme: three-part form (fg;default;bg)', () => {
  withEnv({ COLORFGBG: '0;default;15' }, () => {
    assert.equal(detectBackgroundTheme(), 'light');
  });
  withEnv({ COLORFGBG: '15;default;0' }, () => {
    assert.equal(detectBackgroundTheme(), 'default');
  });
});

test('detectBackgroundTheme: malformed input falls back to default', () => {
  withEnv({ COLORFGBG: 'garbage' }, () => {
    assert.equal(detectBackgroundTheme(), 'default');
  });
  withEnv({ COLORFGBG: '' }, () => {
    assert.equal(detectBackgroundTheme(), 'default');
  });
});

