import { open } from 'node:fs/promises';

// Smaller tail narrows Haiku's processing-time variance without losing enough
// recent context to hurt focus-label accuracy.
const TRANSCRIPT_TAIL_BYTES = 12_000;

export async function readTranscriptTail(path: string): Promise<string> {
  const fd = await open(path, 'r');
  try {
    const stats = await fd.stat();
    const start = Math.max(0, stats.size - TRANSCRIPT_TAIL_BYTES);
    const length = stats.size - start;
    if (length <= 0) return '';
    const buf = Buffer.alloc(length);
    await fd.read(buf, 0, length, start);
    const text = buf.toString('utf-8');
    // Drop a possibly-truncated first line only when we actually seeked past byte 0.
    const nl = text.indexOf('\n');
    return nl >= 0 && start > 0 ? text.slice(nl + 1) : text;
  } finally {
    await fd.close();
  }
}

export async function resolveRefinementTranscript(
  transcriptPath: string | undefined,
  preferredTranscript: string | undefined,
  lastUserPrompt: string,
): Promise<string> {
  // Prefer the JSONL transcript tail; fall back to the persisted last user prompt
  // when the file is missing or empty (typical on the first prompt, where Claude
  // Code's transcript flush hasn't completed by the time UserPromptSubmit fires).
  let transcript = preferredTranscript?.trim() ? `Compaction summary:\n${preferredTranscript}` : '';
  if (!transcript && transcriptPath) {
    try {
      transcript = await readTranscriptTail(transcriptPath);
    } catch {
      /* fall through to fallback */
    }
  }
  if (!transcript.trim() && lastUserPrompt.trim()) {
    transcript = `User: ${lastUserPrompt}`;
  }
  return transcript;
}
