# claude-recall

Session awareness HUD for Claude Code. Restores context in under 5 seconds when switching between parallel Claude Code sessions — tracks purpose, last prompt, branch, and activity for every session.

<p align="center">
  <img src="assets/statusline-preview.svg" alt="claude-recall statusline preview" width="720">
</p>

## Install

```bash
# 1. Add marketplace
/plugin marketplace add dkstm95/claude-recall

# 2. Install plugin
/plugin install claude-recall@claude-recall

# 3. Configure statusline
/setup
```

After `/setup`, **restart Claude Code** for the statusline to take effect.

## What You Get

Once installed, everything works automatically:

- **Hooks** fire on `SessionStart`, `UserPromptSubmit`, and `SessionEnd` to track session state
- **Statusline** renders a 2-line HUD combining session tracking with built-in metrics (model, context%, cost)
- `/purpose <text>` — manually set the session purpose
- `claude-recall list` — show all tracked sessions in a table (run in terminal)

### HUD Example

```
 ⎯ Refactor auth middleware       feat/jwt  23m  │  Opus  42%  $0.37
 › Add rate limiting to the login endpoint
```

Line 1: purpose, branch, elapsed time, model, context usage, cost
Line 2: last user prompt

### Session List

```
 PURPOSE                          BRANCH        #  STATUS     ELAPSED
 Refactor auth middleware         feat/jwt      7  active     1h 23m
 Fix login bug                    main          3  completed  2d 5h
```

## How It Works

```
Hooks (SessionStart / UserPromptSubmit / SessionEnd)
  → node dist/hooks/*.js
  → atomic write to ~/.claude/claude-recall/sessions/{session-id}.json

Statusline (<100ms)
  → node dist/statusline.js
  → reads state file + built-in JSON (model, cost, context%)
  → stdout: 2-line HUD

CLI
  → node dist/cli.js list
  → scans state files + PID liveness check
```

State files are stored at `~/.claude/claude-recall/sessions/` — separate from the plugin install path.

## Development

```bash
git clone https://github.com/dkstm95/claude-recall.git
cd claude-recall
npm install
npm run build
```

For local testing:

```bash
claude --plugin-dir /path/to/claude-recall
```
