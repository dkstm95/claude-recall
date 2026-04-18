# claude-recall

Claude Code plugin (v5.0.0) that provides a session awareness HUD (Heads-Up Display).
Tracks purpose, activity, git branch, and prompt count for every parallel Claude Code session.

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
  purpose.md              #   /purpose [text] — set or auto-suggest session purpose
  handoff.md              #   /handoff — write session handoff MD to ~/.claude/claude-recall/handoffs/
  setup.md                #   /setup — configure statusline & launcher script
hooks/
  hooks.json              # Hook registration (SessionStart, UserPromptSubmit)
src/                      # TypeScript source
  config.ts               #   HudConfig interface, theme colors, config file reader
  state.ts                #   SessionState interface, read/write JSON, cleanup, git branch
  format.ts               #   2-line HUD formatter, CJK double-width support, progressive truncation
  statusline.ts           #   Entry point: stdin JSON -> formatHud() -> stdout
  stdin.ts                #   Async stdin reader utility
  hooks/
    session-start.ts      #   Initialize/resume session, cleanup old sessions (>7d)
    prompt-submit.ts      #   Track prompts, auto-purpose on 1st prompt, update branch
dist/                     # Compiled JS (committed, do NOT edit directly)
assets/                   # SVG preview images for marketplace
```

## Data Flow

```
SessionStart event -> session-start.ts -> creates/updates ~/.claude/claude-recall/sessions/{id}.json
UserPromptSubmit   -> prompt-submit.ts  -> increments promptCount, auto-purpose, updates branch
Statusline render  -> statusline.ts     -> reads session JSON + stdin metrics -> 2-line HUD output
/purpose command   -> purpose.md        -> manual set or AI-generated from transcript
/handoff command   -> handoff.md        -> writes structured handoff MD file for a fresh session
```

## Session State Schema

Key fields in `~/.claude/claude-recall/sessions/{sessionId}.json`:

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | Unique session ID |
| purpose | string | Session description (max 60 chars for auto) |
| purposeSource | 'auto' \| 'manual' \| 'rename' | How purpose was set |
| branch | string | Current git branch |
| cwd | string | Working directory at session start |
| promptCount | number | Total user prompts (excludes slash commands) |
| lastUserPrompt | string | Last prompt text (first 200 chars) |
| lastActivityAt | string | ISO timestamp of last activity (drives 7-day cleanup) |

## HUD Layout

```
Line 1 (stable):   ▍ [purpose] (try /purpose|/handoff) [worktree] [branch] [model]
Line 2 (dynamic):  ▍ [#turn last_prompt] [elapsed] [context%] [$cost] [rate_limits]
```

- Accent bar prefix (`▍`) with session-specific color (deterministic hash of cwd+branch)
- Purpose: cyan+bold, prompt: bold — clear visual hierarchy (customizable via theme)
- Context %: green (<70%), yellow (70-89%), red (≥90%)
- Context ≥ 90%: cost replaced by red `⚠ try /handoff` warning
- Line 2 only appears after the first prompt
- `/purpose` hint shows after 5+ prompts when purposeSource is 'auto'; takes priority
- `/handoff` hint shows on Line 1 when context is 70-89% (yields to `/purpose` hint and to the ≥90% warning)
- `worktree` slot renders `⎇ <basename>` from stdin `workspace.git_worktree` — opt-in via config
- `rate_limits` slot renders `5h:NN%` from stdin `rate_limits.five_hour`, suppressed <50, yellow 50-79, red ≥80 — opt-in via config
- Elapsed source: stdin `cost.total_duration_ms` when present, else `state.lastActivityAt`
- Progressive truncation: right-side elements drop on narrow terminals
- Minimum widths: purpose >= 15 cols, prompt >= 15 cols
- Configurable via `~/.claude/claude-recall/config.json` (line1/line2 slots, theme)

## Key Patterns

- **Atomic writes**: `writeState()` writes to `.tmp` file, then `rename()` (crash-safe)
- **Graceful degradation**: Hooks always output `{}` even on error; statusline exits silently on missing data
- **CJK-aware**: `displayWidth()` and `isWide()` in format.ts handle double-width characters
- **Slash command filtering**: prompt-submit.ts ignores prompts starting with `/`
- **Lazy cleanup**: Sessions idle for >7 days (by `lastActivityAt`) are cleaned on SessionStart, not continuously
- **Rename detection**: statusline.ts reads `input.session_name` (from `/rename` or `--name`) and atomically updates `state.purpose` with `purposeSource='rename'` when it differs; never overwrites `manual` purposes
- **Stdin-first elapsed**: statusline prefers `cost.total_duration_ms` from stdin over self-tracked timestamps
- **Legacy field tolerance**: state.ts declares only 8 canonical fields; old JSON files with removed fields (`pid`, `status`, `startedAt`, `model`, `purposeSetAt`, `lastUserPromptAt`) still parse — extras are silently dropped on rewrite
- **Git call optimization**: branch detection runs every 10 prompts, not every prompt
- **Theme system**: ThemeColors interface abstracts all color calls; 3 presets (default, minimal, vivid)
- **Config-driven HUD**: line1/line2 element arrays control which segments render

## Coding Conventions

- TypeScript strict mode enabled
- ES module imports with `.js` extension in import paths (Node16 resolution)
- No external runtime dependencies — only Node.js built-in modules (fs, path, child_process, os)
- All async functions use try/catch with `process.exit(0)` on error in hooks
- Colors via ANSI escape codes (helper functions in format.ts: `green`, `yellow`, `dim`, `cyan`)
- State directory: `~/.claude/claude-recall/sessions/`

## Version & Release Rules

**Every change that affects plugin behavior MUST include:**
1. Version bump in ALL three files: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
2. README.md AND README.ko.md updates (version badge + any affected content)
3. CHANGELOG.md entry for the new version

Why: Plugin cache uses version to determine updates. Without a bump, `/plugin marketplace update` won't pull new code.
Do this in the same commit, not as a separate step.

## Hook Configuration

All hooks defined in `hooks/hooks.json` with:
- Matcher: `"*"` (triggers on all events)
- Timeout: 10000ms each
- Command pattern: `node "${CLAUDE_PLUGIN_ROOT}/dist/hooks/<name>.js"`

## Important Notes

- `dist/` is committed to git (users install from marketplace without building)
- The statusline launcher script lives at `~/.claude/claude-recall/statusline-launcher.sh`
- Settings are merged into `~/.claude/settings.json` by `/setup` command
- Bilingual documentation: English (README.md) + Korean (README.ko.md)
