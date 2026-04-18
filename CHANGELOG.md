# Changelog

## 5.0.0

### Breaking changes

- **`/continue` removed.** Replaced by `/handoff`. `/continue` collided with the `claude --continue` CLI flag, and its in-chat code-block output was counterproductive in the context-limit scenario it was designed for (the generated summary further inflated an already-full context and did not survive session termination).
- **`/export` removed.** Its one real use case (persist session info to disk) is absorbed by `/handoff`, which writes a richer summary. `/export` also referenced schema fields (`startedAt`, `status`, `model`) that no longer exist in `SessionState` as of v4.0.0, producing `undefined` rows in its output.

### Migration

- Replace any `/continue` or `/export` usage with `/handoff`. The new command writes to `~/.claude/claude-recall/handoffs/{YYYY-MM-DD}-{slug}.md` and echoes just two lines: the saved path and a ready-to-paste `@<path>` for seeding a fresh session.
- Relationship to Claude Code's native `/recap`: `/recap` is a resume aid for a session you're *continuing*; `/handoff` prepares a file for a session you're *replacing*. They're complementary.

### Added

- **`/handoff`** — generates a structured Markdown handoff (What was done / What remains / Key context) and writes it to `~/.claude/claude-recall/handoffs/`. Chat output is restricted to two lines — the saved absolute path and a `@<path>` hint — so the command does not further consume the current session's context. Files survive session termination; seed a new session with `@<path>` for instant context recovery.

### Changed

- HUD hints now point to `/handoff`: the 70–89% Line 1 hint `(try /handoff)` and the ≥90% Line 2 warning `⚠ try /handoff`.
- The ≥90% warning width is now computed via `visibleWidth()` instead of `.length`, eliminating a latent miscount on terminals that render combining marks / CJK in that slot.

### Fixed

- **`/purpose` no longer writes a non-existent `purposeSetAt` field.** The field was removed from `SessionState` in v4.0.0 but the command still instructed Claude to set it; `state.ts` silently dropped it on the next rewrite.
- **Atomic state writes now use a UUID tmp suffix instead of the process PID** (`src/state.ts`). The previous `${target}.tmp.${process.pid}` risked collision on PID reuse if a prior process crashed before renaming.
- **`getBranch()` is now locale-independent.** The `execSync` call now injects `LC_ALL=C` so the "not a git repository" stderr match works regardless of the user's locale.
- **Hooks now log errors to stderr** in addition to emitting `{}` to stdout, so failures in `session-start` and `prompt-submit` are debuggable via Claude Code's hook stderr capture instead of disappearing silently.

### Notes

- Handoff files may contain excerpts of your conversation. They are stored locally only, under `~/.claude/claude-recall/handoffs/`. Review or delete as appropriate.
- `~/.claude/claude-recall/handoffs/` is created on first `/handoff` use (no pre-setup required).

## 4.0.0

### Breaking changes

- **`/list` command removed.** The cross-session table view has been retired. The HUD + per-session accent colors now carry the parallel-session positioning on their own. If you relied on `/list`, it is no longer available.
- **`SessionEnd` hook removed.** Its sole purpose was stamping `status='completed'` for `/list`; with `/list` gone, the hook is no longer needed.
- **`SessionState` schema simplified from 14 to 8 fields.** Removed: `pid`, `status`, `startedAt`, `model`, `purposeSetAt`, `lastUserPromptAt`. Old state files on disk continue to parse without crash — legacy fields are silently ignored and stop being written.

### New

- **`worktree` slot** (Line 1, opt-in) — renders `⎇ <name>` from stdin `workspace.git_worktree` when you're inside a linked git worktree. Enable by adding `"worktree"` to `line1` in `~/.claude/claude-recall/config.json`.
- **`rate_limits` slot** (Line 2, opt-in) — renders `5h:NN%` from Claude Code's `rate_limits.five_hour.used_percentage`. Suppressed below 50%, yellow 50–79%, red ≥80%. Enable by adding `"rate_limits"` to `line2`.
- **`/continue` HUD hint** — when context usage is 70–89%, Line 1 shows a dim `(try /continue)` hint. At ≥90% the existing red `⚠ try /continue` warning on Line 2 takes over. The `/purpose` hint always wins priority when both would apply.
- **Live elapsed clock** — elapsed rendering now prefers stdin's `cost.total_duration_ms` when present, falling back to `state.lastActivityAt` otherwise. Works hand-in-hand with `refreshInterval` from v3.4.0 for live updates during idle periods.

