import type { RefinementError, GitStatus } from './state.js';
import type { StatuslineConfig } from './config.js';
import type { BuiltinData } from './statusline-types.js';
import type { RenderContext } from './statusline-render-context.js';
import type { Segment } from './statusline-layout.js';
import { progressiveJoin } from './statusline-layout.js';
import { makeRightSegment, makeSegment } from './statusline-segments.js';
import { truncate } from './terminal-text.js';

export const FOCUS_PLACEHOLDER = '(no focus yet)';
const MIN_FOCUS_COLS = 15;

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

function worktreeName(builtin: BuiltinData | undefined): string | undefined {
  const modern = builtin?.worktree?.name ?? builtin?.worktree?.path;
  if (modern) return basenameOf(modern);
  const legacy = builtin?.workspace?.git_worktree;
  return legacy ? basenameOf(legacy) : undefined;
}

const ERROR_LABELS: Record<RefinementError['code'], string> = {
  timeout: '\u26A0 AI timeout',
  rate_limit: '\u26A0 AI rate limited',
  auth: '\u26A0 AI auth failed',
  unknown: '\u26A0 AI refinement failed',
};

function renderGitText(gs: GitStatus, cfg: StatuslineConfig['gitStatus']): string {
  let text = gs.branch;
  if (cfg.showDirty && gs.dirty) text += '*';
  if (cfg.showAheadBehind) {
    if (gs.ahead > 0) text += `\u2191${gs.ahead}`;
    if (gs.behind > 0) text += `\u2193${gs.behind}`;
  }
  return text;
}

function titleCase(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s;
}

function modelNameFromId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const match = id.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (!match) return id;
  return `${titleCase(match[1]!)} ${match[2]}.${match[3]}`;
}

function displayHasVersion(displayName: string): boolean {
  return /\d/.test(displayName);
}

function modelDisplay(builtin: BuiltinData | undefined): string | undefined {
  const displayName = builtin?.model?.display_name;
  const idName = modelNameFromId(builtin?.model?.id);
  const base = displayName && displayHasVersion(displayName) ? displayName : (idName ?? displayName);
  if (!base) return undefined;

  const suffixes: string[] = [];
  const effort = builtin?.effort?.level;
  if (effort) suffixes.push(effort);
  if (builtin?.thinking?.enabled) suffixes.push('thinking');

  return suffixes.length > 0 ? `${base} · ${suffixes.join(' · ')}` : base;
}

function prDisplay(pr: BuiltinData['pr']): string | undefined {
  if (!pr) return undefined;
  if (typeof pr.number === 'number') return `PR #${pr.number}`;
  return pr.title ? `PR ${truncate(pr.title, 24)}` : undefined;
}

function buildLine1RightSegments(ctx: RenderContext): Segment[] {
  const l1 = ctx.cfg.line1;
  const segs: Segment[] = [];

  const wtName = l1.includes('worktree') ? worktreeName(ctx.builtin) : undefined;
  if (wtName) {
    segs.push(makeRightSegment(ctx.tc.worktree('\u2387 ' + wtName), ctx.gridOn));
  }

  if (l1.includes('session') && ctx.builtin?.session_name) {
    segs.push(makeRightSegment(ctx.tc.worktree('\u00A7 ' + truncate(ctx.builtin.session_name, 24)), ctx.gridOn));
  }

  if (l1.includes('agent') && ctx.builtin?.agent?.name) {
    segs.push(makeRightSegment(ctx.tc.model('@' + truncate(ctx.builtin.agent.name, 24)), ctx.gridOn));
  }

  if (l1.includes('pr')) {
    const prText = prDisplay(ctx.builtin?.pr);
    if (prText) segs.push(makeRightSegment(ctx.tc.branch(prText), ctx.gridOn));
  }

  if (l1.includes('branch') && ctx.cfg.gitStatus.enabled && ctx.state.gitStatus?.branch) {
    const gitText = renderGitText(ctx.state.gitStatus, ctx.cfg.gitStatus);
    segs.push(makeRightSegment(ctx.tc.branch(gitText), ctx.gridOn));
  } else if (l1.includes('branch') && ctx.state.branch) {
    segs.push(makeRightSegment(ctx.tc.branch(ctx.state.branch), ctx.gridOn));
  }

  const modelText = l1.includes('model') ? modelDisplay(ctx.builtin) : undefined;
  if (modelText) {
    segs.push(makeRightSegment(ctx.tc.model(modelText), ctx.gridOn));
  }

  return segs;
}

function renderLine1Left(ctx: RenderContext, availLeft: number): Segment {
  if (ctx.state.refinementError) {
    return makeSegment(ctx.tc.red(ERROR_LABELS[ctx.state.refinementError.code]));
  }

  if (!ctx.cfg.line1.includes('focus')) {
    return { text: '', width: 0 };
  }

  if (ctx.state.focus) {
    return makeSegment(ctx.tc.focus(truncate(ctx.state.focus, Math.max(availLeft, MIN_FOCUS_COLS))));
  }

  return makeSegment(ctx.tc.dim(FOCUS_PLACEHOLDER));
}

export function renderLine1(ctx: RenderContext): string {
  const rightJoined = progressiveJoin(
    buildLine1RightSegments(ctx),
    ctx.termWidth - ctx.prefixWidth,
    MIN_FOCUS_COLS,
    ctx.joiner,
  );
  const spaceForRight = rightJoined.width > 0 ? rightJoined.width + 2 : 0;
  const availLeft = ctx.termWidth - ctx.prefixWidth - spaceForRight;
  const left = renderLine1Left(ctx, availLeft);
  const gap = Math.max(1, ctx.termWidth - ctx.prefixWidth - left.width - rightJoined.width);
  return ctx.prefix + left.text + ' '.repeat(gap) + rightJoined.text;
}
