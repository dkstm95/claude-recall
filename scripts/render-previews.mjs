import { writeFileSync } from 'node:fs';
import { formatStatusline, stripAnsi, displayWidth, getContentWidth } from '../dist/format.js';
import { DEFAULT_CONFIG } from '../dist/config.js';
import { createEmptySessionState } from '../dist/state.js';
import { lineSvg, escapeXml as escape } from './ansi-svg.mjs';

// Explicit themes make generated assets independent of the host terminal.
delete process.env.NO_COLOR;
const cell = 7.2;
const surfaces = {
  default: { page: '#0f1018', panel: '#1a1b26', border: '#3b3d52', text: '#c0caf5', dim: '#8b90a8' },
  light: { page: '#e9ecf3', panel: '#f5f6fa', border: '#c8cede', text: '#343b58', dim: '#626b87' },
};
const examples = [
  { cwd: '/projects/api', branch: 'feat/auth', focus: 'Implement OAuth refresh', prompt: 'handle expired refresh tokens', turns: 12, ctx: 42, duration: 17 },
  { cwd: '/projects/web', branch: 'fix/layout', focus: 'Fix mobile navigation', prompt: 'check the narrow-screen menu', turns: 8, ctx: 76, duration: 32 },
  { cwd: '/projects/api', branch: 'test/cache', focus: 'Test cache isolation', prompt: 'verify concurrent session writes', turns: 4, ctx: 27, duration: 9 },
  { cwd: '/projects/docs', branch: 'docs/setup', focus: 'Update setup instructions', prompt: 'document the supported CLI version', turns: 6, ctx: 61, duration: 24 },
];
function panel(example, width, x, y, title, theme) {
  const surface = surfaces[theme];
  const state = { ...createEmptySessionState('preview', example.cwd), focus: example.focus, branch: example.branch,
    promptCount: example.turns, lastUserPrompt: example.prompt,
    gitStatus: { branch: example.branch, dirty: true, ahead: 2, behind: 0, defaultBranch: 'main' } };
  const builtin = { model: { display_name: 'Sonnet 4.6' }, cost: { total_duration_ms: example.duration * 60_000, total_cost_usd: 0.03 },
    context_window: { used_percentage: example.ctx },
    rate_limits: { five_hour: { used_percentage: 52, resets_at: new Date(2026, 9, 1, 17, 0).getTime() / 1000 },
      seven_day: { used_percentage: 19, resets_at: new Date(2026, 9, 5, 9, 0).getTime() / 1000 } } };
  const contentWidth = getContentWidth(width);
  const lines = formatStatusline(state, contentWidth, builtin, { ...DEFAULT_CONFIG, theme }).split('\n');
  for (const line of lines) if (displayWidth(stripAnsi(line)) > contentWidth) throw new Error('Preview exceeds terminal width');
  const px = width * cell + 32;
  return `<g transform="translate(${x},${y})"><rect width="${px}" height="155" rx="8" fill="${surface.panel}" stroke="${surface.border}"/>
<path d="M0 32 H${px}" stroke="${surface.border}"/>
<text x="16" y="21" fill="${surface.dim}">${escape(title)} · ${width} columns · ${contentWidth} usable</text>
<text x="16" y="57" fill="${surface.text}">❯ ${escape(example.prompt)}</text>
${lines.map((line, i) => lineSvg(line, 89 + i * 22, surface.text)).join('\n')}</g>`;
}
function svg(width, height, content, description, theme) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(description)}</title><rect width="${width}" height="${height}" rx="12" fill="${surfaces[theme].page}"/><g font-family="Menlo,Consolas,monospace" font-size="12">${content}</g></svg>\n`;
}
for (const theme of ['default', 'light']) {
  const suffix = theme === 'light' ? '-light' : '';
  writeFileSync(`assets/statusline-preview${suffix}.svg`, svg(936, 370,
    examples.slice(0, 2).map((e, i) => panel(e, 120, 20, 20 + i * 175, `Terminal ${i + 1}`, theme)).join('\n'),
    `Two sessions with the ${theme} theme and full reset times`, theme));
  writeFileSync(`assets/split-panes-preview${suffix}.svg`, svg(980, 370,
    examples.map((e, i) => panel(e, 60, 20 + (i % 2) * 480, 20 + Math.floor(i / 2) * 175, `Pane ${i + 1}`, theme)).join('\n'),
    `Four narrow panes with the ${theme} theme and actual segment compaction order`, theme));
}
