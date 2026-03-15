---
description: "Show all tracked Claude Code sessions"
allowed-tools: [Bash]
---

You are showing the user a list of all tracked Claude Code sessions.

Run this command and display the output to the user:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" list
```

If no sessions are found, tell the user that no sessions have been tracked yet and that sessions will appear after they start using Claude Code with the plugin installed.
