# claude-recall

Claude Code plugin (v6.0.0) that provides a session awareness statusline.
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
  refine.ts               #   Haiku subprocess wrapper: spawnRefinement + triggerFocusRefinement + 5s debounce
  hooks/
    session-start.ts      #   Initialize/resume session, cleanup old sessions (>7d)
    prompt-submit.ts      #   Track prompts, update git status, trigger focus refinement at power-of-2 turns
    pre-compact.ts        #   Refine focus before context compaction
    session-end.ts        #   Refine focus at session end (final snapshot)
dist/                     # Compiled JS (committed, do NOT edit directly)
assets/                   # SVG preview images for marketplace
```

## Data Flow

```
SessionStart event -> session-start.ts -> creates/updates ~/.claude/claude-recall/sessions/{id}.json
UserPromptSubmit   -> prompt-submit.ts  -> increments promptCount, updates git status, triggers focus refinement at 2^k turns
PreCompact         -> pre-compact.ts    -> triggers focus refinement (natural milestone)
SessionEnd         -> session-end.ts    -> triggers focus refinement (final snapshot)
Statusline render  -> statusline.ts     -> reads session JSON + stdin metrics -> 1-3 line statusline output
/handoff command   -> handoff.md        -> writes structured handoff MD file for a fresh session
```

Focus refinement path:
```
trigger -> refine.ts::triggerFocusRefinement (5s debounce via lastRefinedAt)
         -> spawn `claude -p --model=haiku --tools "" --no-session-persistence ...`
            with env CLAUDE_RECALL_REFINING=1 (prevents recursive plugin hook firing in child)
         -> 30s timeout; output text -> state.focus OR refinementError
```

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
| refinementError | RefinementError \| null | `{ code: 'timeout' \| 'rate_limit' \| 'auth' \| 'unknown', at }` |

`GitStatus` fields: `branch`, `dirty`, `ahead` (vs origin/default), `behind` (vs origin/default), `defaultBranch`.

## Statusline Layout

```
Line 1 (stable):   ▍ [focus|error-label] (try /handoff) [worktree] [branch*↑N↓N] [model]
Line 2 (dynamic):  ▍ [#turn last_prompt]                           [elapsed] [context%]
Line 3 (opt-out):  ▍ 5h ████░░░░░░ 45%   7d ██░░░░░░░░ 20%   $0.03
```

- Accent bar prefix (`▍`) with session-specific color (deterministic hash of cwd+branch)
- Focus: cyan+bold (default theme), replaced by red `⚠ AI <reason>` when `refinementError` is set
- Prompt: bold — clear visual hierarchy (customizable via theme)
- Context %: green (<70%), yellow (70-89%), red (≥90%)
- Context ≥ 90%: `⚠ try /handoff` red warning in context slot
- Line 2 only appears after the first prompt
- `/handoff` hint shows on Line 1 when context is 70-89% (yields to the ≥90% warning)
- `worktree` slot renders `⎇ <basename>` from stdin `workspace.git_worktree` — opt-in via config
- `branch` slot renders `branch[*][↑N][↓N]` — dirty flag + ahead/behind vs `origin/<default>`. 0-count arrows suppressed.
- `line3` slot renders rate_limits bars + 7d + cost. Hidden when no rate_limits data. Opt out with `line3: []`.
- Elapsed source: stdin `cost.total_duration_ms` when present, else `state.lastActivityAt`
- Progressive truncation: right-side elements drop on narrow terminals
- Minimum widths: focus >= 15 cols, prompt >= 30 cols (raised from 15 in v5)
- Prompt 80-col hard cap removed — last prompt now claims most of Line 2
- Configurable via `~/.claude/claude-recall/config.json` (line1/line2/line3 slots, gitStatus toggles, theme)

## Key Patterns

- **Atomic writes**: `writeState()` writes to `.tmp` file, then `rename()` (crash-safe)
- **Graceful degradation**: Hooks always output `{}` even on error; statusline exits silently on missing data
- **CJK-aware**: `displayWidth()` and `isWide()` in format.ts handle double-width characters
- **Slash command filtering**: prompt-submit.ts ignores prompts starting with `/`
- **Lazy cleanup**: Sessions idle for >7 days (by `lastActivityAt`) are cleaned on SessionStart, not continuously
- **Legacy field tolerance**: `readState()` migrates `purpose` → `focus` on read and silently drops `purposeSource`; canonical schema is rewritten on next `writeState()`
- **Stdin-first elapsed**: statusline prefers `cost.total_duration_ms` from stdin over self-tracked timestamps
- **Git call optimization**: full git status runs every 10 prompts (`% 10 === 1`), not every prompt
- **Theme system**: `ThemeColors` interface abstracts all color calls; 3 presets (default, minimal, vivid)
- **Config-driven statusline**: line1/line2/line3 element arrays control which segments render. Legacy `'purpose'` slot names map to `'focus'`.
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
- `SessionStart` / `UserPromptSubmit` — timeout 10s (fast path, must finish quickly)
- `PreCompact` / `SessionEnd` — timeout 35s (allows 30s Haiku call + overhead)
- Matcher: `"*"` (triggers on all events)
- Command pattern: `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js"`

## Important Notes

- `dist/` is committed to git (users install from marketplace without building)
- The statusline launcher script lives at `~/.claude/claude-recall/statusline-launcher.sh`
- Settings are merged into `~/.claude/settings.json` by `/setup` command
- Bilingual documentation: English (README.md) + Korean (README.ko.md)
- Background LLM calls are core behavior; no opt-out config. Uninstall to stop.
