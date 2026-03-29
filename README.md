<h1 align="center">claude-recall</h1>

<p align="center">
  <em>Instant context recovery for parallel Claude Code sessions</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.3.0-blue?style=flat-square" alt="version">
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

## What's in the HUD

A persistent 2-line summary above your prompt:

| Element | Location | Description | Source |
|---------|----------|-------------|--------|
| **accent bar** | Line 1-2, left | Session-specific color bar (`▍`) — deterministic color from project dir + branch | claude-recall |
| **purpose** | Line 1, left | What this session is about — auto-detected from first prompt, or set with `/purpose` | claude-recall |
| **branch** | Line 1, right | Current git branch | claude-recall |
| **model** | Line 1, right | Active Claude model (e.g. Opus) | Claude Code built-in |
| **turn** | Line 2, left | Current prompt number (`#12`) | claude-recall |
| **last prompt** | Line 2, left | The last prompt you typed | claude-recall |
| **elapsed** | Line 2, right | Time since last activity | claude-recall |
| **context%** | Line 2, right | Context window usage — color-coded: green (<70%), yellow (70-89%), red (≥90%) | Claude Code built-in |
| **cost** | Line 2, right | Cumulative session cost (hidden when context ≥ 90%) | Claude Code built-in |

> [!TIP]
> After 5+ prompts, a `(try /purpose)` hint appears next to the purpose. Running `/purpose` lets Claude analyze your conversation and suggest a more accurate purpose.

> [!WARNING]
> When context usage reaches **90%+**, the cost display is replaced by a red `⚠ try /continue` warning. Run `/continue` to generate a handoff summary you can paste into a new session.

## Features

- **Automatic tracking** — Just install. Session start, prompts, and session end are recorded automatically
- **Auto-purpose** — Detects session purpose from your first prompt
- **Smart purpose update** — Run `/purpose` anytime to get an AI-generated purpose summary from your conversation
- **Session accent colors** — Each session gets a unique accent color based on its project directory + branch, so you can identify sessions at a glance before reading any text
- **Context crisis warning** — When context usage hits 90%+, the HUD warns you with `⚠ try /continue`
- **Session handoff** — `/continue` generates a summary you can paste into a new session to pick up where you left off
- **Turn counter** — Shows which prompt you're on (`#1`, `#12`, `#50`)
- **Built-in metrics** — Shows model, context%, and cost from Claude Code alongside session info
- **Customizable HUD** — Configure which elements appear via `~/.claude/claude-recall/config.json`
- **Color themes** — Choose from `default`, `minimal`, or `vivid` theme presets
- **Session overview** — `/list` shows all sessions in one table
- **Session export** — `/export` saves session metadata as Markdown
- **Auto-cleanup** — Completed sessions older than 7 days are automatically removed

Use `/list` to see all sessions at once:

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
| `/continue` | Generate a session handoff summary for a new session |
| `/export` | Export session metadata as Markdown |
| `/list` | View all tracked sessions |
| `/setup` | Reconfigure statusline / verify installation |

## Customization

Create `~/.claude/claude-recall/config.json` to customize the HUD:

```json
{
  "line1": ["purpose", "branch", "model"],
  "line2": ["turn", "prompt", "elapsed", "context", "cost"],
  "theme": "default"
}
```

- **line1** — Choose from: `purpose`, `branch`, `model`
- **line2** — Choose from: `turn`, `prompt`, `elapsed`, `context`, `cost`
- **theme** — `default` (cyan/bold), `minimal` (subdued, no color), `vivid` (bright/high contrast)

Remove any element from the arrays to hide it. No restart required — changes apply on the next statusline render.

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

**When you run `/continue`:**
→ Claude summarizes the session and generates a handoff block you can paste into a new session

**When you run `/export`:**
→ Session metadata is saved as a Markdown file in the current directory

**When you run `/list`:**
→ All session files are scanned to show which sessions are active, stale, or completed

**Session accent colors:**
→ Each session gets a unique color bar (`▍`) based on your project directory + branch, so you can identify sessions by color before reading any text

**On session start:**
→ Completed sessions older than 7 days are automatically cleaned up

All state is stored as JSON files in `~/.claude/claude-recall/sessions/` — one file per session, separate from the plugin itself. HUD layout and themes are configurable via `~/.claude/claude-recall/config.json`.

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
