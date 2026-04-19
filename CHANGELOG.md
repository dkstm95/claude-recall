# Changelog

## 6.0.2

### Fixed

- **Focus label now appears at the very first prompt.** v6.0.1 deferred the first refinement to `promptCount=2` to avoid an empty-transcript race; the cost was an empty `(no focus yet)` line for the entire first turn. Resolved deterministically by giving `spawnRefinement` a `fallbackPrompt` parameter:
  - When the JSONL transcript tail is empty (typical on the first prompt), `refine.ts` now wraps `state.lastUserPrompt` as a one-turn synthetic transcript and feeds it to Haiku instead of skipping. `state.lastUserPrompt` is persisted via atomic `writeFileSync` + `renameSync` *before* the worker is spawned, so the fallback is race-free.
  - `prompt-submit.ts` trigger condition relaxed back to `isPowerOfTwo(promptCount)` — `1, 2, 4, 8, 16, ...` (was `2, 4, 8, ...`).
  - PreCompact / SessionEnd paths are unchanged: they still pass no fallback and still silently skip when the transcript is genuinely empty.

## 6.0.1

### Fixed

- **Spurious `⚠ AI refinement failed` on the very first prompt.** v6.0.0 triggered focus refinement at `promptCount=1`, which raced Claude Code's transcript JSONL flush — the worker often read an empty transcript and surfaced it as a generic `unknown` error label. Two-layer fix:
  - **First refinement deferred to `promptCount=2`** in `prompt-submit.ts`. The first focus label now appears one turn later, but without the race.
  - **Empty transcript is now a silent skip**, not an error, in `refine.ts` (new `RefineResult` `'skip'` variant). Applies to `PreCompact` and `SessionEnd` paths too, where an empty transcript can also legitimately occur.
  - **Optimistic `lastRefinedAt` write is rolled back on skip** so a subsequent `PreCompact` within 5s isn't blocked by a debounce that protects a no-op.

## 6.0.0

### Breaking changes

- **`/purpose` command removed entirely.** Session focus is now managed autonomously by a Claude Haiku subprocess. Users no longer type anything to manage focus.
- **Field rename: `purpose` → `focus`.** The schema field reflects the evolving, AI-refined nature of the label (vs the older "user-declared goal" framing). Legacy state files are migrated in-place on next read; no user action needed.
- **`purposeSource` field removed.** With `session_name` sync gone and auto/manual paths gone, the pin-state enum lost its reason to exist.
- **`session_name` ↔ focus sync removed.** Claude Code's `/rename` and claude-recall's `focus` are conceptually different (platform session identity vs plugin semantic summary) and are no longer coupled. Running `/rename` no longer affects focus.
- **`line1` slot rename: `'purpose'` → `'focus'`.** Existing configs with `'purpose'` are transparently remapped — no manual edit required, but new configs should use `'focus'`.
- **`line2` default no longer contains `cost` or `rate_limits`.** Both moved to the new `line3`. Users who kept the v5 defaults will see cost and rate limits on Line 3 instead.
- **`getBranch()` → `getGitStatus()`.** Public helper in `src/state.ts` renamed; now returns `{ branch, dirty, ahead, behind, defaultBranch }` in one call.

### Migration

- **Automatic:** state files on disk with `purpose`/`purposeSource` are migrated to `focus` on next read (purpose copied to focus, both old fields dropped on next write).
- **Automatic:** `config.json` with `"line1": ["purpose", ...]` is transparently mapped to `"focus"`.
- **Manual:** if you relied on `/purpose`, remove it from muscle memory — focus is now managed for you. Guide focus indirectly through the content of your conversation.
- **Opt-out via non-installation:** there is no toggle to disable the background Haiku calls. If you want zero background LLM calls, uninstall the plugin.

### Added

- **Autonomous focus management.** A Claude Haiku subprocess refines focus at power-of-2 turns (1, 2, 4, 8, 16, 32, ...), before context compaction, and at session end. 30s timeout, 5s debounce. Runs with `--tools ""`, `--disable-slash-commands`, `--no-session-persistence`, and `CLAUDE_RECALL_REFINING=1` env guard (prevents recursive plugin loading in the child).
- **New hooks: `PreCompact` and `SessionEnd`** registered in `hooks/hooks.json` with 35s timeout each.
- **Git status enrichment.** Branch now shows dirty flag (`*`) and ahead/behind counts (`↑N↓N`) vs `origin/<default>`. Default branch is auto-detected via `git symbolic-ref refs/remotes/origin/HEAD`, falling back to `main` → `master`. On the default branch itself, `↓N` still renders — you see when you haven't pulled.
- **Line 3** (opt-out via `line3: []`) — visual bars for 5-hour and 7-day Claude.ai rate limit windows, plus cumulative session cost. Rendered only when rate_limits data is present (subscribers).
- **`refinementError` red label on Line 1.** When a background refinement fails, Line 1's focus slot shows one of four labels — `⚠ AI timeout`, `⚠ AI rate limited`, `⚠ AI auth failed`, `⚠ AI refinement failed` — until the next successful refinement clears it.
- **`src/refine.ts`** module with `spawnRefinement()` + `triggerFocusRefinement()` + `shouldRefine()`.

### Changed

- **Line 2 prompt width dramatically increased.** The 80-column hard cap on prompt text is removed; the `MIN_PROMPT_COLS` minimum is raised from 15 to 30. On an 80-col terminal, visible prompt text is roughly 3× wider than in v5.
- **Statusline is now up to 3 lines.** The default principle is "render lines that have data"; line 3 stays hidden for API-key-only sessions with no rate_limits payload.
- **`(try /purpose)` hint removed.** With autonomous focus, the hint is no longer needed.
- **`SessionState` schema:** +3 fields (`gitStatus`, `lastRefinedAt`, `refinementError`), -1 field (`purposeSource`), net +2. `purpose` renamed to `focus`.

### Removed

- `commands/purpose.md` command file (all cases A and B)
- `(try /purpose)` Line 1 hint logic in `format.ts`
- First-prompt auto-purpose generation in `prompt-submit.ts`
- Prompt #3 purpose-refinement heuristic
- `session_name` → `purpose` sync block in `statusline.ts`
- `purposeSource: 'auto' | 'manual' | 'rename'` field

### Notes

- Background Haiku calls cost roughly $0.01 per long session. This is the intended behavior; there is no opt-out config.
- Ahead/behind counts reflect your last `git fetch`. Run `git fetch` periodically to keep the `↓N` indicator honest.
- Focus refinement language follows the transcript's language (Korean transcript → Korean focus) via a one-line system prompt directive to Haiku.

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
