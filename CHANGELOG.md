# Changelog

## 6.2.2

### Fixed

- **Branch display now updates on every render, not just on prompt submit.** Two related symptoms are fixed: (1) a brand-new session showed no branch on Line 1 until the first prompt was submitted, because the `SessionStart` hook hadn't flushed state before the first statusline render; (2) when Claude ran `git checkout` mid-turn, the old branch stuck around until the user submitted another prompt. The root cause was that the statusline read git only indirectly via the session state JSON, and the JSON was only written by hooks. The fix follows the approach used by [claude-hud](https://github.com/jarrodwatts/claude-hud): call `git` directly from the statusline process on every render.
- **Elapsed fallback semantic now matches the stdin path.** Per Claude Code's [statusline docs](https://code.claude.com/docs/en/statusline), `cost.total_duration_ms` is "total wall-clock time since the session started". The previous fallback computed `Date.now() - state.lastActivityAt`, which measures "time since last prompt" — a different quantity that reset every turn. A new `sessionStartedAt` field is written once at `SessionStart` and never overwritten, so the fallback now uses `Date.now() - state.sessionStartedAt`. Both paths now answer the same question. Older session JSONs without the field gracefully degrade to `lastActivityAt`.

### Changed

- **`getGitStatus()` is now a single async implementation shared by the statusline and hooks.** Built on `execFile` (no shell), `Promise.all` across the 3 independent calls (branch / dirty / default-branch; `rev-list` for ahead/behind chains after), `--no-optional-locks` on `git status` to avoid blocking a concurrent user git command, 1s per-call timeout. The sync `execSync` path (4 sequential calls, ~40ms p95) is deleted — the async version measures ~21ms p95 on this repo and is comfortably inside the 10s hook budget. `refreshGitStatus(state, cwd)` is the single mutation helper used by both the hook bootstrap and the statusline render.

### Docs

- **Accent bar color framing corrected.** Previous text called it a "session-specific color" or "per-session accent color", which implied one color per session. In practice the color is a hash of `cwd + current branch`, so it changes when the branch changes mid-session — a feature, not a bug (it makes feature branches visually separate from their base). README (EN/KO) and CLAUDE.md reworded to match the actual behavior.

## 6.2.1

### Changed

- **Git status refreshes every prompt instead of every 10th prompt.** The prior `promptCount % 10 === 1` cache was premature optimization: `getGitStatus()` measures at ~40ms p95 on a small repo and each of its 4 sub-calls is already bounded by a 2s `execSync` timeout (so worst-case 8s fits inside the 10s `UserPromptSubmit` hook budget). The stale-branch UX — switching branches mid-session and seeing the old name in Line 1 until turn 11 — was strictly worse than the negligible cost. Larger monorepos will still benefit from the per-call timeout guard.

## 6.2.0

### Removed

- **`/handoff` command removed.** The feature was positioned as an "emergency exit" for context exhaustion, but review exposed fundamental issues: (1) it relied on the current session's Claude to summarize at exactly the moment that Claude is most context-starved and least capable of quality synthesis; (2) its 50KB transcript-tail sampling biased toward recent debugging noise and dropped the session's original intent; (3) the structured output template ignored rich state fields (`gitStatus.dirty`, `lastUserPrompt`) that were already available; (4) Claude Code's native `/compact`, `/clear`, and `/resume` commands cover the real use cases more reliably. Removal scope: `commands/handoff.md` deleted, Line 1 `/handoff` hints replaced (see below), README / README.ko / CLAUDE.md / tests updated.

### Changed

- **Line 1 context hint redesigned as a three-tier, Anthropic-aligned system.** Anthropic's official guidance is to run `/compact` around 60% context for the best summary quality, and auto-compact kicks in near the limit regardless of user action. The new tiers:
  - **60-69%** — dim `(/compact soon)` — proactive nudge at the recommended timing (new, previously no hint below 70%).
  - **70-89%** — dim `(run /compact)` — replaces the v6.1.x `(try /handoff)` hint. The action window where the user can still meaningfully steer preservation via `/compact focus on <topic>`.
  - **≥90%** — red `⚠ ctx 90%+` — replaces the v6.1.x `⚠ try /handoff` warning. At this point auto-compact is imminent or already running, so the hint surfaces only the severity, not a command prescription. Also future-proof: decoupling the critical warning from a specific command name means Anthropic renaming or replacing `/compact` doesn't break the plugin's UX.
