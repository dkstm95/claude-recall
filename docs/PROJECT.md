# Project

This document is the canonical project reference for claude-recall's behavior,
architecture, persisted data, release rules, and operational invariants.
Agent-specific instructions should link here instead of duplicating these facts.

## Project Identity

- **Name**: claude-recall
- **Current version**: 6.4.0
- **Purpose**: Claude Code plugin that provides a session-awareness statusline for parallel sessions.
- **Core behavior**: tracks an AI-refined focus label, prompt activity, git status, context/rate-limit usage, model metadata, elapsed time, and cost.
- **Author**: seungilahn
- **License**: MIT
- **Repository**: dkstm95/claude-recall
- **Install**: `/plugin marketplace add dkstm95/claude-recall`

## Build And Runtime

- Source: `src/*.ts`
- Output: `dist/*.js`
- Build command: `npm run build`
- Test command: `npm test`
- TypeScript target: ES2022
- Module system: Node16 ESM
- Runtime: Node >= 20.0.0
- Runtime dependencies: none beyond Node.js built-ins and the system `claude` CLI
- Development dependencies: `typescript`, `@types/node`
- `dist/` is committed because marketplace users install without building locally.

## Repository Layout

```text
.claude-plugin/
  plugin.json             Plugin manifest: name, version, description, author
  marketplace.json        Marketplace listing metadata
commands/
  setup.md                /setup command for statusline configuration
hooks/
  hooks.json              Hook registration
src/
  config.ts               StatuslineConfig, theme colors, config reader, legacy slot mapping
  state.ts                SessionState, JSON state read/write, cleanup, git status refresh
  format.ts               3-line statusline formatter orchestration
  statusline-types.ts     Builtin statusline input types
  statusline-render-context.ts Shared render context type
  statusline-segments.ts  Shared segment construction helpers
  statusline-line1.ts     Line 1 focus/metadata/git/model renderer
  statusline-line2.ts     Line 2 prompt/turn/elapsed renderer
  terminal-text.ts        Terminal width, ANSI stripping, elapsed formatting, CJK-aware truncation
  statusline-layout.ts    Segment/joiner primitives and progressive right-side dropping
  statusline-line3.ts     Line 3 usage bars and compaction ladder
  statusline.ts           Entry point: stdin JSON -> formatStatusline() -> stdout
  stdin.ts                Async stdin reader
  cache-store.ts          Shared claude-recall JSON cache path/read/write helper
  refine.ts               Focus-refinement orchestration and debounce
  refine-env.ts           Refinement subprocess recursion guard
  refine-spawn.ts         Haiku subprocess wrapper
  refine-transcript.ts    Transcript tail and compaction-summary selection
  refine-worker-launch.ts Detached worker launcher
  refine-worker.ts        Detached worker entry point
  rate-limits-cache.ts    Account-level rate_limits cache
  context-window-cache.ts Per-session context_window cache
  hooks/
    session-start.ts      Initialize/resume session, cleanup old sessions
    prompt-submit.ts      Track prompts, refresh git status, trigger refinement
    trigger-refinement.ts PreCompact/PostCompact/SessionEnd refinement trigger
dist/                     Compiled JS, committed, do not edit directly
assets/                   Marketplace preview SVGs
test/                     Node test runner suites
```

## Data Flow

```text
SessionStart       -> session-start.ts        -> create/update ~/.claude/claude-recall/sessions/{id}.json
UserPromptSubmit   -> prompt-submit.ts        -> increment promptCount, update git status, refine at 1,2,4,8,...
PreCompact         -> trigger-refinement.ts   -> launch detached refine-worker
PostCompact        -> trigger-refinement.ts   -> launch detached refine-worker, preferring compact_summary
SessionEnd         -> trigger-refinement.ts   -> launch detached refine-worker
Statusline render  -> statusline.ts           -> read session JSON + stdin metrics + live git refresh -> render output
```

Focus refinement path:

```text
trigger hook -> refine.ts::launchRefinementWorker
             -> refine-worker.ts
             -> refine.ts::triggerFocusRefinement
                -> 5s debounce through lastRefinedAt
                -> prefer compact_summary, otherwise transcript tail, otherwise last user prompt
                -> spawn claude -p --model=haiku --tools "" --no-session-persistence ...
                   with CLAUDE_RECALL_REFINING=1
                -> 45s timeout
                -> write state.focus on success or refinementError on failure
```

The refinement worker is detached because Claude Code hook commands have a 10s timeout.
The hook returns quickly while the worker carries the 45s Haiku budget outside the hook window.

## Session State Schema

Session files live at `~/.claude/claude-recall/sessions/{sessionId}.json`.

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | Unique session ID |
| focus | string | AI-refined session description, max 60 chars |
| branch | string | Current git branch fallback from `gitStatus.branch` |
| gitStatus | GitStatus \| null | `{ branch, dirty, ahead, behind, defaultBranch }` |
| cwd | string | Working directory at session start |
| promptCount | number | User prompt count, excluding slash commands |
| lastUserPrompt | string | Last prompt text, first 200 chars |
| sessionStartedAt | string | Immutable ISO timestamp set on SessionStart |
| lastActivityAt | string | ISO timestamp of last activity, used for 7-day cleanup |
| lastRefinedAt | string \| null | ISO timestamp of last focus refinement debounce write |
| refinementError | RefinementError \| null | Current refinement error, if any |
| lastRefinement | LastRefinement \| null | Last success or failure diagnostics |

`GitStatus` fields are `branch`, `dirty`, `ahead`, `behind`, and `defaultBranch`.

`RefinementError.code` is one of `timeout`, `rate_limit`, `auth`, or `unknown`.

## Statusline Layout

