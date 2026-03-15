---
description: "Configure claude-recall statusline and verify plugin setup"
allowed-tools: [Read, Write, Glob]
---

You are helping the user set up the claude-recall statusline plugin.

Follow these steps:

1. Read `~/.claude/settings.json` to check the current configuration.

2. Find the plugin root path by searching for `claude-recall` under `~/.claude/plugins/cache/`. Look for any directory that contains `dist/statusline.js`.
   - Use Glob to search: `~/.claude/plugins/cache/**/claude-recall/**/dist/statusline.js`
   - Extract the plugin root from the matched path (everything before `/dist/statusline.js`)
   - If not found in cache, fall back to the current working directory

3. Merge the statusLine configuration into `~/.claude/settings.json`:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node <plugin_root_path>/dist/statusline.js"
     }
   }
   ```
   Preserve all existing settings — only add/update the `statusLine` key.

4. Verify that these files exist (relative to plugin root):
   - `hooks/hooks.json`
   - `dist/statusline.js`
   - `dist/hooks/session-start.js`
   - `dist/hooks/prompt-submit.js`
   - `dist/hooks/session-end.js`

5. Report what was configured and tell the user to **restart Claude Code** for the statusline to take effect.
