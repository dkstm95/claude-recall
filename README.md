<h1 align="center">claude-recall</h1>

<p align="center">
  <em>A statusline for parallel Claude Code sessions — know what each one is for at a glance.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-6.4.3-blue?style=flat-square" alt="version">
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
- **Directory+branch accent color** — Deterministic color bar keyed by the current `cwd + branch`. Spot which tab is which by color, before reading any text. The color shifts when you change branches or move the session with Claude Code's `/cd`.
- **Current Claude metadata** — The model slot can show the concrete model version, effort level, and thinking state; optional slots can also show session name, agent, PR, and worktree.

Plus: rich git status (dirty + ahead/behind vs `origin/<default>`), rate-limit bars (5h / 7d), Claude Code's context / cost / model metadata — all in up to three lines.

## Install

> [!IMPORTANT]
> **Background LLM calls.** claude-recall automatically refines each session's focus by calling Claude Haiku in the background (roughly $0.01 per long session). This is the core of the plugin — there is no opt-out toggle. If you prefer zero background LLM calls, **do not install this plugin**.

```bash
# 1. Add marketplace
/plugin marketplace add dkstm95/claude-recall

# 2. Install plugin
/plugin install claude-recall@claude-recall

# 3. Reload installed plugin commands
/reload-plugins

# 4. Configure statusline
/claude-recall:setup
```

> [!IMPORTANT]
> **Restart Claude Code** after `/claude-recall:setup` to activate the statusline and new hooks.

> [!TIP]
> Setup never searches PATH automatically. The official native launcher (`~/.local/bin/claude`, or `%USERPROFILE%\.local\bin\claude.exe` on Windows) is detected directly. For Homebrew or another package manager, confirm its stable absolute launcher and pass it explicitly, for example `/claude-recall:setup /opt/homebrew/bin/claude`.

> [!NOTE]
> **Upgrading from 6.4.2 or earlier:** run `/reload-plugins`, then `/claude-recall:setup`, and restart Claude Code once. Setup now pins a verified, stable absolute Claude Code launcher in the private recall directory; background refinement intentionally has no runtime PATH fallback. The update also moves installed runtime files into a lightweight plugin-only bundle. Ordinary updates after this migration do not require setup again unless a release explicitly says otherwise.

## Usage

Everything works automatically after install. There are no focus-management commands.

| Command | Description |
|---------|-------------|
| `/claude-recall:setup` | Reconfigure statusline / verify installation |

For context management, use Claude Code's native commands: `/compact` (manual compaction for long-running tasks), `/clear` (switch to unrelated task), `/resume` (pick up a prior session).

## Customization

Create `~/.claude/claude-recall/config.json`. If `CLAUDE_CONFIG_DIR` is set, replace `~/.claude` with that directory:

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
  "theme": "default",
  "separator": "│"
}
```

- **line1** — Choose from: `focus`, `branch`, `model`, `worktree`, `session`, `agent`, `pr`. Right-side priority follows this order; lower-priority entries drop first as width shrinks.
- **line2** — Choose from: `turn`, `prompt`, `elapsed`
- **line3** — Choose from: `context`, `rate_limits`, `seven_day`, `cost`. Set `line3: []` to force a 2-line statusline.
- **gitStatus** — Toggle dirty flag and ahead/behind independently.
- **separator** *(v6.3.0+)* — Character drawn between right-zone segments on Line 1 and between all segments on Line 3. Default `"│"` (U+2502, dim). Right-zone segments also left-pad to a 10-col cell, so `│` positions stay stable across renders. Set to `""` to disable both the separator and the padding (flat 2-space joiner, pre-v6.3.0 look). Any single printable grapheme works — `"┊"` dotted, `"|"` ASCII, etc.
- **theme** — `default` (cyan/bold, dark terminals), `light` (blue/dark-orange, white terminals), `minimal` (subdued, monochrome — severity via reverse-video), `vivid` (bright/high contrast)
  - When `theme` is omitted and the terminal exports `COLORFGBG`, claude-recall auto-selects `light` for light backgrounds (`bg=7` or `bg=15`) and `default` otherwise. An explicit `theme` value always wins.
  - Setting the `NO_COLOR` environment variable (any value, per [no-color.org](https://no-color.org)) suppresses all ANSI color output regardless of theme.

## Statusline reference

<details>
<summary><strong>What each element means (full table)</strong></summary>

| Element | Location | Description | Source |
|---------|----------|-------------|--------|
| **accent bar** | all lines, left | Deterministic color bar (`▍`) keyed by current `cwd + branch` — changes after branch changes or Claude Code `/cd` moves | claude-recall |
| **focus** | Line 1, left | AI-refined summary of what this session is currently working on — managed autonomously | claude-recall |
| **branch + status** | Line 1, right | `branch*↑N↓N` — dirty flag + commits ahead/behind `origin/<default>` | claude-recall |
| **model** | Line 1, right | Active Claude model, enriched with model version from `model.id`, effort level, and thinking state when present | Claude Code built-in |
| **turn** | Line 2, left | Current prompt number (`#12`) | claude-recall |
| **last prompt** | Line 2, left | The last prompt you typed | claude-recall |
| **elapsed** | Line 2, right | Wall-clock time since session start | claude-recall |
| **ctx bar** | Line 3 | Context window usage — `ctx ████░░░░░░ 45%` — green (<70%), yellow (70-89%), red (≥90%) | Claude Code built-in |
| **5h rate limit bar** | Line 3 | 5-hour usage + reset time — `5h ████░░░░░░ 45% (~16:59)` | Claude Code built-in |
| **7d rate limit bar** | Line 3 | 7-day usage + reset date/time — `7d ██░░░░░░░░ 20% (~4/25 13:59)` | Claude Code built-in |
| **cost** | Line 3, right | Cumulative session cost | Claude Code built-in |
| **worktree** *(opt-in)* | Line 1, right | `⎇ <name>` from Claude Code's `worktree.name` / `worktree.path` fields when inside a linked git worktree | Claude Code built-in |
| **session** *(opt-in)* | Line 1, right | Session display name from Claude Code's `session_name` field | Claude Code built-in |
| **agent** *(opt-in)* | Line 1, right | Active agent name from Claude Code's `agent.name` field | Claude Code built-in |
| **pr** *(opt-in)* | Line 1, right | Active PR number/title from Claude Code's `pr` field | Claude Code built-in |
| **refinement error** | Line 1, left | Red `⚠ AI <reason>` label replaces focus when a background refinement fails | claude-recall |

