# claude-recall

Claude Code plugin (v6.1.5) that provides a session awareness statusline.
Tracks a Haiku-refined focus label, activity, git status, and prompt count for every parallel Claude Code session.

- **Author**: seungilahn
- **License**: MIT
- **Repository**: dkstm95/claude-recall
- **Install**: `/plugin marketplace add dkstm95/claude-recall`

## Build

```bash
npm run build        # TypeScript -> dist/ (tsc)
npm install          # Install dev dependencies (typescript, @types/node)
```

- Source: `src/*.ts` -> Output: `dist/*.js`
- Target: ES2022, Node16 ESM modules
- Node >= 20.0.0 required

## Architecture

```
.claude-plugin/           # Plugin manifest
  plugin.json             #   Name, version, description, author
  marketplace.json        #   Marketplace listing metadata
commands/                 # Slash commands (markdown with frontmatter)
  handoff.md              #   /handoff — write session handoff MD to ~/.claude/claude-recall/handoffs/
  setup.md                #   /setup — configure statusline & launcher script
hooks/
  hooks.json              # Hook registration (SessionStart, UserPromptSubmit, PreCompact, SessionEnd)
src/                      # TypeScript source
  config.ts               #   StatuslineConfig interface, theme colors, config file reader, legacy slot mapping
  state.ts                #   SessionState interface, read/write JSON, cleanup, getGitStatus
  format.ts               #   3-line statusline formatter, CJK width, bar renderer, progressive truncation
  statusline.ts           #   Entry point: stdin JSON -> formatStatusline() -> stdout
  stdin.ts                #   Async stdin reader utility
  refine.ts               #   Haiku subprocess wrapper: spawnRefinement + triggerFocusRefinement + launchRefinementWorker (detached) + 5s debounce
  refine-worker.ts        #   Detached worker entry — runs `triggerFocusRefinement` outside the 10s hook window
  rate-limits-cache.ts    #   Per-account cache for rate_limits stdin field (omitted on first render)
  context-window-cache.ts #   Per-session cache for context_window stdin field (omitted on first render)
  hooks/
    session-start.ts      #   Initialize/resume session, cleanup old sessions (>7d)
    prompt-submit.ts      #   Track prompts, update git status, trigger focus refinement at power-of-2 turns
    trigger-refinement.ts #   Shared entry for PreCompact + SessionEnd — spawns the detached refine-worker
dist/                     # Compiled JS (committed, do NOT edit directly)
assets/                   # SVG preview images for marketplace
```

## Data Flow

```
SessionStart event -> session-start.ts        -> creates/updates ~/.claude/claude-recall/sessions/{id}.json
UserPromptSubmit   -> prompt-submit.ts         -> increments promptCount, updates git status, triggers focus refinement at 2^k turns (k>=0, so 1,2,4,8,...)
PreCompact         -> trigger-refinement.ts    -> fire-and-forget the refine-worker (natural milestone)
SessionEnd         -> trigger-refinement.ts    -> fire-and-forget the refine-worker (final snapshot)
Statusline render  -> statusline.ts            -> reads session JSON + stdin metrics -> 1-3 line statusline output
/handoff command   -> handoff.md               -> writes structured handoff MD file for a fresh session
```

Focus refinement path:
```
trigger hook -> refine.ts::launchRefinementWorker (spawn detached refine-worker.js, unref, return immediately)
             -> refine-worker.ts -> refine.ts::triggerFocusRefinement (5s debounce via lastRefinedAt)
                -> spawn `claude -p --model=haiku --tools "" --no-session-persistence ...`
                   with env CLAUDE_RECALL_REFINING=1 (prevents recursive plugin hook firing in child)
                -> 45s timeout; output text -> state.focus OR refinementError (empty transcript = silent skip, not an error)
```
Why detached: Claude Code's 10s hook timeout would SIGHUP `claude -p` before Haiku responds (~1-5s typical, up to 45s). The hook returns in <50ms; the worker outlives it and writes state asynchronously.

