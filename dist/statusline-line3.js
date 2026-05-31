import { progressiveJoin } from './statusline-layout.js';
import { visibleWidth } from './terminal-text.js';
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
export function renderLine3(l3, builtin, ctxPct, tc, budget, joiner) {
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
