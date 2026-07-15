const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const OSC = /(?:\x1b\]|\x9d)[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ST_TERMINATED = /\x1b[P^_X][\s\S]*?\x1b\\/g;
const CSI = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
const ESCAPE = /\x1b[ -/]*[@-~]/g;
const C0_C1 = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const ZERO_WIDTH = /[\p{Mark}\p{Cf}]/u;

export function stripTerminalSequences(text: string): string {
  return text
    .replace(OSC, '')
    .replace(ST_TERMINATED, '')
    .replace(CSI, '')
    .replace(ESCAPE, '')
    .replace(C0_C1, '')
    .replace(BIDI_CONTROLS, '');
}

export function sanitizeTerminalText(text: string): string {
  return stripTerminalSequences(text.replace(/[\n\t\r]/g, ' '));
}

export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
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
    (code >= 0x30000 && code <= 0x3fffd)
  );
}

export function graphemeWidth(grapheme: string): number {
  if (
    EMOJI_PRESENTATION.test(grapheme)
    || grapheme.includes('\ufe0f')
    || grapheme.includes('\u20e3')
    || (grapheme.includes('\u200d') && EXTENDED_PICTOGRAPHIC.test(grapheme))
  ) return 2;

  let width = 0;
  for (const char of grapheme) {
    if (ZERO_WIDTH.test(char)) continue;
    width = Math.max(width, isWide(char.codePointAt(0)!) ? 2 : 1);
  }
  return width;
}

export function terminalTextWidth(text: string): number {
  let width = 0;
  for (const grapheme of graphemeSegmenter.segment(text)) {
    width += graphemeWidth(grapheme.segment);
  }
  return width;
}
