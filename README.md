<h1 align="center">claude-recall</h1>

<p align="center">
  <em>Instant context recovery for parallel Claude Code sessions</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.3.0-blue?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="node">
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-blueviolet?style=flat-square" alt="Claude Code Plugin">
</p>

<p align="center">
  <a href="README.ko.md">한국어</a>
</p>

---

When you're running Claude Code in multiple terminals at once, switching tabs always brings that moment — **"What was I doing here?"**

claude-recall automatically tracks the context of every Claude Code session, so you can refocus instantly when you switch.

<p align="center">
  <img src="assets/statusline-preview.svg" alt="claude-recall: multiple terminal tabs" width="720">
</p>

<p align="center">
  <img src="assets/split-panes-preview.svg" alt="claude-recall: split panes" width="800">
</p>

### What's in the HUD

A persistent 2-line summary above your prompt:

| Element | Location | Description | Source |
|---------|----------|-------------|--------|
| **purpose** | Line 1, left | What this session is about — auto-detected from first prompt, or set with `/purpose` | claude-recall |
| **branch** | Line 1, right | Current git branch | claude-recall |
| **elapsed** | Line 1, right | Time since last activity | claude-recall |
| **model** | Line 1, right | Active Claude model (e.g. Opus 4.6) | Claude Code built-in |
| **context%** | Line 1, right | Context window usage | Claude Code built-in |
| **cost** | Line 1, right | Cumulative session cost | Claude Code built-in |
| **turn** | Line 2, left | Current prompt number (`#12`) | claude-recall |
| **last prompt** | Line 2 | The last prompt you typed | claude-recall |

> [!TIP]
> After 5+ prompts, a `(try /purpose)` hint appears next to the purpose. Running `/purpose` lets Claude analyze your conversation and suggest a more accurate purpose.

## Features

- **Automatic tracking** — Just install. Session start, prompts, and session end are recorded automatically
- **Auto-purpose** — Detects session purpose from your first prompt
- **Smart purpose update** — Run `/purpose` anytime to get an AI-generated purpose summary from your conversation
- **Turn counter** — Shows which prompt you're on (`#1`, `#12`, `#50`)
- **Built-in metrics** — Shows model, context%, and cost from Claude Code alongside session info
- **Session overview** — `/list` shows all sessions in one table
- **Auto-cleanup** — Completed sessions older than 7 days are automatically removed

```
 PURPOSE                          BRANCH        #  STATUS     ELAPSED
 Refactor auth middleware         feat/jwt      7  active     1h 23m
 Fix payment API bug              fix/payment   3  active     45m
 Improve test coverage            main          2  completed  2d 5h
```

## Install

```bash
# 1. Add marketplace
/plugin marketplace add dkstm95/claude-recall

# 2. Install plugin
/plugin install claude-recall@claude-recall

# 3. Configure statusline
/setup
```

> [!IMPORTANT]
> **Restart Claude Code** after `/setup` to activate the statusline.

## Usage

Everything works automatically after install. Additional commands:

| Command | Description |
|---------|-------------|
| `/purpose <text>` | Manually set session purpose (overrides auto-detection) |
| `/purpose` | Auto-suggest purpose from conversation |
| `/list` | View all tracked sessions |
| `/setup` | Reconfigure statusline / verify installation |

## Uninstall

```bash
# 1. Remove plugin
/plugin uninstall claude-recall@claude-recall

# 2. Remove statusline from ~/.claude/settings.json
#    Delete the "statusLine" key, then restart Claude Code

# 3. (Optional) Remove session data
rm -rf ~/.claude/claude-recall/
```

<details>
<summary><strong>How it works</strong></summary>

**Every time you type a prompt:**
→ Session purpose, branch, turn count, and last prompt are saved automatically

**Every time Claude responds:**
→ Saved info + model/cost are combined into a 2-line HUD (under 100ms)

**When you run `/purpose`:**
→ Claude analyzes the conversation and suggests a concise purpose summary

**When you run `/list`:**
→ All session files are scanned to show which sessions are active, stale, or completed

**On session start:**
→ Completed sessions older than 7 days are automatically cleaned up

All state is stored as JSON files in `~/.claude/claude-recall/sessions/` — one file per session, separate from the plugin itself.

</details>

<details>
<summary><strong>Development</strong></summary>

```bash
git clone https://github.com/dkstm95/claude-recall.git
cd claude-recall
npm install
npm run build
```

Local testing:

```bash
claude --plugin-dir /path/to/claude-recall
```

</details>

## License

[MIT](LICENSE)
