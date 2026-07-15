import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();

function runStatusline(input, home, configDir) {
  const child = spawn(process.execPath, [join(ROOT, 'dist/statusline.js')], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: configDir,
      COLUMNS: '80',
      NO_COLOR: '1',
    },
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