### Improvements

- `cleanupOldSessions()` no longer requires a `status='completed'` marker — any session whose `lastActivityAt` is older than 7 days is cleaned. Active sessions refresh `lastActivityAt` on every prompt/statusline render and are naturally protected.

## 3.4.0

- **Use Claude Code's native `session_name`** — `/rename` and `--name` are now detected via the statusline stdin `session_name` field instead of scanning the transcript file on every prompt. Removes up to 32KB of disk I/O and JSON parsing per user prompt. Renames propagate on the next statusline render (each assistant message) instead of the next prompt.
- **Live elapsed clock via `refreshInterval`** — `/setup` now writes `refreshInterval: 30` so the Line 2 `[elapsed]` indicator stays accurate while the main session is idle (e.g., while coordinating background subagents). No API tokens are consumed.
- **Horizontal padding** — `/setup` now writes `padding: 1` for a subtle breathing margin around the HUD.

## 3.3.0

- **Smart purpose refinement** — at prompt #3, auto-purpose is updated if the current prompt is more descriptive (longer) than the first prompt
- **Fix purpose hint flickering** — `(try /purpose)` hint now shows persistently after 5+ prompts when purpose is auto-detected, instead of flickering on/off at every 5th prompt
- **Stale session tip** — `/list` now shows a summary when stale sessions are detected, explaining they will be auto-cleaned

## 3.2.2

- **Update preview images** — SVGs now reflect v3.x HUD: accent bars (`▍`), session-specific colors, bold purpose, color-coded context%, `⚠ try /continue` warning
- **README improvements** — heading hierarchy fix (`###` → `##`), accent bar documented in HUD table, "How it works" expanded with `/continue`, `/export`, accent colors, config

## 3.2.1

- **Documentation update** — README.md/README.ko.md now document all v3.x features: accent colors, context warning, config/themes, /continue, /export
- **Positioning refinement** — marketplace description emphasizes "multi-session awareness" as the unique value proposition
- **CLAUDE.md sync** — architecture docs updated with new files (config.ts, continue.md, export.md) and patterns

## 3.2.0

- **`/continue` command** — generates a session handoff summary for seamless context transfer to a new session when context is running out
- **`/export` command** — exports session metadata as a Markdown file for documentation and review

## 3.1.0

- **HUD slot customization** — configure which elements appear in each line via `~/.claude/claude-recall/config.json`
  - `line1`: choose from `purpose`, `branch`, `model`
  - `line2`: choose from `turn`, `prompt`, `elapsed`, `context`, `cost`
- **Color themes** — three presets via `"theme"` in config: `default` (cyan/bold), `minimal` (subdued, no color), `vivid` (bright/high contrast)

## 3.0.0

- **Context crisis warning** — when context usage ≥ 90%, Line 2 shows red `⚠ try /continue` instead of cost
- **Session accent colors** — each session gets a deterministic accent color based on project directory + branch, enabling instant visual identification when switching sessions

## 2.9.0

- **Hook robustness** — all hooks now gracefully handle malformed stdin (output `{}` instead of crashing)
- **Fix CJK column alignment** — `/list` table columns now align correctly with CJK characters
- **Optimize git calls** — branch detection runs every 10 prompts instead of every prompt
- **Fix cleanup NaN** — sessions with invalid timestamps are now properly cleaned up
- **Non-git directory handling** — branch display clears when switching to non-git directories
- **Custom title scan limit** — transcript scan capped at 100 lines for safety

## 2.8.0

