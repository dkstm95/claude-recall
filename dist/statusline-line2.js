import { progressiveJoin } from './statusline-layout.js';
import { makeRightSegment, makeSegment } from './statusline-segments.js';
import { truncate } from './terminal-text.js';
export const PROMPT_PLACEHOLDER = '(awaiting first prompt)';
const MIN_PROMPT_COLS = 30;
function renderPromptSegment(ctx, maxPromptCols) {
    if (!ctx.cfg.line2.includes('prompt')) {
        return { text: '', width: 0 };
    }
    if (ctx.state.lastUserPrompt) {
        return makeSegment(ctx.tc.prompt(truncate(ctx.state.lastUserPrompt, Math.max(maxPromptCols, MIN_PROMPT_COLS))));
    }
    return makeSegment(ctx.tc.dim(PROMPT_PLACEHOLDER));
}
export function renderLine2(ctx) {
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
