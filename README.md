<h1 align="center">claude-recall</h1>

<p align="center">
  <em>Instant context recovery for parallel Claude Code sessions</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue?style=flat-square" alt="version">
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

| Element | Description | Source |
|---------|-------------|--------|
| **purpose** | What this session is about — updates with each prompt, or set manually with `/purpose` | claude-recall |
| **branch** | Current git branch | claude-recall |
| **elapsed** | Time since last activity | claude-recall |
| **model** | Active Claude model (e.g. Opus 4.6) | Claude Code built-in |
| **context%** | Context window usage | Claude Code built-in |
| **cost** | Cumulative session cost | Claude Code built-in |
| **last prompt** | The last prompt you typed (line 2) | claude-recall |
| **last action** | What Claude last did — e.g. `Edit: src/auth.ts` (line 2, right side) | claude-recall |

## Features

- **Automatic tracking** — Just install. Session start, prompts, and session end are recorded automatically
- **Dynamic purpose** — Purpose evolves with each prompt to reflect your current focus
- **Action tracking** — Shows Claude's last action (file edits, commands) alongside your last prompt
- **Context divergence warning** — Alerts you when a prompt seems unrelated, recommending a new session
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
→ Session purpose, branch, and last prompt are saved automatically
→ If the prompt seems unrelated to the session, you'll get a warning

**Every time Claude uses a tool (Write, Edit, Bash):**
→ The action is recorded and shown on the statusline

**Every time Claude responds:**
→ Saved info + model/cost are combined into a 2-line HUD (under 100ms)

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
