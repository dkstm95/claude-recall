<h1 align="center">claude-recall</h1>

<p align="center">
  <em>A statusline for parallel Claude Code sessions — know what each one is for at a glance.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-6.1.4-blue?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="node">
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-blueviolet?style=flat-square" alt="Claude Code Plugin">
</p>

<p align="center">
  <a href="README.ko.md">한국어</a>
</p>

---

When you run Claude Code in multiple terminals at once, switching tabs always brings the same moment — **"What was I doing here?"**

claude-recall answers two questions for every session, at a glance:

1. **What is this session for?** — an AI-refined focus label, auto-managed in the background
2. **How far along is it?** — turn count, elapsed time, context usage, git status, and rate-limit bars

<p align="center">
  <img src="assets/statusline-preview.svg" alt="claude-recall statusline across multiple terminal tabs" width="720">
</p>

<details>
<summary><strong>See it in a split-pane layout</strong></summary>

<p align="center">
  <img src="assets/split-panes-preview.svg" alt="claude-recall statusline in four tmux split panes" width="800">
</p>

</details>

## Why claude-recall?

- **Autonomous focus** — No commands to run. A Haiku subprocess refines each session's focus in the background, in the transcript's language.
- **Per-session accent color** — Deterministic color bar from project dir + branch. Spot which tab is which by color, before reading any text.
- **`/handoff` emergency exit** — When context is about to run out, writes a structured Markdown summary to disk that survives session termination. Seed a fresh session with `@<path>` to continue.

Plus: rich git status (dirty + ahead/behind vs `origin/<default>`), rate-limit bars (5h / 7d), Claude Code's context / cost / model — all in up to three lines.

## Install

> [!IMPORTANT]
> **Background LLM calls.** claude-recall automatically refines each session's focus by calling Claude Haiku in the background (roughly $0.01 per long session). This is the core of the plugin — there is no opt-out toggle. If you prefer zero background LLM calls, **do not install this plugin**.

```bash
# 1. Add marketplace
/plugin marketplace add dkstm95/claude-recall

# 2. Install plugin
/plugin install claude-recall@claude-recall

# 3. Configure statusline
/setup
```

> [!IMPORTANT]
> **Restart Claude Code** after `/setup` to activate the statusline and new hooks.

## Usage

Everything works automatically after install. There are no focus-management commands.

| Command | Description |
|---------|-------------|
| `/handoff` | Write a handoff summary to `~/.claude/claude-recall/handoffs/`; reference it in a fresh session via `@<path>` |
| `/setup` | Reconfigure statusline / verify installation |

## Customization

Create `~/.claude/claude-recall/config.json`:

```json
{
  "line1": ["focus", "branch", "model"],
  "line2": ["turn", "prompt", "elapsed"],
  "line3": ["context", "rate_limits", "seven_day", "cost"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true
  },
  "theme": "default"
}
```

