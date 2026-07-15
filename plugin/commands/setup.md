---
description: "Configure claude-recall statusline and pin its Claude Code runtime"
allowed-tools: [Bash]
---

Configure this plugin by running its bundled setup helper:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/setup.js"
```

If the command invocation includes `$ARGUMENTS`, treat it only as a requested
absolute Claude executable path and pass it as one separately quoted argument:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/setup.js" --claude-executable "$ARGUMENTS"
```

The helper performs the complete setup transaction. It:

- validates the current plugin installation,
- verifies the existing private pin or the official native default launcher,
- stores its stable absolute launcher path in the private
  `${CLAUDE_CONFIG_DIR:-~/.claude}/claude-recall/runtime.json`,
- installs the registry-aware statusline launcher, and
- merges `statusLine` into the existing Claude settings without replacing
  unrelated settings.

Do not recreate these steps manually when the helper succeeds.

The helper intentionally does not search PATH. If no official native launcher
is found (for example, a Homebrew or distro-package installation), show the
error and ask the user to confirm the trusted absolute `claude` launcher path.
After the user chooses, rerun the helper with that path as one safely quoted
argument:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/setup.js" --claude-executable "/absolute/path/to/claude"
```

Never choose a project-local or temporary executable and never fall back to a
bare `claude` command. If verification fails, report the helper's error and
leave the existing settings intact.

On success, report the selected Claude executable, runtime pin, launcher, and
settings paths printed by the helper. Tell the user to **restart Claude Code**
so the updated launcher and hooks take effect.
