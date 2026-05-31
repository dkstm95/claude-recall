import { displayWidth } from './terminal-text.js';
const DEFAULT_JOINER = { text: '  ', width: 2 };
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
