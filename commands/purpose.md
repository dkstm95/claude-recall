---
description: "Set or auto-summarize the purpose of this session"
argument-hint: "<purpose text>"
allowed-tools: [Read, Edit, Glob]
---

You are helping the user manage the purpose of their current Claude Code session.

The user's input is: $ARGUMENTS

Follow these steps:

1. Find the current session's state file in `~/.claude/claude-recall/sessions/`:
   - If the `CLAUDE_CODE_SESSION_ID` environment variable is available, use it to locate `{session-id}.json` directly.
   - Otherwise, scan all state files and find the one matching the current working directory with `status: "active"` and the most recent `lastActivityAt`.

2. If the user provided text:
   - Set `purpose` to the user's input text.
   - Set `purposeSource` to `"manual"`.
   - Set `purposeSetAt` to the current ISO timestamp.
   - Confirm the update to the user, showing the new purpose.

3. If the user provided no text (empty input):
   - Show the current purpose from the state file.
   - Then read the conversation transcript to understand what has been discussed so far. The transcript path can be found at `~/.claude/projects/` — look for the most recent `.jsonl` file matching the current working directory.
   - Based on the conversation, suggest a concise purpose (under 60 characters) that captures the main goal of this session.
   - Ask the user: "Suggested purpose: `<your suggestion>`. Apply this? (yes/no)"
   - If the user agrees, update the state file with `purposeSource: "manual"`.
   - If the user declines, do nothing.
