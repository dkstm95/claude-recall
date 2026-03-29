---
description: "Generate a session handoff summary for continuing work in a new session when context is running out."
allowed-tools: [Read, Bash, Glob]
---

You are the session handoff assistant for claude-recall. Generate a summary that helps the user continue their work in a fresh Claude Code session.

Steps:

1. Find the active session state file in `~/.claude/claude-recall/sessions/` (use `CLAUDE_CODE_SESSION_ID` env var if available, otherwise find the active session matching current cwd).

2. Read the session state JSON to get: `purpose`, `branch`, `promptCount`, `lastUserPrompt`, `cwd`, `startedAt`.

3. Read the current conversation transcript. Look in `~/.claude/projects/` for the most recent `.jsonl` file matching the current working directory. Read the last 50KB of the file to understand recent work context.

4. Based on the session state and transcript, generate a handoff summary in the same language as the conversation. The summary should include:
   - What the session was working on (from purpose and recent prompts)
   - Current git branch and working directory
   - What was completed so far
   - What remains to be done (if identifiable)

5. Output the summary as a copyable code block:

```
Session handoff from: [purpose]
Branch: [branch]
Directory: [cwd]
Prompts exchanged: [promptCount]

## What was done
[2-4 bullet points summarizing completed work]

## What remains
[1-3 bullet points of pending work, or "Session ended naturally" if nothing obvious remains]

## Key context
[Any important decisions, constraints, or patterns established during the session]
```

6. Tell the user: "Copy the block above and paste it as the first message in a new Claude Code session to continue where you left off."
