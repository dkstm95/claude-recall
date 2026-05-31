import { padSegmentLeft, type Segment } from './statusline-layout.js';
import { visibleWidth } from './terminal-text.js';

// Uniform min cell width for right-zone segments (worktree, branch, model, elapsed).
// Left-padding to this width keeps `│` separators and rightmost content edges on
// stable columns across renders. Content wider than the min simply overflows —
// the grid is a soft alignment guide, not a hard constraint.
const CELL_MIN_WIDTH = 10;

export function makeSegment(text: string): Segment {
  return { text, width: visibleWidth(text) };
}

export function makeRightSegment(text: string, gridOn: boolean): Segment {
  const seg = makeSegment(text);
  return gridOn ? padSegmentLeft(seg, CELL_MIN_WIDTH) : seg;
}
