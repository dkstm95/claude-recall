import type { ThemeColors } from './config.js';
import { displayWidth } from './terminal-text.js';

export interface Segment {
  text: string;
  width: number;
}

export interface Joiner {
  text: string;
  width: number;
}

const DEFAULT_JOINER: Joiner = { text: '  ', width: 2 };

export function makeJoiner(separator: string, tc: ThemeColors): Joiner {
  if (!separator) return DEFAULT_JOINER;
  return { text: ` ${tc.dim(separator)} `, width: 1 + displayWidth(separator) + 1 };
}

export function padSegmentLeft(seg: Segment, minWidth: number): Segment {
  if (seg.width >= minWidth) return seg;
  return { text: ' '.repeat(minWidth - seg.width) + seg.text, width: minWidth };
}

export function progressiveJoin(
  segments: Segment[],
  budget: number,
  minLeft: number,
  joiner: Joiner = DEFAULT_JOINER,
): { text: string; width: number } {
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
