---
description: "Set the purpose/description for this session"
argument-hint: "<purpose text>"
allowed-tools: [Read, Edit, Glob]
---

You are helping the user manage the purpose of their current Claude Code session.

The user's input is: $ARGUMENTS

Follow these steps:

1. Find the current session's state file in `~/.claude/claude-recall/sessions/`:
   - If the `CLAUDE_CODE_SESSION_ID` environment variable is available, use it to locate `{session-id}.json` directly.
   - Otherwise, scan all state files and find the one matching the current working directory with `status: "active"` and the most recent `lastActivityAt`.

2. If the user provided no text (empty input):
   - Read the current state file and show the current purpose.
   - If no purpose is set, tell the user: "No purpose set. Use `/purpose <text>` to set one."
   - Do NOT modify the state file.

3. If the user provided text:
   - Set `purpose` to the user's input text.
   - Set `purposeSource` to `"manual"`.
   - Set `purposeSetAt` to the current ISO timestamp.
   - Confirm the update to the user, showing the new purpose.