```text
Line 1: ▍ [focus|error-label]  [worktree] │ [session] │ [agent] │ [PR] │ [branch*↑N↓N] │ [model + effort]
Line 2: ▍ [#turn last_prompt]                                          [elapsed]
Line 3: ▍ ctx ████░░░░░░ 45% │ 5h ████░░░░░░ 52% (~17:00) │ 7d █░░░░░░░░░ 19% │ $0.03
```

- Accent bar color is a deterministic hash of `cwd + current branch`.
- The color intentionally changes when the branch changes mid-session.
- Focus is replaced by a red refinement error label while `refinementError` is set.
- Context thresholds are green below 70%, yellow from 70% to 89%, and red at 90% or above.
- Line 2 renders on every entry unless disabled by config.
- The `worktree`, `session`, `agent`, and `pr` slots are opt-in Line 1 metadata slots.
- The `branch` slot renders `branch[*][↑N][↓N]`; zero-count arrows are suppressed.
- The `model` slot enriches `model.display_name` with version parsed from `model.id` when useful, and appends effort/thinking metadata when present.
- Line 3 renders ctx, rate-limit bars, and cost. It is hidden when no data exists and can be disabled with `line3: []`.
- Elapsed time prefers stdin `cost.total_duration_ms`; fallback is `Date.now() - state.sessionStartedAt`.
- Focus truncates to a minimum 15 columns; prompt truncates to a minimum 30 columns.
- The right-zone grid left-pads worktree/session/agent/pr/branch/model/elapsed segments to a 10-column soft cell when `separator` is non-empty.
- Set `"separator": ""` to disable the grid and use two-space joiners.

## Width And Drop Priority

Width precedence is `process.stdout.columns` -> `process.stderr.columns` -> `$COLUMNS` -> `120`.
Claude Code usually pipes stdout/stderr for statusline commands, so `$COLUMNS` is the normal width source on current Claude Code versions.

- **Line 1**: focus always renders and truncates first. Right-side segments follow config order from high to low priority; rightmost segments drop first.
- **Line 2**: turn always renders. Prompt truncates first. `elapsed` drops if the prompt cannot meet its minimum.
- **Line 3**: priority is `ctx > 5h > 7d > cost`. Before dropping whole segments, the compaction ladder removes reset text.

Line 3 compaction levels:

| Level | Behavior |
|-------|----------|
| L0 | Full render, including all reset text |
| L1 | Drop 7d reset text |
| L2 | Drop 5h reset text too |
| L3 | Drop whole segments right-to-left: cost, then 7d, then 5h; ctx survives |

## Configuration

User config lives at `~/.claude/claude-recall/config.json`.

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

Valid slots:

- `line1`: `focus`, `branch`, `model`, `worktree`, `session`, `agent`, `pr`
- `line2`: `turn`, `prompt`, `elapsed`
- `line3`: `context`, `rate_limits`, `seven_day`, `cost`

Themes are `default`, `light`, `minimal`, and `vivid`.
When `theme` is omitted, `COLORFGBG` selects `light` for light backgrounds (`bg=7` or `bg=15`) and `default` otherwise.
`NO_COLOR` disables all ANSI colors.

## Hook Configuration

All hooks are registered in `hooks/hooks.json`.

- Events: `SessionStart`, `UserPromptSubmit`, `PreCompact`, `PostCompact`, `SessionEnd`
- Timeout: 10s for every hook
- Matcher: `"*"`
- Commands:
  - `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.js"`
  - `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/prompt-submit.js"`
  - `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/trigger-refinement.js"`

`PreCompact`, `PostCompact`, and `SessionEnd` share `trigger-refinement.js`.

## Key Invariants

- Atomic JSON writes use `.tmp.<uuid>` followed by `rename`.
- Hooks must always emit `{}` and must not break the Claude Code hook pipeline.
- Statusline command failures should degrade silently.
- Slash commands are excluded from `promptCount`.
- Sessions idle for more than 7 days by `lastActivityAt` are cleaned lazily on SessionStart.
- `refreshGitStatus(state, cwd)` is the single mutation helper for git state.
- `getGitStatus()` uses `execFile`, `Promise.all` for independent calls, `--no-optional-locks` for status, and bounded per-call timeouts.
- Focus refinement children set `CLAUDE_RECALL_REFINING=1`; hooks skip work when this env var is set.
- `PostCompact` compact summary takes precedence over transcript tail.
- `shouldRefine()` uses a 5s debounce window, with optimistic `lastRefinedAt` writes to narrow concurrent spawns.
- Runtime code should not add external dependencies without an explicit reason; the plugin is designed to run from committed `dist/`.

## Coding Conventions

- TypeScript strict mode is enabled.
- ESM imports use `.js` extensions in source import paths.
- Prefer Node built-ins for runtime behavior.
- Keep user-owned files under `~/.claude/claude-recall/`.
- Do not edit `dist/` directly; change `src/`, run the build, and commit generated `dist/` when behavior changes.

## Release Rules

Every behavior-affecting plugin change must include all of the following in the same commit:

1. Version bump in `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`.
2. README.md and README.ko.md updates, including the version badge and affected content.
3. CHANGELOG.md entry for the new version.
4. Rebuilt `dist/` output.

Reason: plugin cache update behavior is version-based. Without a version bump,
`/plugin marketplace update` may not pull the new code.

Docs-only changes do not require a version bump unless they alter marketplace-facing metadata or installation behavior.

## Setup Artifacts

- The statusline launcher script lives at `~/.claude/claude-recall/statusline-launcher.sh`.
- `/setup` merges statusline settings into `~/.claude/settings.json`.
- Bilingual user documentation is maintained in `README.md` and `README.ko.md`.
- Background LLM calls are core behavior and have no opt-out config; uninstall the plugin to stop them.
