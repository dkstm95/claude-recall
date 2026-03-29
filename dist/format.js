// CJK characters occupy 2 columns in terminal
function isWide(code) {
    return ((code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
        (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals
        (code >= 0x3040 && code <= 0x33bf) || // Japanese, CJK Compatibility
        (code >= 0x3400 && code <= 0x4dbf) || // CJK Unified Ext A
        (code >= 0x4e00 && code <= 0xa4cf) || // CJK Unified + Yi
        (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
        (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
        (code >= 0xfe30 && code <= 0xfe4f) || // CJK Compatibility Forms
        (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
        (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
        (code >= 0x20000 && code <= 0x2fffd) || // CJK Ext B+
        (code >= 0x30000 && code <= 0x3fffd) // CJK Ext G+
    );
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
export function formatElapsed(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0)
        return `${days}d ${hours % 24}h`;
    if (hours > 0)
        return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
}
export function getTerminalWidth() {
    const env = parseInt(process.env['COLUMNS'] ?? '', 10);
    if (!isNaN(env) && env > 0)
        return env;
    return 80;
}
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const boldCyan = (s) => `\x1b[1;36m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const MIN_PURPOSE_COLS = 15;
const MIN_PROMPT_COLS = 15;
const PURPOSE_HINT_THRESHOLD = 5;
function progressiveJoin(segments, budget) {
    // Try all segments, progressively drop from the end
    for (let count = segments.length; count >= 1; count--) {
        const used = segments.slice(0, count);
        const text = used.map(s => s.text).join('  ');
        const w = used.reduce((sum, s) => sum + s.width, 0) + (used.length - 1) * 2;
        if (budget - w >= MIN_PURPOSE_COLS || count === 1) {
            return { text, width: w };
        }
    }
    return { text: '', width: 0 };
}
export function formatHud(state, termWidth, builtin) {
    const elapsed = formatElapsed(state.lastActivityAt || state.startedAt);
    const prefixWidth = 3; // " ▍ "
    // === Line 1: stable info (purpose + hint + branch + model) ===
    const line1Segments = [];
    if (state.branch) {
        const s = cyan(state.branch);
        line1Segments.push({ text: s, width: visibleWidth(s) });
    }
    if (builtin?.model?.display_name) {
        const s = yellow(builtin.model.display_name);
        line1Segments.push({ text: s, width: visibleWidth(s) });
    }
    // Purpose hint
    const wantsHint = state.promptCount >= PURPOSE_HINT_THRESHOLD
        && state.promptCount % PURPOSE_HINT_THRESHOLD === 0;
    // Calculate right side of line 1
    const line1Right = progressiveJoin(line1Segments, termWidth - prefixWidth);
    // Try hint, drop it if purpose would be too short
    const HINT_WIDTH = 16;
    const spaceForRight1 = line1Right.width > 0 ? line1Right.width + 2 : 0;
    const availWithHint = termWidth - prefixWidth - HINT_WIDTH - spaceForRight1;
    const showHint = wantsHint && availWithHint >= MIN_PURPOSE_COLS + 5;
    const hintText = showHint ? dim('  (try /purpose)') : '';
    const hintWidth = showHint ? HINT_WIDTH : 0;
    const availPurpose = termWidth - prefixWidth - hintWidth - spaceForRight1;
    const purpose = state.purpose
        ? boldCyan(truncate(state.purpose, Math.max(availPurpose, MIN_PURPOSE_COLS)))
        : dim('(no purpose yet)');
    const purposeWidth = state.purpose ? visibleWidth(purpose) : 16;
    const gap1 = Math.max(1, termWidth - prefixWidth - purposeWidth - hintWidth - line1Right.width);
    const prefix1 = ' \u258D ';
    const line1 = prefix1 + purpose + hintText + ' '.repeat(gap1) + line1Right.text;
    // === Line 2: dynamic info (#turn + prompt + elapsed + ctx% + cost) ===
    if (!state.lastUserPrompt)
        return line1;
    const line2Segments = [];
    const elapsedSeg = dim(elapsed);
    line2Segments.push({ text: elapsedSeg, width: visibleWidth(elapsedSeg) });
    if (builtin?.context_window?.used_percentage != null) {
        const pct = Math.round(builtin.context_window.used_percentage);
        const label = `${pct}%`;
        const s = pct >= 90 ? red(label) : pct >= 70 ? yellow(label) : green(label);
        line2Segments.push({ text: s, width: visibleWidth(s) });
    }
    if (builtin?.cost?.total_cost_usd != null) {
        const cost = builtin.cost.total_cost_usd;
        const s = dim(cost < 0.01 ? '$0.00' : `$${cost.toFixed(2)}`);
        line2Segments.push({ text: s, width: visibleWidth(s) });
    }
    const turnLabel = dim(`#${state.promptCount}  `);
    const turnWidth = `#${state.promptCount}  `.length;
    // Calculate right side of line 2, progressively drop if prompt too short
    const line2Budget = termWidth - prefixWidth - turnWidth;
    const line2Right = progressiveJoin(line2Segments, line2Budget);
    const spaceForRight2 = line2Right.width > 0 ? line2Right.width + 2 : 0;
    const maxPromptCols = Math.min(line2Budget - spaceForRight2, 80);
    const promptText = bold(truncate(state.lastUserPrompt, Math.max(maxPromptCols, MIN_PROMPT_COLS)));
    const promptWidth = visibleWidth(promptText);
    const gap2 = Math.max(1, termWidth - prefixWidth - turnWidth - promptWidth - line2Right.width);
    const prefix2 = ' \u258D ';
    const line2 = prefix2 + turnLabel + promptText + ' '.repeat(gap2) + line2Right.text;
    return line1 + '\n' + line2;
}
