---
description: "Export the current session's metadata and history as a Markdown file."
allowed-tools: [Read, Write, Bash, Glob]
---

You are the session export assistant for claude-recall. Export session metadata as a Markdown file.

Steps:

1. Find the active session state file in `~/.claude/claude-recall/sessions/` (use `CLAUDE_CODE_SESSION_ID` env var if available, otherwise find the active session matching current cwd).

2. Read the session state JSON.

3. Format the session data as Markdown:

```markdown
# Session: [purpose or "(no purpose)"]

| Field | Value |
|-------|-------|
| Session ID | [sessionId] |
| Branch | [branch] |
| Directory | [cwd] |
| Started | [startedAt] |
| Prompts | [promptCount] |
| Status | [status] |
| Purpose Source | [purposeSource] |
| Model | [model] |

## Last Prompt

> [lastUserPrompt]
```

4. Generate a filename using the current date and purpose: `session-export-YYYY-MM-DD-[slug].md` where `[slug]` is a sanitized version of the purpose (lowercase, spaces to hyphens, max 30 chars). If no purpose, use the session ID instead.

5. Write the file to the current working directory.

6. Tell the user the full path of the exported file.
