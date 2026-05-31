// CJK / fullwidth ranges occupy 2 terminal columns.
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
export function visibleWidth(s) {
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
