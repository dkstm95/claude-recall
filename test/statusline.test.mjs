import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatStatusline,
  stripAnsi,
  FOCUS_PLACEHOLDER,
  PROMPT_PLACEHOLDER,
} from '../dist/format.js';
import { createEmptySessionState } from '../dist/state.js';

const BASE_CFG = {
  line1: ['focus', 'branch', 'model'],
  line2: ['turn', 'prompt', 'elapsed'],
  line3: ['context', 'rate_limits', 'seven_day', 'cost'],
  gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
  theme: 'default',
};

function emptyState() {
  return createEmptySessionState('test-session', '/tmp/project');
}

test('formatStatusline: first-entry (no focus, no prompt) still renders Line 1 + Line 2', () => {
  const out = formatStatusline(emptyState(), 120, { model: { display_name: 'Sonnet 4.6' } }, BASE_CFG);
  const lines = out.split('\n');
  assert.equal(lines.length, 2, `expected 2 lines, got ${lines.length}: ${JSON.stringify(out)}`);
  const clean1 = stripAnsi(lines[0]);
  const clean2 = stripAnsi(lines[1]);
  assert.ok(clean1.includes(FOCUS_PLACEHOLDER), `Line 1 should show focus placeholder, got "${clean1}"`);
  assert.ok(clean1.includes('Sonnet 4.6'), `Line 1 should show model, got "${clean1}"`);
  assert.ok(clean2.includes('#0'), `Line 2 should show turn 0, got "${clean2}"`);
  assert.ok(clean2.includes(PROMPT_PLACEHOLDER), `Line 2 should show prompt placeholder, got "${clean2}"`);
});

test('formatStatusline: first-entry with rate_limits renders all 3 lines', () => {
  const builtin = {
    model: { display_name: 'Sonnet 4.6' },
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: 1700000000 },
      seven_day: { used_percentage: 12, resets_at: 1700500000 },
    },
    cost: { total_cost_usd: 0.0 },
  };
  const out = formatStatusline(emptyState(), 140, builtin, BASE_CFG);
  const lines = out.split('\n');
  assert.equal(lines.length, 3, `expected 3 lines, got ${lines.length}: ${JSON.stringify(out)}`);
  const clean3 = stripAnsi(lines[2]);
  assert.ok(clean3.includes('5h'), `Line 3 should show 5h bar, got "${clean3}"`);
  assert.ok(clean3.includes('7d'), `Line 3 should show 7d bar, got "${clean3}"`);
});

test('formatStatusline: once a prompt exists, Line 2 shows the real prompt instead of placeholder', () => {
  const state = emptyState();
  state.lastUserPrompt = 'fix the bug';
  state.promptCount = 1;
  const out = formatStatusline(state, 120, { model: { display_name: 'Sonnet 4.6' } }, BASE_CFG);
  const lines = out.split('\n');
  const clean2 = stripAnsi(lines[1]);
  assert.ok(clean2.includes('fix the bug'), `Line 2 should show the prompt, got "${clean2}"`);
  assert.ok(!clean2.includes(PROMPT_PLACEHOLDER), `placeholder should be gone once prompt exists`);
  assert.ok(clean2.includes('#1'), `Line 2 should show turn 1, got "${clean2}"`);
});

test('formatStatusline: empty line2 config hides Line 2 entirely', () => {
  const cfg = { ...BASE_CFG, line2: [] };
  const out = formatStatusline(emptyState(), 120, { model: { display_name: 'Sonnet 4.6' } }, cfg);
  const lines = out.split('\n');
  assert.equal(lines.length, 1, `expected 1 line when line2 is disabled, got ${lines.length}: ${JSON.stringify(out)}`);
});

test('formatStatusline: refinementError suppresses focus placeholder (error wins)', () => {
  const state = emptyState();
  state.refinementError = { code: 'timeout', at: new Date().toISOString() };
  const out = formatStatusline(state, 120, {}, BASE_CFG);
  const clean1 = stripAnsi(out.split('\n')[0]);
  assert.ok(clean1.includes('AI timeout'), `Line 1 should show error label, got "${clean1}"`);
  assert.ok(!clean1.includes(FOCUS_PLACEHOLDER), `placeholder should yield to error label`);
});

test('formatStatusline: ctx bar renders on Line 3 when context_window present', () => {
  const builtin = {
    model: { display_name: 'Sonnet 4.6' },
    context_window: { used_percentage: 45 },
  };
  const out = formatStatusline(emptyState(), 140, builtin, BASE_CFG);
  const lines = out.split('\n');
  assert.equal(lines.length, 3, `expected 3 lines with ctx on L3, got ${lines.length}`);
  const clean3 = stripAnsi(lines[2]);
  assert.ok(clean3.includes('ctx'), `Line 3 should show ctx label, got "${clean3}"`);
  assert.ok(clean3.includes('45%'), `Line 3 should show 45%, got "${clean3}"`);
});

test('formatStatusline: Line 2 no longer carries context percentage', () => {
  const builtin = {
    model: { display_name: 'Sonnet 4.6' },
    context_window: { used_percentage: 45 },
  };
  const out = formatStatusline(emptyState(), 140, builtin, BASE_CFG);
  const clean2 = stripAnsi(out.split('\n')[1]);
  assert.ok(!clean2.includes('45%'), `Line 2 should NOT show context %, got "${clean2}"`);
});

test('formatStatusline: ≥90% context shows red ⚠ try /handoff on Line 1', () => {
  const builtin = {
    model: { display_name: 'Sonnet 4.6' },
    context_window: { used_percentage: 92 },
  };
  const out = formatStatusline(emptyState(), 140, builtin, BASE_CFG);
  const clean1 = stripAnsi(out.split('\n')[0]);
  assert.ok(clean1.includes('\u26A0 try /handoff'), `Line 1 should show ⚠ try /handoff at ≥90%, got "${clean1}"`);
});

test('formatStatusline: 70-89% context shows dim (try /handoff) hint on Line 1', () => {
  const builtin = {
    model: { display_name: 'Sonnet 4.6' },
    context_window: { used_percentage: 75 },
  };
  const out = formatStatusline(emptyState(), 140, builtin, BASE_CFG);
  const clean1 = stripAnsi(out.split('\n')[0]);
  assert.ok(clean1.includes('(try /handoff)'), `Line 1 should show (try /handoff) at 70-89%, got "${clean1}"`);
  assert.ok(!clean1.includes('\u26A0'), `Line 1 should NOT show ⚠ below 90%, got "${clean1}"`);
});

test('formatStatusline: ctx hidden when line3 is empty (opt-out)', () => {
  const cfg = { ...BASE_CFG, line3: [] };
  const builtin = { context_window: { used_percentage: 45 } };
  const out = formatStatusline(emptyState(), 140, builtin, cfg);
  const lines = out.split('\n');
  assert.ok(lines.every((l) => !stripAnsi(l).includes('ctx')), `ctx should be hidden when line3 is empty`);
});
