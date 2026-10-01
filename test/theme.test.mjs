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

test('getThemeColors: dark and light colors remain readable on their preview backgrounds', () => {
  function luminance(rgb) {
    const channels = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  withEnv({ NO_COLOR: undefined }, () => {
    for (const [theme, backgrounds] of [
      ['default', [[26, 27, 38], [0, 0, 0]]],
      ['light', [[245, 246, 250], [255, 255, 255]]],
    ]) {
      const tc = getThemeColors(theme);
      for (const [role, color] of Object.entries(tc).flatMap(([name, value]) =>
        Array.isArray(value) ? value.map((fn, i) => [`${name}[${i}]`, fn]) : [[name, value]])) {
        const match = color('text').match(/38;2;(\d+);(\d+);(\d+)m/);
        assert.ok(match, `${theme}.${role} must emit truecolor`);
        const fg = luminance(match.slice(1).map(Number));
        for (const background of backgrounds) {
          const bg = luminance(background);
          const contrast = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          assert.ok(contrast >= 4.5, `${theme}.${role}: contrast ${contrast.toFixed(2)}`);
        }
      }
    }
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