## Session State Schema

Key fields in `~/.claude/claude-recall/sessions/{sessionId}.json`:

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | Unique session ID |
| focus | string | AI-refined session description (max 60 chars) |
| branch | string | Current git branch (fallback from gitStatus.branch) |
| gitStatus | GitStatus \| null | `{ branch, dirty, ahead, behind, defaultBranch }` |
| cwd | string | Working directory at session start |
| promptCount | number | Total user prompts (excludes slash commands) |
| lastUserPrompt | string | Last prompt text (first 200 chars) |
| lastActivityAt | string | ISO timestamp of last activity (drives 7-day cleanup) |
| lastRefinedAt | string \| null | ISO timestamp of last focus refinement (debounce guard) |
| refinementError | RefinementError \| null | `{ code: 'timeout' \| 'rate_limit' \| 'auth' \| 'unknown', at, durationMs?, stderrTail? }` |
| lastRefinement | LastRefinement \| null | Last refinement attempt record: `{ at, status: 'ok' \| 'error', code?, durationMs, transcriptBytes, stdoutBytes?, stderrTail? }` (diagnostics, survives across successes) |

`GitStatus` fields: `branch`, `dirty`, `ahead` (vs origin/default), `behind` (vs origin/default), `defaultBranch`.

## Statusline Layout

```
Line 1 (stable):   ▍ [focus|error-label] (try /handoff) [worktree] [branch*↑N↓N] [model]
Line 2 (dynamic):  ▍ [#turn last_prompt]                                        [elapsed]
Line 3 (opt-out):  ▍ ctx ████░░░░░░ 45%   5h ████░░░░░░ 52% (~17:00)   7d █░░░░░░░░░ 19%   $0.03
```

- Accent bar prefix (`▍`) with session-specific color (deterministic hash of cwd+branch)
- Focus: cyan+bold (default theme), replaced by red `⚠ AI <reason>` when `refinementError` is set
- Prompt: bold — clear visual hierarchy (customizable via theme)
- Context %: green (<70%), yellow (70-89%), red (≥90%) — rendered on Line 3 as `ctx` bar since v6.1.0
- Context ≥ 90%: `⚠ try /handoff` red warning on Line 1
- Line 2 renders on every entry (with `(awaiting first prompt)` placeholder before the first prompt)
- `/handoff` hint shows on Line 1 when context is 70-89% (yields to the ≥90% warning)
- `worktree` slot renders `⎇ <basename>` from stdin `workspace.git_worktree` — opt-in via config
- `branch` slot renders `branch[*][↑N][↓N]` — dirty flag + ahead/behind vs `origin/<default>`. 0-count arrows suppressed.
- `line3` slot renders ctx + rate_limits bars + cost. Hidden when no data. Opt out with `line3: []`.
- Elapsed source: stdin `cost.total_duration_ms` when present, else `state.lastActivityAt`
- Minimum widths: focus >= 15 cols (truncated with `…`), prompt >= 30 cols (truncated with `…`)
- Configurable via `~/.claude/claude-recall/config.json` (line1/line2/line3 slots, gitStatus toggles, theme)

### Priority rules (what drops as width shrinks)

Width precedence: `stdout.columns` → `stderr.columns` → `$COLUMNS` → `80` fallback (see `getTerminalWidth()` in `src/format.ts`). Claude Code inherits stderr, so `stderr.columns` reports the actual render-area width on modern versions; `$COLUMNS` only matters when neither stream is a TTY.

**Line 1** — `focus` always renders (truncated with `…` to min 15 cols). Right-side segments follow config order left-to-right = high-to-low priority, and `progressiveJoin` drops the rightmost segments first. Default `['focus', 'branch', 'model']` means `model` drops before `branch`.

**Line 2** — `#turn` always renders. `last_prompt` truncates with `…` to min 30 cols. Right-side (`elapsed`) drops first if the prompt cannot meet its minimum.

