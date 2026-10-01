import { writeFileSync } from 'node:fs';
import { formatStatusline, stripAnsi, displayWidth } from '../dist/format.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { createEmptySessionState } from '../dist/state.js';

// Preview assets always demonstrate the default color theme, regardless of CI's NO_COLOR.
delete process.env.NO_COLOR;
const cell = 7.2;
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const colors = { 31: '#f7768e', 32: '#9ece6a', 33: '#e0af68', 34: '#7aa2f7', 35: '#bb9af7', 36: '#7dcfff' };
function lineSvg(line, y) {
  let column = 0, fill = '#c0caf5', weight = 'normal', out = '';
  for (const part of line.split(/(\x1b\[[0-9;]*m)/g)) {
    if (part.startsWith('\x1b[')) {
      const codes = part.slice(2, -1).split(';').map(Number);
      if (codes.includes(0)) { fill = '#c0caf5'; weight = 'normal'; }
      if (codes.includes(1)) weight = 'bold';
      if (codes[0] === 38 && codes[1] === 5) fill = '#8b90a8';
      else for (const code of codes) if (colors[code]) fill = colors[code];
    } else if (part) {
      out += `<text x="${16 + column * cell}" y="${y}" fill="${fill}" font-weight="${weight}" textLength="${displayWidth(part) * cell}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${escape(part)}</text>`;
      column += displayWidth(part);
    }
  }
  return out;
}
const examples = [
  { cwd: '/projects/api', branch: 'feat/auth', focus: 'Implement OAuth refresh', prompt: 'handle expired refresh tokens', turns: 12, ctx: 42, duration: 17 },
  { cwd: '/projects/web', branch: 'fix/layout', focus: 'Fix mobile navigation', prompt: 'check the narrow-screen menu', turns: 8, ctx: 76, duration: 32 },
  { cwd: '/projects/api', branch: 'test/cache', focus: 'Test cache isolation', prompt: 'verify concurrent session writes', turns: 4, ctx: 27, duration: 9 },
  { cwd: '/projects/docs', branch: 'docs/setup', focus: 'Update setup instructions', prompt: 'document the supported CLI version', turns: 6, ctx: 61, duration: 24 },
];
function panel(example, width, x, y, title) {
  const state = { ...createEmptySessionState('preview', example.cwd), focus: example.focus, branch: example.branch,
    promptCount: example.turns, lastUserPrompt: example.prompt,
    gitStatus: { branch: example.branch, dirty: true, ahead: 2, behind: 0, defaultBranch: 'main' } };
  const builtin = { model: { display_name: 'Sonnet 4.6' }, cost: { total_duration_ms: example.duration * 60_000, total_cost_usd: 0.03 },
    context_window: { used_percentage: example.ctx },
    rate_limits: { five_hour: { used_percentage: 52, resets_at: new Date(2026, 9, 1, 17, 0).getTime() / 1000 },
      seven_day: { used_percentage: 19, resets_at: new Date(2026, 9, 5, 9, 0).getTime() / 1000 } } };
  const lines = formatStatusline(state, width, builtin, DEFAULT_CONFIG).split('\n');
  for (const line of lines) if (displayWidth(stripAnsi(line)) > width) throw new Error('Preview exceeds terminal width');
  const px = width * cell + 32;
  return `<g transform="translate(${x},${y})"><rect width="${px}" height="155" rx="8" fill="#1a1b26" stroke="#3b3d52"/>
<path d="M0 32 H${px}" stroke="#3b3d52"/>
<text x="16" y="21" fill="#8b90a8">${escape(title)} · ${width} columns</text>
<text x="16" y="57" fill="#c0caf5">❯ ${escape(example.prompt)}</text>
${lines.map((line, i) => lineSvg(line, 89 + i * 22)).join('\n')}</g>`;
}
function svg(width, height, content, description) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(description)}</title><rect width="${width}" height="${height}" rx="12" fill="#0f1018"/><g font-family="Menlo,Consolas,monospace" font-size="12">${content}</g></svg>\n`;
}
writeFileSync('assets/statusline-preview.svg', svg(936, 370,
  examples.slice(0, 2).map((e, i) => panel(e, 120, 20, 20 + i * 175, `Terminal ${i + 1}`)).join('\n'), 'Two sessions with current default statusline and full reset times'));
writeFileSync('assets/split-panes-preview.svg', svg(980, 370,
  examples.map((e, i) => panel(e, 60, 20 + (i % 2) * 480, 20 + Math.floor(i / 2) * 175, `Pane ${i + 1}`)).join('\n'), 'Four narrow panes showing the actual segment compaction order'));
