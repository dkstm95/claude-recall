# claude-recall

Claude Code plugin (v6.4.3) that provides a session awareness statusline.
Tracks a Haiku-refined focus label, activity, git status, and prompt count for every parallel Claude Code session.

- **Author**: seungilahn
- **License**: MIT
- **Repository**: dkstm95/claude-recall
- **Install**: `/plugin marketplace add dkstm95/claude-recall`

## Build

```bash
npm run build        # TypeScript -> dist/, then sync runtime-only plugin/
npm run check:dist   # Verify both compiled dist/ and the plugin/ mirror
npm test             # Verify release artifacts, then run all Node tests
npm install          # Install dev dependencies (typescript, @types/node)
```

- Source: `src/*.ts` -> canonical output: `dist/*.js` -> runtime mirror: `plugin/dist/*.js`
- Target: ES2022, Node16 ESM modules
- Node >= 20.0.0 required

## Architecture

```
.claude-plugin/           # Plugin manifest
  plugin.json             #   Canonical dev manifest (mirrored into plugin/)
  marketplace.json        #   Marketplace listing metadata
commands/                 # Slash commands (markdown with frontmatter)
  setup.md                #   /claude-recall:setup — configure statusline & launcher
hooks/
  hooks.json              # Hook registration (SessionStart, UserPromptSubmit, CwdChanged, PreCompact, PostCompact, SessionEnd)
src/                      # TypeScript source
  config.ts               #   StatuslineConfig interface, theme colors, config file reader, legacy slot mapping
  json-file.ts            #   Private atomic JSON writes + cross-process file locks
  paths.ts                #   CLAUDE_CONFIG_DIR-aware config/data paths
  metrics.ts              #   Runtime number/percentage/reset-time normalization
  terminal-text.ts        #   Control stripping, grapheme segmentation, terminal width
  state.ts                #   Session schema, locked mutation API, cleanup, async git status
  format.ts               #   3-line formatter, Unicode width, bars, progressive truncation
  statusline.ts           #   Entry point: stdin JSON -> formatStatusline() -> stdout
  launcher.ts             #   Cross-platform installed-plugin registry launcher
  claude-runtime.ts       #   Private absolute Claude executable pin + setup-time discovery
  setup.ts                #   Deterministic setup helper (runtime pin, launcher, settings merge)
  stdin.ts                #   Async stdin reader utility
  refine.ts               #   Haiku subprocess wrapper: spawnRefinement + triggerFocusRefinement + launchRefinementWorker (detached) + 5s debounce
  refine-worker.ts        #   Detached worker entry — runs `triggerFocusRefinement` outside the 10s hook window
  rate-limits-cache.ts    #   Per-account cache for rate_limits stdin field (omitted on first render)
  context-window-cache.ts #   Per-session cache for context_window stdin field (omitted on first render)
  hooks/
    session-start.ts      #   Initialize/resume session, cleanup old sessions (>7d)
    prompt-submit.ts      #   Track prompts, update git status, trigger focus refinement at power-of-2 turns
    cwd-changed.ts        #   Persist Claude Code /cd moves and refresh git status for the new cwd
    trigger-refinement.ts #   Shared entry for PreCompact + PostCompact + SessionEnd — spawns the detached refine-worker
dist/                     # Compiled JS (committed, do NOT edit directly)
plugin/                   # Generated runtime-only marketplace source (committed)
  .claude-plugin/         #   Mirrored plugin manifest
  commands/ hooks/        #   Mirrored runtime components
  dist/                   #   Mirrored JS + ESM-only package marker (no npm dependencies)
scripts/                  # Artifact sync and non-mutating drift checks
assets/                   # SVG preview images for marketplace
```

## Data Flow

```
SessionStart event -> session-start.ts        -> creates/updates CONFIG_DIR/claude-recall/sessions/{id}.json
UserPromptSubmit   -> prompt-submit.ts         -> increments promptCount, updates git status, triggers focus refinement at 2^k turns (k>=0, so 1,2,4,8,...)
CwdChanged         -> cwd-changed.ts           -> persists the new cwd after Claude Code /cd and refreshes git status
PreCompact         -> trigger-refinement.ts    -> fire-and-forget the refine-worker (natural milestone)
PostCompact        -> trigger-refinement.ts    -> fire-and-forget the refine-worker with compact_summary when present
SessionEnd         -> trigger-refinement.ts    -> fire-and-forget the refine-worker (final snapshot)
Statusline render  -> statusline.ts            -> reads session JSON + stdin metrics + refreshes git status directly -> 1-3 line statusline output
```

