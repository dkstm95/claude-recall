import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUserPrompt, readLatestUserPrompt, userPromptPreview } from '../dist/prompt-text.js';
import { readTranscriptTail } from '../dist/refine.js';

test('prompt filtering preserves ordinary XML, pasted content, and discussion of notification tags', () => {
  for (const text of ['<div>build this</div>', '<pasted_content id="1">fix this</pasted_content>',
    'Explain <task-notification>', '```xml\n<task-notification>example</task-notification>\n```']) {
    assert.equal(isUserPrompt(text), true, text);
  }
});

test('prompt preview keeps pasted text while removing Claude paste markers', () => {
  assert.equal(userPromptPreview('\n<pasted_content id="abc">\nFix the chart\n</pasted_content id="abc">'), 'Fix the chart');
  assert.equal(userPromptPreview('<div>example</div>'), '<div>example</div>');
});

test('legacy prompt recovery and refinement ignore generated user records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'recall-prompt-'));
  const path = join(dir, 'transcript.jsonl');
  const user = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra });
  try {
    writeFileSync(path, [user('Fix session isolation'), user('<task-notification>worker done</task-notification>'),
      user('generated instructions', { isMeta: true }), user('old summary', { isCompactSummary: true }),
      user([{ type: 'tool_result', content: 'tool output' }]), user('<command-name>/compact</command-name>'),
    ].map((r) => JSON.stringify(r)).join('\n') + '\n{incomplete');
    assert.equal(await readLatestUserPrompt(path), 'Fix session isolation');
    assert.equal(await readTranscriptTail(path), 'user: Fix session isolation');
    assert.equal(await readLatestUserPrompt(join(dir, 'missing')), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
