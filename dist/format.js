import { getThemeColors } from './config.js';
// CJK / fullwidth ranges occupy 2 terminal columns
function isWide(code) {
    return ((code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0x303e) ||
        (code >= 0x3040 && code <= 0x33bf) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff01 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x2fffd) ||
        (code >= 0x30000 && code <= 0x3fffd));
}
export function displayWidth(str) {
    let w = 0;
    for (const ch of str) {
        w += isWide(ch.codePointAt(0)) ? 2 : 1;
    }
    return w;
}
export function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, '');
}
function visibleWidth(s) {
    return displayWidth(stripAnsi(s));
}
export function truncate(text, maxCols) {
    const clean = text.replace(/[\n\t\r]/g, ' ');
    if (displayWidth(clean) <= maxCols)
        return clean;
    let result = '';
    let rc = 0;
    for (const c of clean) {
        const cw = isWide(c.codePointAt(0)) ? 2 : 1;
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
export function getTerminalWidth() {
    const stdout = process.stdout.columns;
    if (typeof stdout === 'number' && stdout > 0)
        return stdout;
    const stderr = process.stderr.columns;
    if (typeof stderr === 'number' && stderr > 0)
        return stderr;
    const env = parseInt(process.env.COLUMNS ?? '', 10);
    if (!isNaN(env) && env > 0)
        return env;
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
    if (!separator)
        return DEFAULT_JOINER;
    return { text: ` ${tc.dim(separator)} `, width: 1 + displayWidth(separator) + 1 };
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
        if (budget - w >= minLeft || count === 1) {
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
    if (modern)
        return basenameOf(modern);
    const legacy = builtin?.workspace?.git_worktree;
    return legacy ? basenameOf(legacy) : undefined;
}
const ERROR_LABELS = {
    timeout: '\u26A0 AI timeout',
    rate_limit: '\u26A0 AI rate limited',
    auth: '\u26A0 AI auth failed',
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
    const clamped = Math.max(0, Math.min(100, pct));
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
    const pctText = `${Math.round(pct)}%`;
    const labelColored = tc.dim(label);
    const pctColored = pct >= th.red ? tc.red(pctText) : pct >= th.yellow ? tc.yellow(pctText) : tc.green(pctText);
    const resetPart = resetText ? ` ${tc.dim(resetText)}` : '';
    const text = `${labelColored} ${bar} ${pctColored}${resetPart}`;
    return { text, width: visibleWidth(text) };
}
function buildLine3Segments(l3, builtin, ctxPct, tc, compactLevel) {
    const segs = [];
    if (l3.includes('context') && ctxPct != null) {
        segs.push(formatUsageSegment('ctx', ctxPct, tc, undefined, CTX_THRESHOLDS));
    }
    const fiveHour = builtin?.rate_limits?.five_hour;
    if (l3.includes('rate_limits') && fiveHour?.used_percentage != null) {
        const resetText = compactLevel < 2 && fiveHour.resets_at != null
            ? formatFiveHourReset(fiveHour.resets_at)
            : undefined;
        segs.push(formatUsageSegment('5h', fiveHour.used_percentage, tc, resetText));
    }
    const sevenDay = builtin?.rate_limits?.seven_day;
    // 7d's reset text ("(~M/D HH:MM)") is ~14 cols, 5h's ~10, so 7d's drops first.
    if (l3.includes('seven_day') && sevenDay?.used_percentage != null) {
        const resetText = compactLevel < 1 && sevenDay.resets_at != null
            ? formatSevenDayReset(sevenDay.resets_at)
            : undefined;
        segs.push(formatUsageSegment('7d', sevenDay.used_percentage, tc, resetText));
    }
    if (l3.includes('cost') && builtin?.cost?.total_cost_usd != null) {
        const cost = builtin.cost.total_cost_usd;
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
    return progressiveJoin(segs, budget, 0, joiner).text;
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
    if (!id)
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
    const displayName = builtin?.model?.display_name;
    const idName = modelNameFromId(builtin?.model?.id);
    const base = displayName && displayHasVersion(displayName) ? displayName : (idName ?? displayName);
    if (!base)
        return undefined;
    const suffixes = [];
    const effort = builtin?.effort?.level;
    if (effort)
        suffixes.push(effort);
    if (builtin?.thinking?.enabled)
        suffixes.push('thinking');
    return suffixes.length > 0 ? `${base} · ${suffixes.join(' · ')}` : base;
}
function prDisplay(pr) {
    if (!pr)
        return undefined;
    if (typeof pr.number === 'number')
        return `PR #${pr.number}`;
    return pr.title ? `PR ${truncate(pr.title, 24)}` : undefined;
}
function buildLine1RightSegments(ctx) {
    const l1 = ctx.cfg.line1;
    const segs = [];
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
        if (prText)
            segs.push(makeRightSegment(ctx.tc.branch(prText), ctx.gridOn));
    }
    if (l1.includes('branch') && ctx.cfg.gitStatus.enabled && ctx.state.gitStatus?.branch) {
        const gitText = renderGitText(ctx.state.gitStatus, ctx.cfg.gitStatus);
        segs.push(makeRightSegment(ctx.tc.branch(gitText), ctx.gridOn));
    }
    else if (l1.includes('branch') && ctx.state.branch) {
        segs.push(makeRightSegment(ctx.tc.branch(ctx.state.branch), ctx.gridOn));
    }
    const modelText = l1.includes('model') ? modelDisplay(ctx.builtin) : undefined;
    if (modelText) {
        segs.push(makeRightSegment(ctx.tc.model(modelText), ctx.gridOn));
    }
    return segs;
}
function renderLine1Left(ctx, availLeft) {
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
function renderLine1(ctx) {
    const rightJoined = progressiveJoin(buildLine1RightSegments(ctx), ctx.termWidth - ctx.prefixWidth, MIN_FOCUS_COLS, ctx.joiner);
    const spaceForRight = rightJoined.width > 0 ? rightJoined.width + 2 : 0;
    const availLeft = ctx.termWidth - ctx.prefixWidth - spaceForRight;
    const left = renderLine1Left(ctx, availLeft);
    const gap = Math.max(1, ctx.termWidth - ctx.prefixWidth - left.width - rightJoined.width);
    return ctx.prefix + left.text + ' '.repeat(gap) + rightJoined.text;
}
function renderPromptSegment(ctx, maxPromptCols) {
    if (!ctx.cfg.line2.includes('prompt')) {
        return { text: '', width: 0 };
    }
    if (ctx.state.lastUserPrompt) {
        return makeSegment(ctx.tc.prompt(truncate(ctx.state.lastUserPrompt, Math.max(maxPromptCols, MIN_PROMPT_COLS))));
    }
    return makeSegment(ctx.tc.dim(PROMPT_PLACEHOLDER));
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
    const turnRaw = `#${ctx.state.promptCount}  `;
    const turnLabel = hasTurn ? ctx.tc.dim(turnRaw) : '';
    const turnWidth = hasTurn ? turnRaw.length : 0;
    const line2Budget = ctx.termWidth - ctx.prefixWidth - turnWidth;
    const rightJoined = progressiveJoin(line2Right, line2Budget, MIN_PROMPT_COLS, ctx.joiner);
    const spaceForRight = rightJoined.width > 0 ? rightJoined.width + 2 : 0;
    const prompt = renderPromptSegment(ctx, line2Budget - spaceForRight);
    const gap = Math.max(1, ctx.termWidth - ctx.prefixWidth - turnWidth - prompt.width - rightJoined.width);
    return ctx.prefix + turnLabel + prompt.text + ' '.repeat(gap) + rightJoined.text;
}
export function formatStatusline(state, termWidth, builtin, config) {
    const cfg = config ?? DEFAULT_FORMAT_CONFIG;
    const tc = getThemeColors(cfg.theme);
    const joiner = makeJoiner(cfg.separator, tc);
    const gridOn = cfg.separator !== '';
    // Fallback uses sessionStartedAt (not lastActivityAt) to match stdin's
    // "wall-clock since session started" semantic.
    const elapsed = builtin?.cost?.total_duration_ms != null
        ? formatElapsedMs(builtin.cost.total_duration_ms)
        : formatElapsed(state.sessionStartedAt);
    const prefixWidth = 3;
    const accent = sessionColor(state.cwd, state.branch, tc.accents);
    const prefix = ' ' + accent('\u258D') + ' ';
    const ctxPct = builtin?.context_window?.used_percentage;
    const renderCtx = {
        state,
        termWidth,
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
    const line3Body = renderLine3(cfg.line3, builtin, ctxPct, tc, termWidth - prefixWidth, joiner);
    const line3 = line3Body !== null ? prefix + line3Body : null;
    const parts = [line1];
    if (line2)
        parts.push(line2);
    if (line3)
        parts.push(line3);
    return parts.join('\n');
}
