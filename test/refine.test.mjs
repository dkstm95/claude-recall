import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readTranscriptTail,
  classifyError,
  shouldRefine,
} from '../dist/refine.js';

const TAIL_BYTES = 12_000;

// Awaits fn's promise before cleaning up the tmpdir — otherwise rmSync races
// readTranscriptTail's fd.open and the test flakes.
async function withTmpFile(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-recall-test-'));
  const path = join(dir, 'transcript.jsonl');
  try {
    writeFileSync(path, contents);
    return await fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await test('readTranscriptTail: file smaller than tail returns entire content', async () => {
  const content = 'line1\nline2\nline3\n';
  const text = await withTmpFile(content, (p) => readTranscriptTail(p));
  assert.equal(text, content);
});

await test('readTranscriptTail: empty file returns empty string', async () => {
  const text = await withTmpFile('', (p) => readTranscriptTail(p));
  assert.equal(text, '');
});

await test('readTranscriptTail: file larger than tail drops first (possibly-partial) line', async () => {
  // 15KB file — tail reads last 12KB, which starts inside a long line.
  const longLine = 'x'.repeat(15_000);
  const content = longLine + '\n' + 'final line\n';
  const text = await withTmpFile(content, (p) => readTranscriptTail(p));
  assert.equal(text, 'final line\n');
});

await test('readTranscriptTail: UTF-8 multibyte boundary is cleaned by first-newline drop', async () => {
  // '가' is 3 bytes in UTF-8, so positioning a long Korean block across the
  // 12KB tail offset forces a mid-multibyte read. The "drop first line" step
  // must purge the resulting U+FFFD debris before Haiku sees the transcript.
  const chunk1 = 'A'.repeat(2500) + '\n';
  const chunk2 = '가'.repeat(4500);
  const chunk3 = '\nfinal\n';
  const content = chunk1 + chunk2 + chunk3;
  assert.equal(Buffer.byteLength(content, 'utf-8'), 16008, 'precondition: byte size');

  const text = await withTmpFile(content, (p) => readTranscriptTail(p));

  assert.ok(!text.includes('\uFFFD'), `contains U+FFFD mojibake: "${text.slice(0, 50)}"`);
  assert.equal(text, 'final\n');
});

await test('readTranscriptTail: no newline in tail, start > 0 — behavior is pass-through', async () => {
  // Locks in current behavior: without a newline to anchor the drop, the tail
  // is returned as-is. If JSONL ever ships single-line >12KB entries, this
  // test will fail and prompt a re-think of the boundary strategy.
  const content = 'y'.repeat(15_000);
  const text = await withTmpFile(content, (p) => readTranscriptTail(p));
  assert.equal(text.length, TAIL_BYTES);
  assert.ok(text.startsWith('y'));
});

test('classifyError: rate-limit patterns', () => {
  assert.equal(classifyError(1, 'API rate limit exceeded'), 'rate_limit');
  assert.equal(classifyError(1, 'HTTP 429 Too Many Requests'), 'rate_limit');
  assert.equal(classifyError(1, 'rate-limit hit'), 'rate_limit');
});

test('classifyError: auth patterns', () => {
  assert.equal(classifyError(1, 'Unauthorized (401)'), 'auth');
  assert.equal(classifyError(1, 'HTTP 403 Forbidden'), 'auth');
  assert.equal(classifyError(1, 'credentials invalid'), 'auth');
  assert.equal(classifyError(1, 'unauthorised'), 'auth');
});

test('classifyError: falls back to unknown', () => {
  assert.equal(classifyError(1, ''), 'unknown');
  assert.equal(classifyError(1, 'random error message'), 'unknown');
});

test('shouldRefine: recent refinement within 5s window is debounced', () => {
  const justNow = new Date(Date.now() - 1000).toISOString();
  assert.equal(shouldRefine(justNow), false);
});

test('shouldRefine: past the 5s window allows refresh', () => {
  const sixSecondsAgo = new Date(Date.now() - 6000).toISOString();
  assert.equal(shouldRefine(sixSecondsAgo), true);
});
