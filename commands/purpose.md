---
description: "Set the purpose/description for this session"
argument-hint: "<purpose text>"
allowed-tools: [Read, Edit, Glob]
---

You are helping the user set a manual purpose for their current Claude Code session.

The user's desired purpose text is: $ARGUMENTS

Follow these steps:

1. Find the current session's state file in `~/.claude/claude-recall/sessions/`:
   - If the `CLAUDE_CODE_SESSION_ID` environment variable is available, use it to locate `{session-id}.json` directly.
   - Otherwise, scan all state files and find the one matching the current working directory with `status: "active"` and the most recent `lastActivityAt`.

2. Update the state file:
   - Set `purpose` to the user's input text.
   - Set `purposeSource` to `"manual"`.
   - Set `purposeSetAt` to the current ISO timestamp.

3. Confirm the update to the user, showing the new purpose.
