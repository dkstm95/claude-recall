import { displayWidth } from '../dist/format.js';

export const escapeXml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

// Read the actual truecolor SGR output. Unsupported codes fail the preview
// build instead of silently substituting a different display color.
export function lineSvg(line, y, foreground, cell = 7.2) {
  let column = 0, fill = foreground, weight = 'normal', out = '';
  for (const part of line.split(/(\x1b\[[0-9;]*m)/g)) {
    if (part.startsWith('\x1b[')) {
      const codes = part.slice(2, -1).split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) { fill = foreground; weight = 'normal'; }
        else if (code === 1) weight = 'bold';
        else if (code === 22) weight = 'normal';
        else if (code === 39) fill = foreground;
        else if (code === 38 && codes[i + 1] === 2) {
          const rgb = codes.slice(i + 2, i + 5);
          if (rgb.length !== 3 || rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
            throw new Error(`Invalid truecolor sequence: ${JSON.stringify(part)}`);
          }
          fill = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          i += 4;
        } else throw new Error(`Unsupported preview SGR: ${JSON.stringify(part)}`);
      }
    } else if (part) {
      out += `<text x="${16 + column * cell}" y="${y}" fill="${fill}" font-weight="${weight}" textLength="${displayWidth(part) * cell}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${escapeXml(part)}</text>`;
      column += displayWidth(part);
    }
  }
  return out;
}