Notes:
- Line 3 renders when any of `ctx` / `rate_limits` / `seven_day` / `cost` has data. API-key-only users with no rate-limits still get the `ctx` bar once the context window starts filling; the line is hidden only until there's something to show.
- **`5h` / `7d` bars require Claude.ai Pro/Max.** Claude Code omits the `rate_limits` stdin field for Claude API key users, so the two rate-limit bars never populate on API-key setups (no error — just absent). The `ctx` and `$cost` segments still render normally.
- **First-entry cache.** Claude Code omits `rate_limits` and `context_window` from stdin until the first API call, so claude-recall caches the last-seen values under the Claude config directory (`~/.claude/claude-recall/` by default) and restores them on first render — the bars show up immediately instead of waiting for the first prompt. See CHANGELOG v6.1.4 / v6.1.5 for details.
- On narrow terminals, Line 3 drops `cost` first, then `7d`, then `5h`, keeping `ctx` visible the longest — context exhaustion is the most urgent signal.
- Line 1 no longer renders command-style context hints. Context pressure remains visible through the `ctx` bar on Line 3 when enabled.
- Ahead/behind counts reflect your last `git fetch`. Run `git fetch` periodically to keep the `↓N` indicator honest.

</details>

<details>
<summary><strong>How focus refinement works</strong></summary>

Triggers (OR):
- **Power-of-2 turns** — 1, 2, 4, 8, 16, 32, 64, ... Rapid initial convergence, sparse drift checks later.
- **PreCompact** — right before Claude Code compacts context, capture the current state.
- **PostCompact** — after compaction, use Claude Code's compact summary when available.
- **SessionEnd** — final snapshot before the session closes.

Each trigger claims one refinement lease and spawns the setup-pinned Claude Code launcher with `-p --model=haiku`, using the compact summary when available or otherwise the last 12KB of the transcript. The subprocess:
- Uses only the verified absolute Claude Code launcher pinned by `/claude-recall:setup`; it never resolves `claude` from runtime PATH
- Snapshots the pinned launcher's current real target, verifies that captured target with `--version`, and spawns the same realpath; valid symlink-based updates apply on the next call while broken or concurrently swapped retargets fail closed
- Receives bounded transcript content over stdin, never in process arguments
- Runs from the private recall directory and disables user/project/local setting sources, hooks, tools (`--tools ""`), slash commands, session persistence, and non-explicit MCP configuration
- Carries `CLAUDE_RECALL_REFINING=1` in env as an additional recursion guard
- Emits only the focus text in the transcript's language
- Has a 45-second timeout, 5-second debounce, and a per-session attempt token so stale workers cannot overwrite newer results

On failure, Line 1's focus is replaced by a red label (`⚠ AI timeout`, `⚠ AI rate limited`, `⚠ AI auth failed`, `⚠ AI setup required`, or `⚠ AI refinement failed`) until the next successful refinement clears it. `setup required` means the private executable pin is absent or no longer executable; rerun `/claude-recall:setup`.

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

If `CLAUDE_CONFIG_DIR` is set, remove `statusLine` and optional recall data from that directory instead.

<details>
<summary><strong>Development</strong></summary>

```bash
git clone https://github.com/dkstm95/claude-recall.git
cd claude-recall
npm install
npm run build
npm test
```

Local testing:

```bash
claude --plugin-dir /path/to/claude-recall
```

</details>

## License

[MIT](LICENSE)