Focus refinement path:
```
trigger hook -> refine.ts::launchRefinementWorker (spawn detached refine-worker.js, unref, return immediately)
             -> refine-worker.ts -> refine.ts::triggerFocusRefinement (locked single-flight claim + 5s debounce)
                -> reads compact_summary when supplied, else transcript tail
                -> read private runtime.json -> spawn pinned absolute Claude launcher with `-p --model=haiku ...`
                   with hooks/tools/MCP/session persistence disabled and CLAUDE_RECALL_REFINING=1
                -> missing/broken pin fails closed as setup_required; PATH is never a runtime fallback
                -> 45s timeout; output text -> state.focus OR refinementError (empty transcript = silent skip, not an error)
```
Why detached: Claude Code's 10s hook timeout would SIGHUP `claude -p` before Haiku responds (~1-5s typical, up to 45s). The hook returns in <50ms; the worker outlives it and writes state asynchronously.

## Session State Schema

Key fields in `${CLAUDE_CONFIG_DIR:-~/.claude}/claude-recall/sessions/{safeSessionId}.json`:

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | Unique session ID |
| focus | string | AI-refined session description (max 60 chars) |
| branch | string | Current git branch (fallback from gitStatus.branch) |
| gitStatus | GitStatus \| null | `{ branch, dirty, ahead, behind, defaultBranch }` |
| cwd | string | Current working directory for the session |
| promptCount | number | Total user prompts (excludes slash commands) |
| lastUserPrompt | string | Last prompt text (first 200 chars) |
| sessionStartedAt | string | ISO timestamp when session was first opened (immutable after SessionStart; drives elapsed fallback) |
| lastActivityAt | string | ISO timestamp of last activity (drives 7-day cleanup) |
| lastRefinedAt | string \| null | ISO timestamp of last focus refinement (debounce guard) |
| refinementAttemptId | string \| null | UUID of the active single-flight refinement claim; completion must match it |
| refinementError | RefinementError \| null | `{ code: 'timeout' \| 'rate_limit' \| 'auth' \| 'setup_required' \| 'unknown', at, durationMs?, stderrTail? }` |
| lastRefinement | LastRefinement \| null | Last refinement attempt record: `{ at, status: 'ok' \| 'error', code?, durationMs, transcriptBytes, stdoutBytes?, stderrTail? }` (diagnostics, survives across successes) |

`GitStatus` fields: `branch`, `dirty`, `ahead` (vs origin/default), `behind` (vs origin/default), `defaultBranch`.

## Statusline Layout

```
Line 1 (stable):   ▍ [focus|error-label]  [worktree] │ [session] │ [agent] │ [PR] │ [branch*↑N↓N] │ [model + effort]
Line 2 (dynamic):  ▍ [#turn last_prompt]                                          [elapsed]
Line 3 (opt-out):  ▍ ctx ████░░░░░░ 45% │ 5h ████░░░░░░ 52% (~17:00) │ 7d █░░░░░░░░░ 19% │ $0.03
```

- Accent bar prefix (`▍`) colored by a deterministic hash of `cwd + current branch` — so parallel tabs on different repos or different feature branches render distinct colors. Note: the color shifts when the branch changes mid-session (by design, to distinguish branch contexts at a glance).
- Focus: cyan+bold (default theme), replaced by red `⚠ AI <reason>` when `refinementError` is set
- Prompt: bold — clear visual hierarchy (customizable via theme)
- Context %: green (<70%), yellow (70-89%), red (≥90%) — rendered on Line 3 as `ctx` bar since v6.1.0
- Line 1 no longer renders command-style context hints. Context pressure stays in the Line 3 `ctx` bar.
- Line 2 renders on every entry (with `(awaiting first prompt)` placeholder before the first prompt)
- `worktree` slot renders `⎇ <basename>` from stdin `worktree.name` / `worktree.path` (legacy fallback: `workspace.git_worktree`) — opt-in via config
- `session`, `agent`, and `pr` slots render Claude Code's current `session_name`, `agent.name`, and `pr` metadata — opt-in via config
- `branch` slot renders `branch[*][↑N][↓N]` — dirty flag + ahead/behind vs `origin/<default>`. 0-count arrows suppressed.
- `model` slot enriches `model.display_name` with version parsed from `model.id` when needed, plus `effort.level` and `thinking.enabled` suffixes when present.
- `line3` slot renders ctx + rate_limits bars + cost. Hidden when no data. Opt out with `line3: []`.
- Elapsed source: stdin `cost.total_duration_ms` (wall-clock since session started, per Claude Code docs) when present, else `Date.now() - state.sessionStartedAt` (same semantic)
- Minimum widths: focus >= 15 cols (truncated with `…`), prompt >= 30 cols (truncated with `…`)
- Column grid (v6.3.0+): right-zone segments (worktree / session / agent / pr / branch / model / elapsed) left-pad to a uniform 10-col cell; a dim `│` (U+2502) joins them. Dynamic content is sanitized and bounded, and lower-priority segments drop before a line can exceed the terminal width.
- Configurable via `${CLAUDE_CONFIG_DIR:-~/.claude}/claude-recall/config.json` (line1/line2/line3 slots, gitStatus toggles, theme, `separator`). Set `"separator": ""` to disable the grid and fall back to 2-space joiners (pre-v6.3.0 look). Any printable single grapheme works (`"┊"`, `"|"`, etc.); dim color is applied per theme.

