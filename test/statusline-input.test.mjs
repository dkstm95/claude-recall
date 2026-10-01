import { isolatedEnv } from './helpers/environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();

function runStatusline(input, home, configDir) {
  const child = spawn(process.execPath, [join(ROOT, 'dist/statusline.js')], {
    env: isolatedEnv(home, {
      CLAUDE_CONFIG_DIR: configDir,
      COLUMNS: '80',
      NO_COLOR: '1',
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf-8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8'); });
  child.stdin.end(JSON.stringify(input));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('statusline input: malformed optional fields degrade without blanking valid output', async () => {
  const home = mkdtempSync(join(tmpdir(), 'claude-recall-statusline-input-'));
  const configDir = join(home, 'custom-config');
  try {
    const result = await runStatusline({
      session_id: 'schema-safe',
      cwd: '',
      model: { display_name: 'Opus', id: 7 },
      cost: { total_cost_usd: 'free', total_duration_ms: -100 },
      context_window: { used_percentage: 45 },
      worktree: 42,
      effort: { level: false },
      thinking: { enabled: 'yes' },
    }, home, configDir);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('(no focus yet)'), JSON.stringify(result.stdout));
    assert.ok(result.stdout.includes('#0'), JSON.stringify(result.stdout));
    assert.ok(result.stdout.includes('ctx'), JSON.stringify(result.stdout));
    assert.equal(existsSync(join(configDir, 'claude-recall', 'context-windows.json')), true);
    assert.equal(existsSync(join(home, '.claude', 'claude-recall')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('statusline input: new optional fields survive normalization and session caches stay separate', async () => {
  const home = mkdtempSync(join(tmpdir(), 'recall-metadata-input-'));
  const configDir = join(home, 'config');
  mkdirSync(join(configDir, 'claude-recall'), { recursive: true });
  writeFileSync(join(configDir, 'claude-recall', 'config.json'), JSON.stringify({ line1: ['pr', 'review', 'fast_mode'], line2: [], line3: ['spend_limit', 'prompt_cache'] }));
  try {
    const input = { session_id: 'gateway-session', pr: { number: 7, kind: 'mr', review_state: 'approved' }, fast_mode: true,
      prompt_cache: { warm: false, hit_ratio: 0.83 },
      rate_limits: { spend_limit: { used_percentage: 145, resets_at: Date.now() / 1000 + 3600 } } };
    const result = await runStatusline(input, home, configDir);
    assert.equal(result.code, 0);
    for (const text of ['MR #7', 'review approved', 'fast', '145%', 'cache cold 83%']) assert.ok(result.stdout.includes(text), result.stdout);
    const fresh = await runStatusline({ session_id: 'api-key-session' }, home, configDir);
    assert.doesNotMatch(fresh.stdout, /spend|145%/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