**Line 3** — Priority `ctx > 5h > 7d > cost`. Before dropping whole segments, a compaction ladder shortens each one:

| Level | What changes | Cols saved |
|-------|--------------|-----------|
| L0 | Full render (every segment with its reset text) | — |
| L1 | Drop 7d's `(~M/D HH:MM)` reset | ~14 |
| L2 | Drop 5h's `(~HH:MM)` reset too | ~10 more |
| L3 | Drop whole segments right-to-left: `cost` → `7d` → `5h`; `ctx` always survives | variable |

Effect at the 80-col fallback with all four segments populated: L0 is ~91 cols → L1 fits at ~77 cols → every segment stays visible, only 7d's reset text is hidden. See `renderLine3()` in `src/format.ts`.

## Key Patterns

- **Atomic writes**: `writeState()` writes to `.tmp` file, then `rename()` (crash-safe)
- **Graceful degradation**: Hooks always output `{}` even on error; statusline exits silently on missing data
- **CJK-aware**: `displayWidth()` and `isWide()` in format.ts handle double-width characters
- **Slash command filtering**: prompt-submit.ts ignores prompts starting with `/`
- **Lazy cleanup**: Sessions idle for >7 days (by `lastActivityAt`) are cleaned on SessionStart, not continuously
- **Stdin-first elapsed**: statusline prefers `cost.total_duration_ms` from stdin over self-tracked timestamps
- **Git call optimization**: full git status runs every 10 prompts (`% 10 === 1`), not every prompt
- **Theme system**: `ThemeColors` interface abstracts all color calls; 4 presets (default, light, minimal, vivid). `COLORFGBG`-based auto-select picks `light` on light terminals when `theme` is omitted; `NO_COLOR` strips all ANSI output.
- **Config-driven statusline**: line1/line2/line3 element arrays control which segments render.
- **Focus refinement recursion guard**: `refine.ts` sets `CLAUDE_RECALL_REFINING=1` in the child env; all hooks early-return when this env var is set, preventing the spawned `claude -p` from re-triggering the plugin.
- **Debounce on refinement**: `shouldRefine()` checks `lastRefinedAt` against a 5s window. Optimistic write of `lastRefinedAt` before the `claude -p` call narrows the concurrent-spawn race window.

## Coding Conventions

- TypeScript strict mode enabled
- ES module imports with `.js` extension in import paths (Node16 resolution)
- No external runtime dependencies — only Node.js built-in modules (fs, path, child_process, os) and the system `claude` CLI
- All async functions use try/catch with `process.exit(0)` on error in hooks
- Colors via ANSI escape codes (helper functions in format.ts; themed colors in config.ts)
- State directory: `~/.claude/claude-recall/sessions/`

## Version & Release Rules

**Every change that affects plugin behavior MUST include:**
1. Version bump in ALL three files: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
2. README.md AND README.ko.md updates (version badge + any affected content)
3. CHANGELOG.md entry for the new version

Why: Plugin cache uses version to determine updates. Without a bump, `/plugin marketplace update` won't pull new code.
Do this in the same commit, not as a separate step.

## Hook Configuration

All hooks defined in `hooks/hooks.json`:
- `SessionStart` / `UserPromptSubmit` / `PreCompact` / `SessionEnd` — all **timeout 10s**. Even the refinement triggers finish fast because `launchRefinementWorker` spawns a detached `refine-worker.js` and returns immediately; the worker carries the 45s Haiku budget outside the hook window.
- Matcher: `"*"` (triggers on all events)
- Command pattern: `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js"` — `PreCompact` and `SessionEnd` share `trigger-refinement.js`.

## Important Notes

- `dist/` is committed to git (users install from marketplace without building)
- The statusline launcher script lives at `~/.claude/claude-recall/statusline-launcher.sh`
- Settings are merged into `~/.claude/settings.json` by `/setup` command
- Bilingual documentation: English (README.md) + Korean (README.ko.md)
- Background LLM calls are core behavior; no opt-out config. Uninstall to stop.