### Priority rules (what drops as width shrinks)

Width precedence: `stdout.columns` → `stderr.columns` → `$COLUMNS` → `120` fallback (see `getTerminalWidth()` in `src/format.ts`). Claude Code pipes stdout/stderr for statusline commands, so stream `.columns` values are usually unavailable. Since Claude Code 2.1.153, statusline commands receive `COLUMNS` and `LINES` environment variables, making `$COLUMNS` the normal width source on current versions. Older Claude Code versions and non-Claude invocations still fall back to `120`, which keeps Line 3's full L0 render (~91 cols) visible.

**Line 1** — When configured, `focus` renders on the left (truncated with `…` to min 15 cols). Right-side segments follow config order left-to-right = high-to-low priority, and `progressiveJoin` drops the rightmost segments first. Default `['focus', 'branch', 'model']` means `model` drops before `branch`.

**Line 2** — `#turn` always renders. `last_prompt` truncates with `…` to min 30 cols. Right-side (`elapsed`) drops first if the prompt cannot meet its minimum.

**Line 3** — Priority `ctx > 5h > 7d > cost`. Before dropping whole segments, a compaction ladder shortens each one:

| Level | What changes | Cols saved |
|-------|--------------|-----------|
| L0 | Full render (every segment with its reset text) | — |
| L1 | Drop 7d's `(~M/D HH:MM)` reset | ~14 |
| L2 | Drop 5h's `(~HH:MM)` reset too | ~10 more |
| L3 | Drop whole segments right-to-left: `cost` → `7d` → `5h`; `ctx` always survives | variable |

Effect at the 120-col fallback with all four segments populated: L0 (~91 cols) fits comfortably and every segment including 7d's `(~M/D HH:MM)` stays visible. If the effective width drops below ~91 cols, the ladder kicks in — at ~77-90 cols everything except the 7d reset survives (L1); below that, segments drop right-to-left. See `renderLine3()` in `src/format.ts`.

## Key Patterns

