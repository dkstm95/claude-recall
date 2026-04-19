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
function stripAnsi(s) {
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
export function getTerminalWidth() {
    const env = parseInt(process.env['COLUMNS'] ?? '', 10);
    if (!isNaN(env) && env > 0)
        return env;
    return 80;
}
const ACCENT_COLORS = [
    (s) => `\x1b[36m${s}\x1b[0m`,
    (s) => `\x1b[35m${s}\x1b[0m`,
    (s) => `\x1b[34m${s}\x1b[0m`,
    (s) => `\x1b[33m${s}\x1b[0m`,
    (s) => `\x1b[32m${s}\x1b[0m`,
    (s) => `\x1b[31m${s}\x1b[0m`,
];
function sessionColor(cwd, branch) {
    const key = `${cwd}:${branch}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
}
const MIN_FOCUS_COLS = 15;
const MIN_PROMPT_COLS = 30;
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
function renderBar(pct, width, tc) {
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round((clamped / 100) * width);
    const empty = width - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
    const color = clamped >= 80 ? tc.red : clamped >= 50 ? tc.yellow : tc.green;
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
function formatUsageSegment(label, pct, tc, resetText) {
    const bar = renderBar(pct, 10, tc);
    const pctText = `${Math.round(pct)}%`;
    const labelColored = tc.dim(label);
    const pctColored = pct >= 80 ? tc.red(pctText) : pct >= 50 ? tc.yellow(pctText) : tc.green(pctText);
    const resetPart = resetText ? ` ${tc.dim(resetText)}` : '';
    const text = `${labelColored} ${bar} ${pctColored}${resetPart}`;
    return { text, width: visibleWidth(text) };
}
export function formatStatusline(state, termWidth, builtin, config) {
    const cfg = config ?? {
        line1: ['focus', 'branch', 'model'],
        line2: ['turn', 'prompt', 'elapsed', 'context'],
        line3: ['rate_limits', 'seven_day', 'cost'],
        gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
        theme: 'default',
    };
    const l1 = cfg.line1;
    const l2 = cfg.line2;
    const l3 = cfg.line3;
    const tc = getThemeColors(cfg.theme);
    const elapsed = builtin?.cost?.total_duration_ms != null
        ? formatElapsedMs(builtin.cost.total_duration_ms)
        : formatElapsed(state.lastActivityAt);
    const prefixWidth = 3;
    const accent = sessionColor(state.cwd, state.branch);
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
    // Line 1 hint: (try /handoff) when context is 70-89% (≥90% uses L2 warning)
    const ctxPct = builtin?.context_window?.used_percentage;
    const wantsContinueHint = ctxPct != null && ctxPct >= 70 && ctxPct < 90;
    const HINT_WIDTH = 16;
    const spaceForRight1 = line1RightJoined.width > 0 ? line1RightJoined.width + 2 : 0;
    const availWithHint = termWidth - prefixWidth - HINT_WIDTH - spaceForRight1;
    const showContinueHint = wantsContinueHint && availWithHint >= MIN_FOCUS_COLS + 5;
    const hintText = showContinueHint ? tc.dim('  (try /handoff)') : '';
    const hintWidth = showContinueHint ? HINT_WIDTH : 0;
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
            const placeholder = tc.dim('(no focus yet)');
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
    // Line 2: #turn + last_prompt + elapsed/ctx (right)
    // =========================================================================
    if (!state.lastUserPrompt)
        return line1;
    const line2Right = [];
    if (l2.includes('elapsed')) {
        const s = tc.dim(elapsed);
        line2Right.push({ text: s, width: visibleWidth(s) });
    }
    if (l2.includes('context') && builtin?.context_window?.used_percentage != null) {
        const pct = Math.round(builtin.context_window.used_percentage);
        if (pct >= 90) {
            const warnText = `${pct}% \u26A0 try /handoff`;
            const warn = tc.red(warnText);
            line2Right.push({ text: warn, width: visibleWidth(warnText) });
        }
        else {
            const label = `${pct}%`;
            const s = pct >= 70 ? tc.yellow(label) : tc.green(label);
            line2Right.push({ text: s, width: visibleWidth(s) });
        }
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
        promptText = tc.prompt(truncate(state.lastUserPrompt, Math.max(maxPromptCols, MIN_PROMPT_COLS)));
        promptWidth = visibleWidth(promptText);
    }
    const gap2 = Math.max(1, termWidth - prefixWidth - turnWidth - promptWidth - line2RightJoined.width);
    const line2 = prefix + turnLabel + promptText + ' '.repeat(gap2) + line2RightJoined.text;
    // =========================================================================
    // Line 3 (opt-out): rate_limits bar + 7d bar + cost
    // =========================================================================
    const line3Segments = [];
    if (l3.includes('rate_limits') && builtin?.rate_limits?.five_hour?.used_percentage != null) {
        const pct = builtin.rate_limits.five_hour.used_percentage;
        const resetsAt = builtin.rate_limits.five_hour.resets_at;
        const resetText = resetsAt != null ? formatFiveHourReset(resetsAt) : undefined;
        line3Segments.push(formatUsageSegment('5h', pct, tc, resetText));
    }
    if (l3.includes('seven_day') && builtin?.rate_limits?.seven_day?.used_percentage != null) {
        const pct = builtin.rate_limits.seven_day.used_percentage;
        const resetsAt = builtin.rate_limits.seven_day.resets_at;
        const resetText = resetsAt != null ? formatSevenDayReset(resetsAt) : undefined;
        line3Segments.push(formatUsageSegment('7d', pct, tc, resetText));
    }
    if (l3.includes('cost') && builtin?.cost?.total_cost_usd != null) {
        const cost = builtin.cost.total_cost_usd;
        const s = tc.dim(cost < 0.01 ? '$0.00' : `$${cost.toFixed(2)}`);
        line3Segments.push({ text: s, width: visibleWidth(s) });
    }
    if (line3Segments.length === 0) {
        return line1 + '\n' + line2;
    }
    // Progressive drop for narrow terminals: drop cost first, then 7d, keeping 5h.
    const line3Joined = progressiveJoin(line3Segments, termWidth - prefixWidth, 0);
    const line3 = prefix + line3Joined.text;
    return line1 + '\n' + line2 + '\n' + line3;
}
