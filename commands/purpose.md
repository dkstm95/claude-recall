---
description: "Set or auto-summarize the purpose of this session"
argument-hint: "<purpose text>"
allowed-tools: [Read, Edit, Glob]
---

The user's input is: $ARGUMENTS

**IMPORTANT: If the input above is empty, do NOT ask the user to provide text. Instead, follow the "No arguments" flow below.**

## Step 1: Find the session state file

Look in `~/.claude/claude-recall/sessions/`:
- If `CLAUDE_CODE_SESSION_ID` env var exists, use `{session-id}.json` directly.
- Otherwise, scan all `.json` files and find the one matching the current working directory with `status: "active"` and the most recent `lastActivityAt`.

## Step 2a: If the user provided text

- Set `purpose` to the provided text.
- Set `purposeSource` to `"manual"`.
- Set `purposeSetAt` to the current ISO timestamp.
- Confirm: "Purpose set to: `<text>`"

## Step 2b: If no text was provided (empty input)

You MUST do all of the following:

1. Read the state file and show the current purpose (if any).
2. Read the conversation transcript to understand what has been discussed. Find the transcript at `~/.claude/projects/` — look for the most recent `.jsonl` file matching the current working directory.
3. From the conversation content, generate a concise purpose (under 60 characters, in the same language as the conversation) that captures the main goal of this session.
4. Present it to the user: "Suggested purpose: `<suggestion>`. Apply?"
5. If the user agrees, update the state file with `purposeSource: "manual"` and confirm.
6. If the user declines, do nothing.
