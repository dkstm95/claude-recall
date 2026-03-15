# claude-recall

[한국어](README.ko.md)

When you're running Claude Code in multiple terminals at once, switching tabs always brings that moment — **"What was I doing here?"**

claude-recall automatically tracks the context of every Claude Code session, so you can refocus instantly when you switch.

<p align="center">
  <img src="assets/statusline-preview.svg" alt="claude-recall statusline preview" width="720">
</p>

Works great with split panes too:

<p align="center">
  <img src="assets/split-panes-preview.svg" alt="claude-recall in split panes" width="800">
</p>

A persistent 2-line HUD above your prompt:

| Element | Description | Source |
|---------|-------------|--------|
| **purpose** | What this session is about — auto-detected from your first prompt, or set manually with `/purpose` | claude-recall |
| **branch** | Current git branch | claude-recall |
| **elapsed** | Time since last activity | claude-recall |
| **model** | Active Claude model (e.g. Opus 4.6) | Claude Code built-in |
| **context%** | Context window usage | Claude Code built-in |
| **cost** | Cumulative session cost | Claude Code built-in |
| **last prompt** | The last prompt you typed (line 2) | claude-recall |

## Features

- **Automatic tracking** — Just install. Session start, prompts, and session end are recorded automatically
- **Auto-purpose** — Detects session purpose from your first prompt
- **Built-in metrics** — Shows model, context%, and cost from Claude Code alongside session info
- **Session overview** — `/list` shows all sessions in one table

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

**Restart Claude Code** after setup to activate the statusline.

## Usage

Everything works automatically after install. Additional commands:

| Command | Description |
|---------|-------------|
| `/purpose <text>` | Manually set session purpose (overrides auto-detection) |
| `/list` | View all tracked sessions |
| `/setup` | Reconfigure statusline / verify installation |

<details>
<summary><strong>How it works</strong></summary>

**Every time you type a prompt:**
→ Session purpose, branch, and last prompt are saved automatically

**Every time Claude responds:**
→ Saved info + model/cost are combined into a 2-line HUD (under 100ms)

**When you run `/list`:**
→ All session files are scanned to show which sessions are active, stale, or completed

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