- **Docs reframed.** README's "Why claude-recall?" replaces the `/handoff emergency exit` bullet with "Tiered context hints". The commands table drops the `/handoff` row; the plugin now ships with just `/setup`. A short pointer to Claude Code's native `/compact` / `/clear` / `/resume` replaces the handoff usage narrative.

### Migration

- **Existing handoff files are left untouched.** `~/.claude/claude-recall/handoffs/*.md` are user-owned artifacts — the upgrade does not delete them. Remove manually if desired (`rm -rf ~/.claude/claude-recall/handoffs/`).
- **Workflow replacement.** Where `/handoff` was used to "save a summary before the session dies", use Claude Code natively: `/compact focus on <what to preserve>` (summary stays in-session), or close the session and use `claude --resume` to pick up the transcript later.

### Notes

- 4 statusline tests rewritten/added: the ≥90% and 70-89% hint tests were rewritten to expect the new strings (and to assert the ≥90% hint does **not** name a command); new tests cover the 60-69% suggest tier and the "no hint below 60%" guarantee. Total: 75 → 77.
- `HINT_MAX_WIDTH` (the width reservation used to decide whether the hint fits alongside Line 1's focus slot) now spans three constants. On narrow terminals where the hint would crowd focus below its 15-col minimum, the hint drops silently — same fallback behavior as v6.1.x.

## 6.1.5

### Fixed

- **Line 3 `ctx` bar still hidden on the first render of brand-new sessions.** v6.1.4's per-session cache restored the bar for resumed sessions (cache hit covers the stdin-omission window), but a truly new `claude` invocation has no cache entry for its fresh `session_id`, so `resolveContextWindow()` returned `undefined` and `format.ts`'s `ctxPct != null` gate dropped the segment until the first user prompt triggered the first API call. Fix: `resolveContextWindow()` now returns `{ used_percentage: 0 }` as the final fallback (priority: live stdin > per-session cache > 0%) so the bar renders from the very first statusline tick. 0% is accurate for a new session (no conversation yet); for the rare pre-v6.1.4 resume with no cache entry, the 0% display self-corrects on the first prompt when the live value arrives. The 0% fallback intentionally does not populate the cache — only observed live values do.

### Notes

- Return type of `resolveContextWindow()` tightened from `ContextWindowData | undefined` to `ContextWindowData`. `src/statusline.ts` passes the result into `BuiltinData.context_window` (typed optional), so no call-site change was needed.
- 1 test rewritten (previously asserted `undefined` for empty-live-and-cache), 1 new test added to confirm the 0% fallback does not write the cache. Total: 74 → 75.

## 6.1.4

### Fixed

- **Line 3 `ctx` bar hidden on the first statusline render of every session; appeared only after the first user prompt.** Claude Code omits `context_window` from statusline stdin until the first API call populates token accounting, and `src/statusline.ts` was passing the field through raw — so `format.ts`'s `ctxPct != null` gate dropped the segment on entry. Fix: added `src/context-window-cache.ts` which persists per-session `used_percentage` to `~/.claude/claude-recall/context-windows.json`, keyed by `session_id`. When stdin lacks `context_window`, `resolveContextWindow()` falls back to the last-seen value for that session; when stdin supplies a live value, the cache is updated (atomic tmp+rename, no-op-guarded to skip unchanged writes). Resume sessions now show the previous `ctx` value immediately on render, replaced by the live value as soon as the first API call completes.

### Notes

- **Same root cause as `rate_limits` first-render omission** (solved in v6.0.x), but `context_window` was missed at the time and v6.1.0's Line-3 promotion made it visible. The new cache mirrors `src/rate-limits-cache.ts`'s shape (atomic write + change-detection guard) with one structural difference: `context_window` has no reset timestamp (percentages only grow until the session ends), so the `isFresh()` staleness check is replaced by `cleanupContextCache(keptSessionIds)` wired into `cleanupOldSessions()` in `src/state.ts` — when the 7-day session GC prunes a state file, the matching cache entry goes with it.
- Keyed by `session_id` (not a single global blob like rate-limits) so parallel Claude Code sessions don't contaminate each other's cached context percentages.
- Semantics: `stdout.columns → stderr.columns → $COLUMNS → 80` from v6.1.3 remains unchanged — this release only touches `context_window` plumbing.
- 13 new tests in `test/context-window-cache.test.mjs` cover read/write round-trip, malformed JSON tolerance, live-wins-over-cache, cache-fills-when-live-undefined (the Claude Code case), no-op-guard on unchanged writes, parallel-session isolation, and `cleanupContextCache` pruning. Total: 61 → 74.

## 6.1.3

### Fixed

- **Line 3 reset timestamps (especially `7d`'s `(~M/D HH:MM)`) silently hidden even on wide terminals.** `getTerminalWidth()` only read `$COLUMNS`, which Claude Code never sets on the statusline subprocess, and the `/setup`-generated launcher doesn't export it either — so every render fell through to the 80-col fallback regardless of actual terminal width, triggering the Line 3 compaction ladder's L1 (drop 7d's reset text) on every wide-terminal render. Fix: `getTerminalWidth()` now reads `process.stderr.columns` before falling back to `$COLUMNS`/80. Claude Code spawns the statusline with `stdio: ['pipe', 'pipe', 'inherit']`, so stderr stays attached to the parent terminal and reports Claude Code's actual render-area width — no `/dev/tty` probe needed, which avoids the multiplexer trap that forced v6.1.1's revert (outer tty wider than Claude Code's pane). Wide-terminal users now see L0 (all segments with reset timestamps) automatically on plugin update — no launcher change required.

### Notes

- Precedence: `stdout.columns` → `stderr.columns` → `$COLUMNS` → `80`. `stdout` goes first for users who explicitly redirect stderr; `$COLUMNS` remains honored as an explicit override for environments where neither stream is a TTY (detached CI, custom launchers).
- Inspired by [claude-hud](https://github.com/jarrodwatts/claude-hud)'s `src/render/index.ts` approach. The key observation — "Claude Code pipes stdout but inherits stderr" — is a property of Claude Code's spawn convention rather than Node-level tty magic, so this is a design-level fix, not a probe-and-hope.
- 3 net new tests in `test/format.test.mjs` cover the precedence chain (stdout > stderr > $COLUMNS > 80) and zero-column rejection; the prior `$COLUMNS overrides the fallback` test was rewritten to first null out stdout/stderr, since stderr now wins over `$COLUMNS` when both are set. Total: 58 → 61.

## 6.1.2

### Fixed

- **First-entry render broken on wide terminals after v6.1.1 (`Line 1` model ellipsis-truncated, `Line 2`/`Line 3` missing).** v6.1.1 introduced `/dev/tty` detection so `getTerminalWidth()` could return the real terminal width (e.g. 178) instead of the 80-col fallback, enabling the full Line 3 (`ctx  5h  7d  $cost`) on wide terminals. In multiplexer environments (cmux, tmux) the `/dev/tty` columns inherited from the outer process tree does NOT match Claude Code's effective statusline render area — the outer tty is wider than the pane Claude Code draws into. Our code then padded Line 1 to the (too-large) reported width, and Claude Code's statusline renderer truncated the overflowing line with its own `…` (hence the `Opus 4.7 (1M cont…` cutoff in the bug report) and dropped Lines 2/3 entirely because their wrapped physical rows exhausted the statusline area budget. Reverted `getTerminalWidth()` to the simple `$COLUMNS`-or-80 path: first-entry now renders all three lines reliably.

- **`7d` (and `$cost`) silently disappeared from Line 3 once a prompt was submitted.** The 80-col fallback + v6.1.0's new `ctx` bar pushed the full Line 3 to ~89 cols, so `progressiveJoin` dropped `$cost` then `7d` from the right — the same regression that motivated v6.1.1's now-reverted `/dev/tty` change. Replaced Line 3's single-pass `progressiveJoin` with a **priority-aware compaction ladder** that preserves every segment at 80 cols:
  - **Priority:** `ctx > 5h > 7d > cost`. Reset timestamps (`(~HH:MM)`, `(~M/D HH:MM)`) are dropped before whole segments are, since they're nice-to-have context on bars users can already read.
  - **Compaction levels:**
    - **L0** full — all segments render with reset text.
    - **L1** drop 7d's `(~M/D HH:MM)` (~14 cols saved).
    - **L2** drop 5h's `(~HH:MM)` too (~10 more cols saved).
    - **L3** drop whole segments right-to-left: `cost` → `7d` → `5h`. `ctx` always survives when present.
  - At the default 80-col budget with every segment populated (ctx 45%, 5h 52% + reset, 7d 19% + reset, $0.03), the full content is ~88 cols. L1 compaction drops 7d's reset text and the line fits at ~74 cols — users now see `ctx  5h (~HH:MM)  7d  $cost` on every render, not just on wide terminals.

### Added

- **Line 1 and Line 2 priority rules documented.** Same spirit as Line 3: `focus` (left) and `last_prompt` are truncated with `…` to their minimum widths (15 / 30 cols) before right-side segments drop. Line 1 right-side drop order follows user config order (left-of-config = higher priority); default `['focus', 'branch', 'model']` means `model` drops before `branch`. Line 2 right-side default drops `elapsed` if the prompt can't fit its minimum.

### Notes

- Trade-off vs the v6.1.1 approach: wide-terminal users no longer get extra horizontal room for Line 3 extras — but the compaction ladder makes the full 4-segment render fit in 80 cols anyway, so only reset timestamps are ever hidden (L1). Setting `$COLUMNS` in the statusline launcher still works as an explicit opt-in for wider budgets (which would keep every reset text, L0).
- 5 new tests in `test/statusline.test.mjs` cover the ladder at 80 / 140 / 65 / 50 / 22 cols. Total: 53 → 58.

## 6.1.1

### Fixed

- **Line 3 truncated on wide terminals (regression introduced in v6.1.0).** `getTerminalWidth()` only read `$COLUMNS`, which Claude Code does not set on the statusline subprocess — so every render fell through to the `80` fallback regardless of actual terminal width. Pre-v6.1.0 the default Line 3 (`5h  7d  $cost`) happened to fit in 80 cols (~66 wide), masking the bug. v6.1.0 added the `ctx` bar, pushing the full Line 3 to ~89 cols; with the 80-col fallback still in effect, `progressiveJoin` silently dropped `$cost` and `7d` from the right, leaving `ctx  5h` even on 178-col terminals. Fix: `getTerminalWidth()` now opens `/dev/tty` (the controlling terminal inherited from Claude Code's process tree) and reads `tty.WriteStream.columns`, falling back to 80 only when `/dev/tty` is unreachable (e.g. detached CI subprocesses, Windows without a TTY). `$COLUMNS` is still honored first when set explicitly, preserving test overrides.

### Notes

- Investigation method: a probe launcher dumped env + `/dev/tty` state on a live statusline render and confirmed `stty size </dev/tty` reported `38 178` (rows cols) while `$COLUMNS` was unset and all three stdio fds had `isTTY=false`. Node's `tty.WriteStream(fd).columns` returned the same 178. The fix is a direct application of that finding.
- 2 new tests in `test/format.test.mjs` cover the `$COLUMNS` override path and the fallback behavior when no TTY is reachable. Total: 51 → 53.

## 6.1.0

### Changed

- **Context window `%` moved from Line 2 to Line 3 as a `ctx` bar.** Previously the context usage was a bare percentage at the right edge of Line 2 (e.g. `45%`), sitting next to `elapsed` and competing with `last_prompt` for horizontal space. Line 3 already carries the `5h` and `7d` rate-limit bars via the shared `formatUsageSegment()` renderer, so context now slots into the same visual language: `ctx ████░░░░░░ 45%   5h ██░░░░░░░░ 15%   7d █░░░░░░░░░  8%   $0.03`. Line 2 is now dedicated to session-turn activity (`#turn last_prompt  elapsed`), which lets the prompt claim the freed horizontal space on narrow terminals. The `ctx` segment uses the same threshold palette as `5h`/`7d` but with tighter breakpoints (red ≥90%, yellow ≥70%) to match the criticality of context exhaustion vs quota pressure.

### Added

- **Critical-context warning (`⚠ try /handoff`) promoted to Line 1.** The ≥90% warning previously lived in Line 2's context slot; with context gone from L2, the warning would have been invisible to users who turn Line 3 off entirely via `line3: []`. It now appears on Line 1 alongside (and replacing) the existing 70-89% `(try /handoff)` dim hint — rendered in red with a ⚠ glyph at ≥90%, dim parens at 70-89%. Line 1 is unconditional, so the warning is guaranteed to render regardless of `line3` opt-out.

### Migration

- **Existing `config.json` files with `"context"` in `line2` are auto-migrated.** On read, if the stored config lists `context` under `line2` and `line3` does not already include it, `context` is prepended to `line3` at load time — users keep the feature without editing their config. Users who want the new default layout can delete `context` from `line2` (it is now an invalid L2 slot and will be silently filtered).

### Notes

- The new L3 default order is `['context', 'rate_limits', 'seven_day', 'cost']`. `progressiveJoin` drops segments right-to-left on narrow terminals, so on constrained widths `cost` drops first, then `7d`, then `5h` — `ctx` is the last to go, matching its criticality.
- `renderBar()` and `formatUsageSegment()` gained an optional `thresholds` parameter so the context bar can use `{red: 90, yellow: 70}` while the rate-limit bars keep their original `{red: 80, yellow: 50}`. No behavior change for the existing bars.
- 5 new tests in `test/statusline.test.mjs` cover the ctx bar render, L2 no longer carries `%`, ≥90% red warning on L1, 70-89% dim hint on L1 (no ⚠), and L3 opt-out (`line3: []`) hiding ctx. Total: 46 → 51.

## 6.0.9

### Fixed

- **`default` theme dim text near-invisible on dark terminals.** The default (dark-background) theme was the only one still emitting `\x1b[2m` (SGR "faint" attribute) for its `dim` slot. "Faint" is not a color — it's a hint to the terminal to blend the current foreground toward the background, and the blend strength is entirely implementation-defined. On many popular dark themes (including the one shown in the v6.0.8 screenshot report), the blend drops readability below legible for every dim-rendered segment: the `(no focus yet)` / `(awaiting first prompt)` placeholders on Lines 1–2, the `#turn` counter, the `elapsed` clock, the `5h`/`7d` labels and their `(~HH:MM)` reset timestamps on Line 3, the `$cost`, and the `(try /handoff)` Line 1 hint. Replaced with `\x1b[38;5;245m` — an explicit 256-color palette entry (≈`#8a8a8a`, neutral mid-gray) that doesn't depend on the terminal's faint-attribute rendering and reads clearly on every dark theme tested. The `light` theme (already `38;5;244`) and `vivid` (`90`) were not affected; `minimal` retains `'2'` because its monochrome ethos actually relies on the faint behavior for its one-level-of-emphasis design.

### Notes

- No schema changes, no new configuration, no migration. This is a single-line theme-data change in `src/config.ts::THEME_CODES.default`.
- Why `38;5;245` specifically: indices 240–255 are the xterm 256-color grayscale ramp (`#080808` through `#eeeeee`). 245 ≈ `#8a8a8a` sits one step lighter than the `light` theme's 244 (`#808080`), favoring dark backgrounds. 256-color support is universal on every terminal that also supports ANSI escape codes at all (any terminal released in roughly the last 15 years), so the compatibility cost is zero.
- Not changed: the `dim: '2'` inside the `minimal` theme. `minimal`'s entire design is "no color, one level of emphasis" — replacing faint with an explicit gray would contradict its stated purpose, and users who opted into `minimal` are presumed to have accepted the terminal-dependent faint rendering as part of that tradeoff.

## 6.0.8

### Fixed

- **Line 3 blank on first entry.** When `claude` launched into a fresh session, the rate-limit bars on line 3 were absent until the first API call completed — Claude Code's statusline stdin omits `rate_limits` until it has made at least one request, so the only populated field was `cost: 0`, rendering line 3 as a lonely `$0.00`. Since `rate_limits` are an **account-level quota** (5h / 7d windows are identical across every session for the same user), they're a natural candidate for cross-session caching. Added `src/rate-limits-cache.ts` which persists the last-known `rate_limits` to `~/.claude/claude-recall/rate-limits.json`. `statusline.ts` now calls a single `resolveRateLimits()` helper that merges live stdin data over this cache on every render (live wins; cache fills gaps), and writes back only when the merged value actually differs from what's on disk. Line 3 now renders `5h ██░░░░░░░░ 15%   7d █░░░░░░░░░  8%` the moment `claude` starts, assuming the user has used claude-recall recently enough that the cached windows haven't rolled over.

### Notes

- **Staleness is `resets_at`-based, not wall-clock-based.** A cached window is kept as long as its `resets_at` epoch is still in the future. Once a window's reset fires, the cached percentage is dropped from the read (actual usage is 0 in the new window, so surfacing the old number would overstate quota pressure). This also means a 2-hour-old cache entry is still valid if the 5-hour window hasn't rolled over — the actual percentage can only have gone *up*, so the cached value is a safe lower bound.
- **Hot-path discipline.** The statusline is re-rendered every ~300ms by Claude Code, so naive caching would issue 3–4 `writeFileSync` + `renameSync` pairs per second on identical data between API calls. `resolveRateLimits()` compares the merged value against the already-read cache (`dataEqual`) and skips the write when nothing changed. `mkdirSync` is hoisted to the write path only; reads hit `readFileSync` directly against a module-level `CACHE_PATH` constant, so cold-start cost is a single file open.
- **No new configuration.** Caching is implicit and automatic; there is no opt-out. Users who don't want persistent state can delete `~/.claude/claude-recall/rate-limits.json` — it will not be recreated until claude-recall next sees live `rate_limits` in stdin.
- **Cache is global, not per-session.** Account-level quotas are identical for every parallel session, so a single file at `~/.claude/claude-recall/rate-limits.json` is shared across all sessions. Atomic write via `.tmp.<uuid>` + `renameSync`, matching the pattern used by `state.ts::writeState`. The `RateLimitsData` / `RateLimitWindow` shape lives in one place (`rate-limits-cache.ts`) and is imported by `format.ts::BuiltinData` and `statusline.ts::StatuslineInput`, replacing three identical inline type definitions.
- 14 new unit tests (`test/rate-limits-cache.test.mjs`) cover the merge precedence (live > cache), partial-live + partial-cache, stale-window filtering (both windows stale → `null`; one window stale → other survives), round-trip, the `hasAnyLivePct` guard, and `resolveRateLimits` end-to-end — including an `mtime`-based assertion that repeat identical live data does *not* rewrite the cache file.
- Total test count: 45 → 59.

## 6.0.7

### Fixed

- **Blank statusline on first entry.** When `claude` was launched in a fresh session, the statusline rendered empty until the user sent their first prompt — Claude Code called the statusline before the `SessionStart` hook had finished writing state, so `readState()` returned `null` and `statusline.ts` silently `process.exit(0)`'d (graceful-degradation path). Now `statusline.ts` synthesizes an initial `SessionState` from the stdin payload (`session_id`, `cwd`, `workspace.current_dir`) so Line 1 renders `(no focus yet)` + model immediately, and Line 2 renders `#0  (awaiting first prompt)` + elapsed + context%. Parallel-session users no longer stare at a blank bar while the hook boots.

### Changed

- **Line 2 no longer requires a prompt to render.** The previous `if (!state.lastUserPrompt) return line1;` early-return in `format.ts::formatStatusline` hid the entire second line before the first user prompt, which suppressed turn count, elapsed time, and context% — all of which are meaningful even at `#0`. Line 2 now renders unconditionally when `config.line2` is non-empty; the prompt slot shows `(awaiting first prompt)` in `dim` until a real prompt arrives. Users who explicitly set `line2: []` still get a single-line HUD.

### Notes

- No schema changes to `SessionState`, stdin contract, or config. This is a purely presentational release — no new fields, no migration.
- 5 new unit tests (`test/statusline.test.mjs`) cover the first-entry render, 3-line render with `rate_limits`, the post-first-prompt transition away from the placeholder, `line2: []` opt-out, and `refinementError` winning over the focus placeholder.
- Total test count: 40 → 45.

## 6.0.6

### Added

- **`light` theme.** First-class support for light-background terminals. Uses blue (`\x1b[34m`) for focus/branch, magenta (`\x1b[35m`) for model/worktree, a 256-color mid-grey (`\x1b[38;5;244m`) for `dim`, and a 256-color dark-orange (`\x1b[38;5;166m`) where dark themes use yellow — the 16-color yellow (`\x1b[33m`) is near-invisible on white and was the single biggest readability regression for users on light terminals.
- **Auto-detection via `COLORFGBG`.** When `theme` is absent from `~/.claude/claude-recall/config.json` and the terminal exports `COLORFGBG`, claude-recall picks `light` for `bg=7` or `bg=15` and `default` otherwise. Supports both two-part (`15;0`) and three-part (`0;default;15`) forms. Any explicit `theme` value wins; users who have already pinned a theme see zero behavior change.
- **`NO_COLOR` support.** Per [no-color.org](https://no-color.org), the presence of the `NO_COLOR` environment variable (any value, including empty string) disables every ANSI escape the plugin emits — across all themes, including the session accent bar. 5 lines at the top of `getThemeColors()`.
- **Theme-aware accent bar.** `ThemeColors` now carries an `accents: ColorFn[]` array and `format.ts::sessionColor` consumes it via injection. Previously the `▍` prefix used a hardcoded six-color palette regardless of theme, which contradicted `minimal` (claimed "no color") and occasionally rendered the bar in `\x1b[33m` yellow — invisible on white backgrounds, breaking session identification for 1-in-6 sessions on light terminals.
  - `minimal` accents collapse to `[dim]` (a single subdued block, preserving the theme's monochrome ethos at the cost of per-session color identity).
  - `light` accents drop yellow entirely and use `[36, 35, 34, 32, 31]` — five colors all readable on white.

### Fixed

- **`minimal` theme severity collision.** Previously both `yellow` and `red` resolved to `\x1b[1m` (bold), making 50% and 80% rate-limit bars, 70% and 90% context warnings, and `⚠ AI` error labels visually indistinguishable in `minimal` mode. `red` now uses `\x1b[1;7m` (bold + reverse video) — the transport-level "flip fg/bg" trick that reads as high-alarm on any terminal without introducing a color.
- **`vivid.prompt` invisibility on light backgrounds.** Was `\x1b[1;97m` (bold + bright-white), which on any light-background terminal renders as white-on-white. Now `\x1b[1m` (bold only); severity vs. default theme comes from the surrounding bright-color accents, not the prompt itself.

### Notes

- No schema changes to `SessionState` or the stdin contract. This is a purely presentational release.
- New unit tests (`test/theme.test.mjs`): 14 cases covering the collision fix, `NO_COLOR` short-circuit across all four themes, `COLORFGBG` parsing edge cases (two-part, three-part, malformed, absent), and `readConfig` fallback routing.
- Total test count: 26 → 40.

## 6.0.5

### Added

- **Rate-limit reset timestamps on Line 3.** Each usage segment now shows when its window resets, parsed from `rate_limits.{five_hour|seven_day}.resets_at` (Unix epoch seconds, provided by Claude Code for Pro/Max subscribers).
  - **5h**: `5h ████░░░░░░ 45% (~16:59)` — local-time `HH:MM` only. The reset is always within 5 hours, so the date is implied.
  - **7d**: `7d ██░░░░░░░░ 20% (~4/25 13:59)` — local `M/D HH:MM`. Weekday is intentionally omitted to keep the segment compact.
  - The reset text is rendered in the theme's `dim` color so it reads as secondary info to the bar/percent.
  - Gracefully degrades: segments where `resets_at` is absent (API-key users, first-render, missing field) fall back to the pre-6.0.5 format with no `(~...)` suffix.

### Changed

- **Line 3 now uses `progressiveJoin` instead of a plain `'  '.join(...)`.** On narrow terminals the right-most segments drop in order `cost → 7d → 5h`, guaranteeing the most important signal (5h usage + reset) always survives. Before this change, Line 3 could visibly wrap or clip when the reset suffix pushed segments past `$COLUMNS`.

### Notes

- All timestamps render in the machine's local timezone via `Date#getHours`/`getMonth`/`getDate`. No timezone offset is printed — the user reads whatever wall-clock they're living in.

## 6.0.4

### Changed

- **Timeout raised from 30s to 45s.** Measurements showed a fixed ~9s `claude -p` startup cost on systems with many MCP servers — the old 30s budget left only ~21s for Haiku and was breached on transcripts that filled the 20KB tail. 45s gives Haiku roughly 36s of headroom on the new 12KB tail.
- **Transcript tail reduced from 20KB to 12KB** (`TRANSCRIPT_TAIL_BYTES`). A smaller input narrows Haiku's processing-time variance without losing enough recent context to affect focus-label accuracy.

### Added

- **`lastRefinement` snapshot.** `SessionState` now carries a new `LastRefinement` field — `{ at, status: 'ok' | 'error', code?, durationMs, transcriptBytes, stdoutBytes?, stderrTail? }` — rewritten on every refinement attempt, success or failure. Unlike `refinementError` (which only records the current error state), this gives successful runs a baseline `durationMs` and `transcriptBytes` so future regressions ("why was this one 28s when the baseline is 11s?") are diagnosable from the state file alone.
- **Partial stdout preserved on timeout.** `spawnRefinement` now records `stdoutBytes` in error results, so timeouts where Haiku was partway through a response are distinguishable from timeouts where nothing came back at all.

### Notes

- `refinementError` is unchanged shape-wise; it remains the "is there a current error" signal used by the statusline (`⚠ AI timeout` etc.). `lastRefinement` is the new diagnostic trail.
- Existing state files without `lastRefinement` read back as `null` and are upgraded on the next refinement write.
- The tail-size constant change cascaded to `test/refine.test.mjs` fixtures (previously sized around 20KB boundaries; now 12KB).

## 6.0.3

### Added

- **Refinement observability.** `RefinementError` now carries `durationMs` (how long the Haiku subprocess ran before failing) and `stderrTail` (last 500 chars of stderr, trimmed, omitted when empty). Surfaced in `~/.claude/claude-recall/sessions/<id>.json` so future timeouts can be diagnosed without re-running the scenario.
- **Test suite.** `node --test` based unit tests for UTF-8 boundary handling in `readTranscriptTail`, CJK width / truncation in `format.ts`, and `classifyError` / `shouldRefine` behavior. Run with `npm test`. Zero new runtime or dev dependencies — tests are `.mjs` files that import the built `dist/` output.

### Changed

- `readTranscriptTail`, `classifyError`, `progressiveJoin`, and the `Segment` interface are now exported. Internal behavior unchanged.

### Notes

- The `stderrTail` / `durationMs` fields are optional. Old state files without them continue to read normally; `writeState` omits them when absent (standard `JSON.stringify` behavior with `undefined`).
- Next candidate to verify with the new data: whether first-prompt timeouts correlate with large transcript tails (`durationMs` close to 30 000 ms) or network/auth (`stderrTail` with rate-limit or credential text that slipped past `classifyError`).

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
