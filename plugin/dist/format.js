import { getThemeColors } from './config.js';
import { normalizeEpochSeconds, normalizeNonNegativeNumber, normalizePercentage } from './metrics.js';
import { graphemes, graphemeWidth, sanitizeTerminalText, stripTerminalSequences, terminalTextWidth, } from './terminal-text.js';
export function displayWidth(str) {
    return terminalTextWidth(str);
}
export function stripAnsi(s) {
    return stripTerminalSequences(s);
}
function visibleWidth(s) {
    return displayWidth(stripAnsi(s));
}
export function truncate(text, maxCols) {
    if (!Number.isFinite(maxCols) || maxCols <= 0)
        return '';
    const clean = sanitizeTerminalText(text);
    if (displayWidth(clean) <= maxCols)
        return clean;
    let result = '';
    let rc = 0;
    for (const c of graphemes(clean)) {
        const cw = graphemeWidth(c);
        if (rc + cw > maxCols - 1)
            break;
        result += c;
        rc += cw;
    }
    return result + '\u2026';
}
function formatDurationMs(ms) {
    if (isNaN(ms) || ms < 0)
        return '0m';
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0)
        return `${days}d ${hours % 24}h`;
    if (hours > 0)
        return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
}
export function formatElapsed(isoString) {
    if (!isoString)
        return '0m';
    return formatDurationMs(Date.now() - new Date(isoString).getTime());
}
export function formatElapsedMs(ms) {
    return formatDurationMs(ms);
}
// Claude Code pipes stdout/stderr to the statusline, so stream `.columns`
// values are normally unavailable. Since Claude Code 2.1.153, statusline
// commands receive COLUMNS/LINES in their environment; older versions and
// non-Claude invocations still fall back to 120. That fallback keeps Line 3's
// full L0 render (~91 cols) visible when no reliable width is propagated.
const WIDTH_FALLBACK = 120;
const WIDTH_MAX = 10_000;
function validWidth(value) {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0
        && value <= WIDTH_MAX;
}
export function getTerminalWidth() {
    const stdout = process.stdout.columns;
    if (validWidth(stdout))
        return stdout;
    const stderr = process.stderr.columns;
    if (validWidth(stderr))
        return stderr;
    const rawEnv = process.env['COLUMNS'] ?? '';
    if (/^[1-9]\d*$/.test(rawEnv)) {
        const env = Number(rawEnv);
        if (validWidth(env))
            return env;
    }
    return WIDTH_FALLBACK;
}
function sessionColor(cwd, branch, accents) {
    const key = `${cwd}:${branch}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return accents[Math.abs(hash) % accents.length];
}
const MIN_FOCUS_COLS = 15;
const MIN_PROMPT_COLS = 30;
// Uniform min cell width for right-zone segments (worktree, branch, model, elapsed).
// Left-padding to this width keeps `│` separators and rightmost content edges on
// stable columns across renders. Content wider than the min simply overflows —
// the grid is a soft alignment guide, not a hard constraint.
const CELL_MIN_WIDTH = 10;
const DEFAULT_JOINER = { text: '  ', width: 2 };
const DEFAULT_FORMAT_CONFIG = {
    line1: ['focus', 'branch', 'model'],
    line2: ['turn', 'prompt', 'elapsed'],
    line3: ['context', 'rate_limits', 'seven_day', 'cost'],
    gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
    theme: 'default',
    separator: '│',
};
export const FOCUS_PLACEHOLDER = '(no focus yet)';
export const PROMPT_PLACEHOLDER = '(awaiting first prompt)';
export function makeJoiner(separator, tc) {
    const clean = sanitizeSeparator(separator);
    if (!clean)
        return DEFAULT_JOINER;
    return { text: ` ${tc.dim(clean)} `, width: 1 + displayWidth(clean) + 1 };
}
function sanitizeSeparator(separator) {
    if (typeof separator !== 'string' || separator === '')
        return '';
    const clean = sanitizeTerminalText(separator).trim();
    return graphemes(clean)[0] ?? '';
}
export function padSegmentLeft(seg, minWidth) {
    if (seg.width >= minWidth)
        return seg;
    return { text: ' '.repeat(minWidth - seg.width) + seg.text, width: minWidth };
}
export function progressiveJoin(segments, budget, minLeft, joiner = DEFAULT_JOINER) {
    for (let count = segments.length; count >= 1; count--) {
        const used = segments.slice(0, count);
        const text = used.map((s) => s.text).join(joiner.text);
        const w = used.reduce((sum, s) => sum + s.width, 0) + (used.length - 1) * joiner.width;
        if (budget - w >= minLeft) {
            return { text, width: w };
        }
    }
    return { text: '', width: 0 };
}
function basenameOf(p) {
    const parts = p.split(/[\\/]+/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : p;
}
function worktreeName(builtin) {
    const modern = builtin?.worktree?.name ?? builtin?.worktree?.path;
    if (typeof modern === 'string' && modern)
        return basenameOf(modern);
    const legacy = builtin?.workspace?.git_worktree;
    return typeof legacy === 'string' && legacy ? basenameOf(legacy) : undefined;
}
const ERROR_LABELS = {
    timeout: '\u26A0 AI timeout',
    rate_limit: '\u26A0 AI rate limited',
    auth: '\u26A0 AI auth failed',
    setup_required: '\u26A0 AI setup required',
    unknown: '\u26A0 AI refinement failed',
};
function renderGitText(gs, cfg) {
    let text = gs.branch;
    if (cfg.showDirty && gs.dirty)
        text += '*';
    if (cfg.showAheadBehind) {
        if (gs.ahead > 0)
            text += `\u2191${gs.ahead}`;
        if (gs.behind > 0)
            text += `\u2193${gs.behind}`;
    }
    return text;
}
const DEFAULT_THRESHOLDS = { red: 80, yellow: 50 };
const CTX_THRESHOLDS = { red: 90, yellow: 70 };
function renderBar(pct, width, tc, th = DEFAULT_THRESHOLDS) {
    const clamped = normalizePercentage(pct) ?? 0;
    const filled = Math.round((clamped / 100) * width);
    const empty = width - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
    const color = clamped >= th.red ? tc.red : clamped >= th.yellow ? tc.yellow : tc.green;
    return color(bar);
}
function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}
function formatHM(d) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function formatFiveHourReset(resetsAtEpochSec) {
    return `(~${formatHM(new Date(resetsAtEpochSec * 1000))})`;
}
function formatSevenDayReset(resetsAtEpochSec) {
    const d = new Date(resetsAtEpochSec * 1000);
    return `(~${d.getMonth() + 1}/${d.getDate()} ${formatHM(d)})`;
}
function formatUsageSegment(label, pct, tc, resetText, th = DEFAULT_THRESHOLDS) {
    const bar = renderBar(pct, 10, tc, th);
    const normalizedPct = normalizePercentage(pct) ?? 0;
    const pctText = `${Math.round(normalizedPct)}%`;
    const labelColored = tc.dim(label);
    const pctColored = normalizedPct >= th.red ? tc.red(pctText) : normalizedPct >= th.yellow ? tc.yellow(pctText) : tc.green(pctText);
    const resetPart = resetText ? ` ${tc.dim(resetText)}` : '';
    const text = `${labelColored} ${bar} ${pctColored}${resetPart}`;
    return { text, width: visibleWidth(text) };
}
function buildLine3Segments(l3, builtin, ctxPct, tc, compactLevel) {
    const segs = [];
    const normalizedCtx = normalizePercentage(ctxPct);
    if (l3.includes('context') && normalizedCtx != null) {
        segs.push(formatUsageSegment('ctx', normalizedCtx, tc, undefined, CTX_THRESHOLDS));
    }
    const fiveHour = builtin?.rate_limits?.five_hour;
    const fiveHourPct = normalizePercentage(fiveHour?.used_percentage);
    if (l3.includes('rate_limits') && fiveHourPct != null) {
        const resetsAt = normalizeEpochSeconds(fiveHour?.resets_at);
        const resetText = compactLevel < 2 && resetsAt != null
            ? formatFiveHourReset(resetsAt)
            : undefined;
        segs.push(formatUsageSegment('5h', fiveHourPct, tc, resetText));
    }
    const sevenDay = builtin?.rate_limits?.seven_day;
    // 7d's reset text ("(~M/D HH:MM)") is ~14 cols, 5h's ~10, so 7d's drops first.
    const sevenDayPct = normalizePercentage(sevenDay?.used_percentage);
    if (l3.includes('seven_day') && sevenDayPct != null) {
        const resetsAt = normalizeEpochSeconds(sevenDay?.resets_at);
        const resetText = compactLevel < 1 && resetsAt != null
            ? formatSevenDayReset(resetsAt)
            : undefined;
        segs.push(formatUsageSegment('7d', sevenDayPct, tc, resetText));
    }
    const cost = normalizeNonNegativeNumber(builtin?.cost?.total_cost_usd);
    if (l3.includes('cost') && cost != null) {
        const s = tc.dim(cost < 0.01 ? '$0.00' : `$${cost.toFixed(2)}`);
        segs.push({ text: s, width: visibleWidth(s) });
    }
    return segs;
}
function segmentsTotalWidth(segs, joinerWidth) {
    if (segs.length === 0)
        return 0;
    return segs.reduce((sum, s) => sum + s.width, 0) + (segs.length - 1) * joinerWidth;
}
function renderLine3(l3, builtin, ctxPct, tc, budget, joiner) {
    const fullSegs = buildLine3Segments(l3, builtin, ctxPct, tc, 0);
    if (fullSegs.length === 0)
        return null;
    let segs = fullSegs;
    for (const level of [0, 1, 2]) {
        segs = level === 0 ? fullSegs : buildLine3Segments(l3, builtin, ctxPct, tc, level);
        if (segmentsTotalWidth(segs, joiner.width) <= budget) {
            return segs.map((s) => s.text).join(joiner.text);
        }
    }
    // Even fully compacted (L2) exceeds the budget: drop segments right-to-left.
    // progressiveJoin keeps at least one, so ctx always survives when present.
    const compacted = progressiveJoin(segs, budget, 0, joiner).text;
    return compacted || segs[0].text;
}
function makeSegment(text) {
    return { text, width: visibleWidth(text) };
}
function makeRightSegment(text, gridOn) {
    const seg = makeSegment(text);
    return gridOn ? padSegmentLeft(seg, CELL_MIN_WIDTH) : seg;
}
function titleCase(s) {
    return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}
function modelNameFromId(id) {
    if (typeof id !== 'string' || !id)
        return undefined;
    const match = id.match(/claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
    if (!match)
        return id;
    return `${titleCase(match[1])} ${match[2]}.${match[3]}`;
}
function displayHasVersion(displayName) {
    return /\d/.test(displayName);
}
function modelDisplay(builtin) {
    const rawDisplayName = builtin?.model?.display_name;
    const displayName = typeof rawDisplayName === 'string' ? rawDisplayName : undefined;
    const idName = modelNameFromId(builtin?.model?.id);
    const base = displayName && displayHasVersion(displayName) ? displayName : (idName ?? displayName);
    if (!base)
        return undefined;
    const suffixes = [];
    const effort = builtin?.effort?.level;
    if (typeof effort === 'string' && effort)
        suffixes.push(effort);
    if (builtin?.thinking?.enabled)
        suffixes.push('thinking');
    return suffixes.length > 0 ? `${base} · ${suffixes.join(' · ')}` : base;
}
function prDisplay(pr) {
    if (!pr || typeof pr !== 'object')
        return undefined;
    if (typeof pr.number === 'number' && Number.isFinite(pr.number))
        return `PR #${Math.trunc(pr.number)}`;
    return typeof pr.title === 'string' && pr.title ? `PR ${truncate(pr.title, 24)}` : undefined;
}
function buildLine1RightSegments(ctx) {
    const segs = [];
    const seen = new Set();
    for (const slot of ctx.cfg.line1) {
        if (slot === 'focus' || seen.has(slot))
            continue;
        seen.add(slot);
        let text;
        if (slot === 'worktree') {
            const wtName = worktreeName(ctx.builtin);
            if (wtName)
                text = ctx.tc.worktree('\u2387 ' + truncate(wtName, 24));
        }
        else if (slot === 'session' && typeof ctx.builtin?.session_name === 'string') {
            text = ctx.tc.worktree('\u00A7 ' + truncate(ctx.builtin.session_name, 24));
        }
        else if (slot === 'agent' && typeof ctx.builtin?.agent?.name === 'string') {
            text = ctx.tc.model('@' + truncate(ctx.builtin.agent.name, 24));
        }
        else if (slot === 'pr') {
            const prText = prDisplay(ctx.builtin?.pr);
            if (prText)
                text = ctx.tc.branch(prText);
        }
        else if (slot === 'branch' && ctx.cfg.gitStatus.enabled && ctx.state.gitStatus?.branch) {
            text = ctx.tc.branch(truncate(renderGitText(ctx.state.gitStatus, ctx.cfg.gitStatus), 48));
        }
        else if (slot === 'branch' && typeof ctx.state.branch === 'string' && ctx.state.branch) {
            text = ctx.tc.branch(truncate(ctx.state.branch, 48));
        }
        else if (slot === 'model') {
            const modelText = modelDisplay(ctx.builtin);
            if (modelText)
                text = ctx.tc.model(truncate(modelText, 40));
        }
        if (text)
            segs.push(makeRightSegment(text, ctx.gridOn));
    }
    return segs;
}
function renderLine1Left(ctx, availLeft) {
    if (availLeft <= 0)
        return { text: '', width: 0 };
    if (ctx.state.refinementError) {
        return makeSegment(ctx.tc.red(truncate(ERROR_LABELS[ctx.state.refinementError.code], availLeft)));
    }
    if (!ctx.cfg.line1.includes('focus')) {
        return { text: '', width: 0 };
    }
    if (ctx.state.focus) {
        return makeSegment(ctx.tc.focus(truncate(ctx.state.focus, availLeft)));
    }
    return makeSegment(ctx.tc.dim(truncate(FOCUS_PLACEHOLDER, availLeft)));
}
function renderLine1(ctx) {
    const contentBudget = Math.max(0, ctx.termWidth - ctx.prefixWidth);
    const hasLeft = !!ctx.state.refinementError || ctx.cfg.line1.includes('focus');
    const leftMinimum = ctx.state.refinementError
        ? displayWidth(ERROR_LABELS[ctx.state.refinementError.code])
        : hasLeft ? MIN_FOCUS_COLS : 0;
    const rightJoined = progressiveJoin(buildLine1RightSegments(ctx), contentBudget, leftMinimum + (hasLeft ? 1 : 0), ctx.joiner);
    const minimumGap = hasLeft && rightJoined.width > 0 ? 1 : 0;
    const availLeft = Math.max(0, contentBudget - rightJoined.width - minimumGap);
    const left = renderLine1Left(ctx, availLeft);
    const remaining = Math.max(0, contentBudget - left.width - rightJoined.width);
    const gap = rightJoined.width > 0 ? Math.max(minimumGap, remaining) : 0;
    return ctx.prefix + left.text + ' '.repeat(gap) + rightJoined.text;
}
function renderPromptSegment(ctx, maxPromptCols) {
    if (!ctx.cfg.line2.includes('prompt')) {
        return { text: '', width: 0 };
    }
    if (ctx.state.lastUserPrompt) {
        return makeSegment(ctx.tc.prompt(truncate(ctx.state.lastUserPrompt, maxPromptCols)));
    }
    return makeSegment(ctx.tc.dim(truncate(PROMPT_PLACEHOLDER, maxPromptCols)));
}
function renderLine2(ctx) {
    const l2 = ctx.cfg.line2;
    if (l2.length === 0)
        return null;
    const line2Right = [];
    if (l2.includes('elapsed')) {
        line2Right.push(makeRightSegment(ctx.tc.dim(ctx.elapsed), ctx.gridOn));
    }
    const hasTurn = l2.includes('turn');
    const turnRaw = `#${Number.isSafeInteger(ctx.state.promptCount) ? Math.max(0, ctx.state.promptCount) : 0}  `;
    const turnLabel = hasTurn ? ctx.tc.dim(turnRaw) : '';
    const turnWidth = hasTurn ? displayWidth(turnRaw) : 0;
    const hasPrompt = l2.includes('prompt');
    const hasLeft = hasTurn || hasPrompt;
    const desiredLeft = turnWidth + (hasPrompt ? MIN_PROMPT_COLS : 0);
    const contentBudget = Math.max(0, ctx.termWidth - ctx.prefixWidth);
    const rightJoined = progressiveJoin(line2Right, contentBudget, desiredLeft + (hasLeft ? 1 : 0), ctx.joiner);
    const minimumGap = hasLeft && rightJoined.width > 0 ? 1 : 0;
    const promptBudget = Math.max(0, contentBudget - turnWidth - rightJoined.width - minimumGap);
    const prompt = renderPromptSegment(ctx, promptBudget);
    const remaining = Math.max(0, contentBudget - turnWidth - prompt.width - rightJoined.width);
    const gap = rightJoined.width > 0 ? Math.max(minimumGap, remaining) : 0;
    return ctx.prefix + turnLabel + prompt.text + ' '.repeat(gap) + rightJoined.text;
}
export function formatStatusline(state, termWidth, builtin, config) {
    const safeTermWidth = validWidth(termWidth) ? termWidth : WIDTH_FALLBACK;
    const cfg = config ?? DEFAULT_FORMAT_CONFIG;
    const tc = getThemeColors(cfg.theme);
    const separator = sanitizeSeparator(cfg.separator);
    const joiner = makeJoiner(separator, tc);
    const gridOn = separator !== '';
    // Fallback uses sessionStartedAt (not lastActivityAt) to match stdin's
    // "wall-clock since session started" semantic.
    const durationMs = normalizeNonNegativeNumber(builtin?.cost?.total_duration_ms);
    const elapsed = durationMs != null
        ? formatElapsedMs(durationMs)
        : formatElapsed(state.sessionStartedAt);
    const prefixWidth = 3;
    const accent = sessionColor(typeof state.cwd === 'string' ? state.cwd : '', typeof state.branch === 'string' ? state.branch : '', tc.accents);
    const prefix = ' ' + accent('\u258D') + ' ';
    const ctxPct = builtin?.context_window?.used_percentage;
    const renderCtx = {
        state,
        termWidth: safeTermWidth,
        builtin,
        cfg,
        tc,
        joiner,
        gridOn,
        prefix,
        prefixWidth,
        elapsed,
    };
    const line1 = renderLine1(renderCtx);
    const line2 = renderLine2(renderCtx);
    // Line 3 priority: ctx > 5h > 7d > cost. See renderLine3() for the compaction ladder.
    const line3Body = renderLine3(cfg.line3, builtin, ctxPct, tc, safeTermWidth - prefixWidth, joiner);
    const line3 = line3Body !== null ? prefix + line3Body : null;
    const parts = [line1];
    if (line2)
        parts.push(line2);
    if (line3)
        parts.push(line3);
    return parts.join('\n');
}
