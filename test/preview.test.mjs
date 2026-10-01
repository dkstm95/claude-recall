import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lineSvg } from '../scripts/ansi-svg.mjs';

test('preview preserves truecolor channels, bold and resets without interpreting RGB zero as reset', () => {
  const svg = lineSvg('\x1b[1;38;2;0;108;134m<&>\x1b[0m x', 89, '#343b58');
  assert.match(svg, /fill="#006c86" font-weight="bold"[^>]*>&lt;&amp;&gt;<\/text>/);
  assert.match(svg, /fill="#343b58" font-weight="normal"[^>]*> x<\/text>/);
  assert.throws(() => lineSvg('\x1b[38;5;245mx', 0, '#000000'), /Unsupported/);
});

test('README previews match the current formatter and color output in both themes', () => {
  const root = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), 'recall-preview-'));
  try {
    mkdirSync(join(temp, 'assets'));
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'render-previews.mjs')], {
      cwd: temp, env: { ...process.env, NO_COLOR: '1', TZ: 'UTC' }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    for (const name of ['statusline-preview', 'split-panes-preview']) {
      for (const suffix of ['', '-light']) {
        const file = `${name}${suffix}.svg`;
        assert.deepEqual(readFileSync(join(temp, 'assets', file)), readFileSync(join(root, 'assets', file)),
          `${file} is stale; run npm run preview`);
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
