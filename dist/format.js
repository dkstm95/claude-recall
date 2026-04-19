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
// Claude Code spawns the statusline with stdio: ['pipe', 'pipe', 'inherit'] —
// stdout is captured (so we can't read its columns), but stderr stays attached
// to the parent terminal. That makes process.stderr.columns the authoritative
// width for Claude Code's render area, sidestepping the /dev/tty multiplexer
// trap that bit v6.1.1 (outer tty wider than Claude Code's pane). stdout goes
// first for users who redirect stderr; $COLUMNS remains an explicit override
// for cases where neither stream is a TTY.
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
    return 80;
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
export const FOCUS_PLACEHOLDER = '(no focus yet)';
export const PROMPT_PLACEHOLDER = '(awaiting first prompt)';
export function progressiveJoin(segments, budget, minLeft) {
    for (let count = segments.length; count >= 1; count--) {
        const used = segments.slice(0, count);
        const text = used.map((s) => s.text).join('  ');
        const w = used.reduce((sum, s) => sum + s.width, 0) + (used.length - 1) * 2;
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
const ERROR_LABELS = {
    timeout: '\u26A0 AI timeout',
    rate_limit: '\u26A0 AI rate limited',
    auth: '\u26A0 AI auth failed',
    unknown: '\u26A0 AI refinement failed',
};
// Ordered high → low so a simple `.find(h => ctxPct >= h.min)` picks the most
// severe active tier. ≥90% deliberately drops the command name — auto-compact
// is imminent there, so prescribing an action that may be overridden in
// seconds is worse than surfacing only the severity.
const HINT_TIERS = [
    { min: 90, raw: '  \u26A0 ctx 90%+', color: (tc, s) => tc.red(s) },
    { min: 70, raw: '  (run /compact)', color: (tc, s) => tc.dim(s) },
    { min: 60, raw: '  (/compact soon)', color: (tc, s) => tc.dim(s) },
].map((h) => ({ ...h, width: displayWidth(h.raw) }));
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
function segmentsTotalWidth(segs) {
    if (segs.length === 0)
        return 0;
    return segs.reduce((sum, s) => sum + s.width, 0) + (segs.length - 1) * 2;
}
function renderLine3(l3, builtin, ctxPct, tc, budget) {
    const fullSegs = buildLine3Segments(l3, builtin, ctxPct, tc, 0);
    if (fullSegs.length === 0)
        return null;
    let segs = fullSegs;
    for (const level of [0, 1, 2]) {
        segs = level === 0 ? fullSegs : buildLine3Segments(l3, builtin, ctxPct, tc, level);
        if (segmentsTotalWidth(segs) <= budget) {
            return segs.map((s) => s.text).join('  ');
        }
    }
    // Even fully compacted (L2) exceeds the budget: drop segments right-to-left.
    // progressiveJoin keeps at least one, so ctx always survives when present.
    return progressiveJoin(segs, budget, 0).text;
}
export function formatStatusline(state, termWidth, builtin, config) {
    const cfg = config ?? {
        line1: ['focus', 'branch', 'model'],
        line2: ['turn', 'prompt', 'elapsed'],
        line3: ['context', 'rate_limits', 'seven_day', 'cost'],
        gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
        theme: 'default',
    };
    const l1 = cfg.line1;
    const l2 = cfg.line2;
    const l3 = cfg.line3;
    const tc = getThemeColors(cfg.theme);
    // Fallback uses sessionStartedAt (not lastActivityAt) to match stdin's
    // "wall-clock since session started" semantic.
    const elapsed = builtin?.cost?.total_duration_ms != null
        ? formatElapsedMs(builtin.cost.total_duration_ms)
        : formatElapsed(state.sessionStartedAt);
    const prefixWidth = 3;
    const accent = sessionColor(state.cwd, state.branch, tc.accents);
    const prefix = ' ' + accent('\u258D') + ' ';
    // =========================================================================
    // Line 1: focus (or error label) + right side (worktree / branch / model)
    // =========================================================================
    const line1Right = [];
    if (l1.includes('worktree') && builtin?.workspace?.git_worktree) {
        const name = basenameOf(builtin.workspace.git_worktree);
        const s = tc.worktree('\u2387 ' + name);
        line1Right.push({ text: s, width: visibleWidth(s) });
    }
    if (l1.includes('branch') && cfg.gitStatus.enabled && state.gitStatus && state.gitStatus.branch) {
        const gitText = renderGitText(state.gitStatus, cfg.gitStatus);
        const s = tc.branch(gitText);
        line1Right.push({ text: s, width: visibleWidth(s) });
    }
    else if (l1.includes('branch') && state.branch) {
        const s = tc.branch(state.branch);
        line1Right.push({ text: s, width: visibleWidth(s) });
    }
    if (l1.includes('model') && builtin?.model?.display_name) {
        const s = tc.model(builtin.model.display_name);
        line1Right.push({ text: s, width: visibleWidth(s) });
    }
    const line1RightJoined = progressiveJoin(line1Right, termWidth - prefixWidth, MIN_FOCUS_COLS);
    const ctxPct = builtin?.context_window?.used_percentage;
    const tier = ctxPct != null ? HINT_TIERS.find((h) => ctxPct >= h.min) : undefined;
    const spaceForRight1 = line1RightJoined.width > 0 ? line1RightJoined.width + 2 : 0;
    // Reserve against the ACTIVE tier's width, not a global max — this way a
    // narrow terminal that can fit the short critical hint but not the longer
    // suggest hint still shows the critical warning when ctx is actually ≥90%.
    const availWithHint = termWidth - prefixWidth - (tier?.width ?? 0) - spaceForRight1;
    const showHint = tier != null && availWithHint >= MIN_FOCUS_COLS + 5;
    const hintText = showHint ? tier.color(tc, tier.raw) : '';
    const hintWidth = showHint ? tier.width : 0;
    const availLeft = termWidth - prefixWidth - hintWidth - spaceForRight1;
    let leftText;
    let leftWidth;
    if (state.refinementError) {
        const raw = ERROR_LABELS[state.refinementError.code];
        const colored = tc.red(raw);
        leftText = colored;
        leftWidth = visibleWidth(colored);
    }
    else if (l1.includes('focus')) {
        if (state.focus) {
            const focusColored = tc.focus(truncate(state.focus, Math.max(availLeft, MIN_FOCUS_COLS)));
            leftText = focusColored;
            leftWidth = visibleWidth(focusColored);
        }
        else {
            const placeholder = tc.dim(FOCUS_PLACEHOLDER);
            leftText = placeholder;
            leftWidth = visibleWidth(placeholder);
        }
    }
    else {
        leftText = '';
        leftWidth = 0;
    }
    const gap1 = Math.max(1, termWidth - prefixWidth - leftWidth - hintWidth - line1RightJoined.width);
    const line1 = prefix + leftText + hintText + ' '.repeat(gap1) + line1RightJoined.text;
    // =========================================================================
    // Line 2: #turn + last_prompt + elapsed (right)
    // =========================================================================
    let line2 = null;
    if (l2.length > 0) {
        const line2Right = [];
        if (l2.includes('elapsed')) {
            const s = tc.dim(elapsed);
            line2Right.push({ text: s, width: visibleWidth(s) });
        }
        const hasTurn = l2.includes('turn');
        const turnLabel = hasTurn ? tc.dim(`#${state.promptCount}  `) : '';
        const turnWidth = hasTurn ? `#${state.promptCount}  `.length : 0;
        const line2Budget = termWidth - prefixWidth - turnWidth;
        const line2RightJoined = progressiveJoin(line2Right, line2Budget, MIN_PROMPT_COLS);
        const spaceForRight2 = line2RightJoined.width > 0 ? line2RightJoined.width + 2 : 0;
        let promptText = '';
        let promptWidth = 0;
        if (l2.includes('prompt')) {
            const maxPromptCols = line2Budget - spaceForRight2;
            if (state.lastUserPrompt) {
                promptText = tc.prompt(truncate(state.lastUserPrompt, Math.max(maxPromptCols, MIN_PROMPT_COLS)));
                promptWidth = visibleWidth(promptText);
            }
            else {
                const placeholder = tc.dim(PROMPT_PLACEHOLDER);
                promptText = placeholder;
                promptWidth = visibleWidth(placeholder);
            }
        }
        const gap2 = Math.max(1, termWidth - prefixWidth - turnWidth - promptWidth - line2RightJoined.width);
        line2 = prefix + turnLabel + promptText + ' '.repeat(gap2) + line2RightJoined.text;
    }
    // Line 3 priority: ctx > 5h > 7d > cost. See renderLine3() for the compaction ladder.
    const line3Body = renderLine3(l3, builtin, ctxPct, tc, termWidth - prefixWidth);
    const line3 = line3Body !== null ? prefix + line3Body : null;
    const parts = [line1];
    if (line2)
        parts.push(line2);
    if (line3)
        parts.push(line3);
    return parts.join('\n');
}