- **line1** — Choose from: `focus`, `branch`, `model`, `worktree`
- **line2** — Choose from: `turn`, `prompt`, `elapsed`
- **line3** — Choose from: `context`, `rate_limits`, `seven_day`, `cost`. Set `line3: []` to force a 2-line statusline.
- **gitStatus** — Toggle dirty flag and ahead/behind independently.
- **theme** — `default` (cyan/bold, dark terminals), `light` (blue/dark-orange, white terminals), `minimal` (subdued, monochrome — severity via reverse-video), `vivid` (bright/high contrast)
  - When `theme` is omitted and the terminal exports `COLORFGBG`, claude-recall auto-selects `light` for light backgrounds (`bg=7` or `bg=15`) and `default` otherwise. An explicit `theme` value always wins.
  - Setting the `NO_COLOR` environment variable (any value, per [no-color.org](https://no-color.org)) suppresses all ANSI color output regardless of theme.

Legacy configs with `"line1": ["purpose", ...]` are transparently mapped to `"focus"`.

## Statusline reference

<details>
<summary><strong>What each element means (full table)</strong></summary>

| Element | Location | Description | Source |
|---------|----------|-------------|--------|
| **accent bar** | all lines, left | Session-specific color bar (`▍`) — deterministic color from project dir + branch | claude-recall |
| **focus** | Line 1, left | AI-refined summary of what this session is currently working on — managed autonomously | claude-recall |
| **branch + status** | Line 1, right | `branch*↑N↓N` — dirty flag + commits ahead/behind `origin/<default>` | claude-recall |
| **model** | Line 1, right | Active Claude model (e.g. Opus) | Claude Code built-in |
| **turn** | Line 2, left | Current prompt number (`#12`) | claude-recall |
| **last prompt** | Line 2, left | The last prompt you typed (now with ~3× more visible width vs v5) | claude-recall |
| **elapsed** | Line 2, right | Time since session start / last activity | claude-recall |
| **ctx bar** | Line 3 | Context window usage — `ctx ████░░░░░░ 45%` — green (<70%), yellow (70-89%), red (≥90%) | Claude Code built-in |
| **5h rate limit bar** | Line 3 | 5-hour usage + reset time — `5h ████░░░░░░ 45% (~16:59)` | Claude Code built-in |
| **7d rate limit bar** | Line 3 | 7-day usage + reset date/time — `7d ██░░░░░░░░ 20% (~4/25 13:59)` | Claude Code built-in |
| **cost** | Line 3, right | Cumulative session cost | Claude Code built-in |
| **context warning** | Line 1, right | Dim `(try /handoff)` at 70-89%, red `⚠ try /handoff` at ≥90% — guaranteed visible even when Line 3 is off | claude-recall |
| **worktree** *(opt-in)* | Line 1, right | `⎇ <name>` when inside a linked git worktree | Claude Code built-in |
| **refinement error** | Line 1, left | Red `⚠ AI <reason>` label replaces focus when a background refinement fails | claude-recall |

Notes:
- Line 3 renders when any of `ctx` / `rate_limits` / `seven_day` / `cost` has data. API-key-only users with no rate-limits still get the `ctx` bar once the context window starts filling; the line is hidden only until there's something to show.
- **First-entry cache.** On session entry, Claude Code hasn't made an API call yet, so stdin has no `rate_limits`. claude-recall persists the last-seen values to `~/.claude/claude-recall/rate-limits.json` and renders from that cache on first render, so you see the 5h / 7d bars the moment `claude` starts. Windows whose `resets_at` has passed are dropped from the cache (they'd overstate usage in the new window).
- On narrow terminals, Line 3 drops `cost` first, then `7d`, then `5h`, keeping `ctx` visible the longest — context exhaustion is the most urgent signal.
- At **70-89%** context, Line 1 shows a dim `(try /handoff)` hint. At **≥90%**, it becomes red `⚠ try /handoff`. The warning lives on Line 1 so it stays visible even when users opt out of Line 3 entirely (`line3: []`).
- Ahead/behind counts reflect your last `git fetch`. Run `git fetch` periodically to keep the `↓N` indicator honest.

</details>

<details>
<summary><strong>How focus refinement works</strong></summary>

Triggers (OR):
- **Power-of-2 turns** — 1, 2, 4, 8, 16, 32, 64, ... Rapid initial convergence, sparse drift checks later.
- **PreCompact** — right before Claude Code compacts context, capture the current state.
- **SessionEnd** — final snapshot for handoff continuity.

Each trigger spawns `claude -p --model=haiku` as a subprocess with the last 20KB of the transcript. The subprocess:
- Disables tools (`--tools ""`), disables slash commands, disables session persistence
- Carries `CLAUDE_RECALL_REFINING=1` in env so claude-recall's own hooks skip in the child (no recursion)
- Emits only the focus text in the transcript's language
- Has a 30-second timeout and 5-second debounce

On failure, Line 1's focus is replaced by a red label (`⚠ AI timeout`, `⚠ AI rate limited`, `⚠ AI auth failed`, or `⚠ AI refinement failed`) until the next successful refinement clears it.

</details>

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
