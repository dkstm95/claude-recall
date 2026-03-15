---
description: "Configure claude-recall statusline and verify plugin setup"
allowed-tools: [Read, Write, Glob, Bash]
---

You are helping the user set up the claude-recall statusline plugin.

Follow these steps:

1. Read `~/.claude/settings.json` to check the current configuration.

2. Find the plugin cache path by searching for `dist/statusline.js` under `~/.claude/plugins/cache/`:
   - Use Glob: `~/.claude/plugins/cache/**/claude-recall/**/dist/statusline.js`
   - If multiple versions found, pick the one with the highest version number
   - Extract the plugin root (everything before `/dist/statusline.js`)
   - If not found in cache, fall back to the current working directory

3. **Create a launcher script** at `~/.claude/claude-recall/statusline-launcher.sh` with this exact content:
   ```bash
   #!/bin/bash
   DIR=$(ls -d ~/.claude/plugins/cache/claude-recall/claude-recall/*/ 2>/dev/null | sort -V | tail -1)
   if [ -n "$DIR" ]; then
     exec node "${DIR}dist/statusline.js"
   fi
   ```
   Make it executable: `chmod +x ~/.claude/claude-recall/statusline-launcher.sh`

4. Merge the statusLine configuration into `~/.claude/settings.json`:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash ~/.claude/claude-recall/statusline-launcher.sh"
     }
   }
   ```
   Preserve all existing settings — only add/update the `statusLine` key.

5. Verify that these files exist (relative to plugin root found in step 2):
   - `hooks/hooks.json`
   - `dist/statusline.js`
   - `dist/hooks/session-start.js`
   - `dist/hooks/prompt-submit.js`
   - `dist/hooks/session-end.js`

6. Report what was configured and tell the user to **restart Claude Code** for the statusline to take effect. Mention that future plugin updates will be picked up automatically without running `/setup` again.