- **Atomic + serialized writes**: JSON is written to a private `.tmp` file then renamed; generation-unique bakery-lock claims serialize shared read-modify-write transactions without stale-owner ABA deletion.
- **Private storage**: recall directories/files are hardened to `0700`/`0600` where supported; unsafe session IDs are hash-mapped to filenames.
- **Graceful degradation**: Hooks always output `{}` even on error; statusline exits silently on missing data
- **Unicode-aware**: `Intl.Segmenter` preserves grapheme clusters; terminal widths cover combining marks, Hangul Jamo, emoji, ZWJ sequences, and East Asian wide characters.
- **Terminal-safe external text**: prompt/focus/git/metadata values have terminal and bidi controls stripped before theming and truncation.
- **Slash command filtering**: prompt-submit.ts ignores prompts starting with `/`
- **Lazy cleanup**: Sessions idle for >7 days (by `lastActivityAt`) are cleaned on SessionStart, not continuously
- **Stdin-first elapsed, consistent semantic**: statusline prefers stdin `cost.total_duration_ms` (wall-clock since session started) and falls back to `Date.now() - state.sessionStartedAt` — both measure the same thing. Older session JSONs without `sessionStartedAt` degrade to `lastActivityAt`.
- **Single async git path**: `getGitStatus()` is async (`execFile`, `Promise.all` across the 3 independent calls, `--no-optional-locks` on `git status`, 1s per-call timeout). Called from both the statusline (every render — mid-turn `git checkout` visible immediately) and hooks (persist to `state.gitStatus` as a backup for when the live call fails). `refreshGitStatus(state, cwd)` is the single mutation helper used by SessionStart, UserPromptSubmit, CwdChanged, and statusline render-time refresh. Measured p95 ~21ms on this repo.
- **Theme system**: `ThemeColors` interface abstracts all color calls; 4 presets (default, light, minimal, vivid). `COLORFGBG`-based auto-select picks `light` on light terminals when `theme` is omitted; `NO_COLOR` strips all ANSI output.
- **Config-driven statusline**: line1/line2/line3 element arrays control which segments render.
- **Focus refinement isolation**: the private prompt goes over stdin; the child runs from the recall directory and disables setting sources, hooks, tools, slash commands, persistence, and non-explicit MCP config. `CLAUDE_RECALL_REFINING=1` remains an additional recursion guard.
- **Pinned Claude executable**: `/claude-recall:setup` checks the existing pin or official native default (non-default launchers require an explicit absolute path), verifies the native binary, and atomically stores its stable lexical path in private `runtime.json`. Neither setup nor refinement scans PATH; every refinement snapshots the current real target, verifies that captured target with `--version`, then spawns the same realpath with `shell: false`. Keeping the lexical pin lets legitimate native/Homebrew retargets apply on the next call without a verify/spawn symlink race.
- **PostCompact summary preference**: `trigger-refinement.ts` passes Claude Code's `compact_summary` to the detached worker when present; transcript tail remains the fallback for PreCompact, SessionEnd, and prompt-triggered refinements.
- **Single-flight refinement**: a locked attempt UUID/lease combines with the 5s debounce. Only the matching worker may commit its result, preventing duplicate calls and stale-result overwrites.
- **Runtime-only marketplace bundle**: `.claude-plugin/marketplace.json` points to `./plugin`, so development manifests, TypeScript, tests, and `devDependencies` never enter the installed cache. `sync-plugin.mjs` generates the mirror and `check-dist.mjs` byte-compares it.

## Coding Conventions

- TypeScript strict mode enabled
- ES module imports with `.js` extension in import paths (Node16 resolution)
- No external runtime dependencies — only Node.js built-in modules and the setup-pinned native Claude Code executable
- All async functions use try/catch with `process.exit(0)` on error in hooks
- Colors via ANSI escape codes (helper functions in format.ts; themed colors in config.ts)
- State directory: `${CLAUDE_CONFIG_DIR:-~/.claude}/claude-recall/sessions/`

## Version & Release Rules

**Every change that affects plugin behavior MUST include:**
1. Version bump in `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`
2. README.md AND README.ko.md updates (version badge + any affected content)
3. CHANGELOG.md entry for the new version
4. Run `npm run build` so `dist/` and the generated `plugin/` manifest/runtime mirror are synchronized

Why: Plugin cache uses version to determine updates. Without a bump, `/plugin marketplace update` won't pull new code.
Do this in the same commit, not as a separate step.

## Hook Configuration

All hooks defined in `hooks/hooks.json`:
- `SessionStart` / `UserPromptSubmit` / `CwdChanged` / `PreCompact` / `PostCompact` / `SessionEnd` — all **timeout 10s**. Even the refinement triggers finish fast because `launchRefinementWorker` spawns a detached `refine-worker.js` and returns immediately; the worker carries the 45s Haiku budget outside the hook window.
- Matcher: `"*"` (triggers on all events)
- Command pattern: `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js"` — `PreCompact`, `PostCompact`, and `SessionEnd` share `trigger-refinement.js`.

## Important Notes

- `dist/` and generated `plugin/` are committed; marketplace installs only the lightweight `plugin/` subtree
- The statusline launcher lives at `${CLAUDE_CONFIG_DIR:-~/.claude}/claude-recall/statusline-launcher.mjs` and resolves the active plugin from `installed_plugins.json`, following `CLAUDE_CODE_PLUGIN_CACHE_DIR` when set.
- `/claude-recall:setup` merges settings and writes the verified Claude launcher descriptor to `${CLAUDE_CONFIG_DIR:-~/.claude}/claude-recall/runtime.json`; refinement fails closed until this pin exists.
- Bilingual documentation: English (README.md) + Korean (README.ko.md)
- Background LLM calls are core behavior; no opt-out config. Uninstall to stop.