- **HUD visual enhancement** — improved readability across diverse terminal themes
  - Accent bar prefix (`▍`) replaces dim `⎯` and `›` for consistent visual anchor
  - Purpose text now **cyan+bold**, prompt text now **bold** — clear visual hierarchy
  - Context % is color-coded: green (<70%), yellow (70-89%), red (≥90%)
  - New ANSI helpers: `bold`, `boldCyan`, `green`, `red` (combined SGR codes, no nesting issues)

## 2.7.0

- **Fix HUD documentation** — README tables now correctly show line 1 vs line 2 layout
- **Update preview images** — SVGs now match v2.4.0+ layout (metrics on line 2, turn count shown)
- Fix setup.md reference to removed post-tool-use.js
- Add Bash to /purpose allowed-tools for transcript reading

## 2.6.0

- `(try /purpose)` hint now shows every 5th prompt regardless of purposeSource

## 2.5.0

- `/purpose` (no args) now auto-applies the generated purpose without asking for confirmation

## 2.4.0

- **Reorganized HUD layout** — stable info on line 1, dynamic info on line 2
  - Line 1: purpose + (try /purpose) + branch + model
  - Line 2: #turn + last prompt + elapsed + context% + cost
- Hint auto-hides when purpose space is tight
- Simplified truncate function

## 2.3.0

- `/purpose` hint threshold reduced from 10 to 5 prompts

## 2.2.0

- **Simplified HUD layout** — cleaner 2-line design
  - Line 1: purpose + (try /purpose) hint + branch + elapsed + builtin metrics
  - Line 2: `#turn` count + last prompt
- **Turn counter** — shows current prompt number (`#1`, `#12`) on line 2
- **`/purpose` hint** — `(try /purpose)` appears after 10+ prompts when purpose is still auto-detected
- Reverted purpose to first-prompt-only (dynamic update caused redundancy with last prompt)
- Removed PostToolUse hook and action tracking (unnecessary overhead)
- Removed keyword-based divergence detection (unreliable for non-English)

> **Upgrading from 1.x:** Run `/setup` once after updating to reconfigure the statusline launcher.

## 2.1.0

- `/setup` now creates a launcher script that auto-resolves the latest plugin version
- No need to re-run `/setup` after plugin updates

## 2.0.0

- **Auto-cleanup** — completed sessions older than 7 days are automatically removed on session start

## 1.13.0

- Polish READMEs for community launch: centered hero, badges, GitHub alerts
- Add `/purpose` (no args) to usage table

## 1.12.0

- Add uninstall instructions to both READMEs

## 1.11.0

- Add CHANGELOG.md

## 1.10.0

- Add MIT License

## 1.9.0

- Rewrite architecture section as plain-language "How it works"

## 1.8.0

- Add detailed HUD element table to both READMEs (description + data source)

## 1.7.0

- Add split-pane preview image showing 4 parallel sessions

## 1.6.0

- Redesign preview image to show multi-session tab switching

## 1.5.0

- Restructure `/purpose` command to auto-suggest from conversation when called without arguments
- Remove `argument-hint` to prevent Claude from ignoring the empty-args flow

## 1.4.0

- Strengthen `/purpose` empty-args instruction

## 1.3.0

- Handle `/purpose` with no arguments: show current purpose instead of clearing it

## 1.2.0

- Hide sessions with `promptCount=0` from `/list`
- Reduce double output in `/list` command

## 1.1.0

- Replace `claude-recall list` CLI binary with `/list` slash command

## 1.0.0

- Initial release
- Session tracking via hooks: `SessionStart`, `UserPromptSubmit`, `SessionEnd`
- Auto-purpose detection from first prompt
- Custom-title detection from transcript
- Slash command filtering (prompts starting with `/` are ignored)
- Statusline HUD combining session state with Claude Code built-in metrics (model, context%, cost)
- CJK double-width character support
- Progressive hiding of right-side elements on narrow terminals
- Atomic state file writes (tmp + rename)
- `/setup` command for statusline configuration
- `/purpose` command for manual purpose setting
- Bilingual README (English + Korean)
- Marketplace plugin support
