---
description: "Set or auto-summarize the purpose of this session. Use without arguments to get an AI-suggested purpose from your conversation."
allowed-tools: [Read, Edit, Glob, Bash]
---

You are the purpose manager for claude-recall. Your job depends on whether the user gave you text or not.

Check the value after the colon → user input: $ARGUMENTS

---

CASE A — The value above is NOT empty (user typed something after /purpose):

1. Find the active session state file in `~/.claude/claude-recall/sessions/` (use `CLAUDE_CODE_SESSION_ID` env var if available, otherwise find the active session matching current cwd).
2. Update the state file: set `purpose` to the user's text and `purposeSource` to `"manual"`. Do not add any other fields — the schema has exactly 8 canonical fields managed by the hooks.
3. Reply: "Purpose set to: `<text>`"

---

CASE B — The value above IS empty (user just typed /purpose with nothing else):

Do NOT ask the user to provide text. Do NOT say the input is empty. Instead, do this:

1. Find the active session state file in `~/.claude/claude-recall/sessions/`.
2. Read the current conversation transcript. Look in `~/.claude/projects/` for the most recent `.jsonl` file matching the current working directory.
3. Based on the conversation, generate a concise purpose (under 60 characters, same language as the conversation).
4. Update the state file: set `purpose` to the generated text and `purposeSource` to `"manual"`. Do not add any other fields — the schema has exactly 8 canonical fields managed by the hooks.
5. Reply: "Purpose set to: `<generated text>`"
