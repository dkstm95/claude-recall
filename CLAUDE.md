# claude-recall Agent Guide

This file is intentionally limited to instructions for coding agents working in
this repository. Canonical project facts live in
[`docs/PROJECT.md`](docs/PROJECT.md).

## Start Here

Before making non-trivial changes, read the relevant sections of
`docs/PROJECT.md`:

- Architecture and data flow
- Session state schema
- Statusline layout and width/drop priority
- Configuration and hook behavior
- Key invariants
- Release rules

If this file and `docs/PROJECT.md` conflict, treat `docs/PROJECT.md`
as the source of truth and update this file to remove the conflict.

## Working Rules

- Change `src/` first. Do not edit `dist/` directly.
- Run `npm run build` after behavior changes and include generated `dist/`
  updates in the same change.
- Run `npm test` before handing off when dependencies are available.
- Keep runtime dependencies out of the plugin unless there is a deliberate
  project decision to add one.
- Preserve graceful degradation: hooks should always return `{}`, and
  statusline failures should not interrupt Claude Code.
- Preserve user-owned state under `~/.claude/claude-recall/`; do not delete or
  rewrite user data as part of migrations unless a release note explicitly
  calls for it.
- Keep README.md and README.ko.md aligned for user-facing changes.

## Change Checklist

For behavior-affecting changes:

1. Update source in `src/`.
2. Add or adjust focused tests in `test/`.
3. Run `npm run build`.
4. Run `npm test`.
5. Apply the release rules from `docs/PROJECT.md`.

For docs-only changes:

1. Keep canonical project facts in `docs/PROJECT.md`.
2. Keep `CLAUDE.md` limited to agent workflow guidance.
3. Update README.md and README.ko.md together when user-facing docs change.
