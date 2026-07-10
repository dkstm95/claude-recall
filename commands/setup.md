---
description: "Configure claude-recall statusline and verify plugin setup"
allowed-tools: [Read, Write, Glob, Bash]
---

You are helping the user set up the claude-recall statusline plugin.

Follow these steps:

1. Read `~/.claude/settings.json` to check the current configuration.

2. Resolve the current plugin root from the expanded `${CLAUDE_PLUGIN_ROOT}` value supplied to this plugin command.
   - Verify that `<plugin-root>/dist/statusline.js` exists.
   - Do not use the current working directory as a fallback; it is the user's project, not the plugin root.

3. Create the private state directory first:
   ```bash
   mkdir -p "$HOME/.claude/claude-recall"
   chmod 700 "$HOME/.claude/claude-recall"
   ```
   Write the absolute plugin root from step 2 as the only line in `~/.claude/claude-recall/plugin-root` and set that file to mode `600`.

4. **Create a launcher script** at `~/.claude/claude-recall/statusline-launcher.sh` with this exact content:
   ```bash
   #!/bin/bash
   STATE_DIR="${HOME}/.claude/claude-recall"
   CACHE_ROOT="${CLAUDE_CODE_PLUGIN_CACHE_DIR:-${HOME}/.claude/plugins/cache}"
   STORED_ROOT=$(sed -n '1p' "${STATE_DIR}/plugin-root" 2>/dev/null)
   DIR=""

   case "${STORED_ROOT}/" in
     "${CACHE_ROOT}/"*) ;;
     *)
       if [ -f "${STORED_ROOT}/dist/statusline.js" ]; then
         DIR="${STORED_ROOT}"
       fi
       ;;
   esac

   if [ -z "${DIR}" ]; then
     DIR=$(find "${CACHE_ROOT}" -path '*/claude-recall/*/dist/statusline.js' -type f 2>/dev/null | sed 's#/dist/statusline.js$##' | sort -V | tail -1)
   fi

   if [ -z "${DIR}" ] && [ -f "${STORED_ROOT}/dist/statusline.js" ]; then
     DIR="${STORED_ROOT}"
   fi

   [ -n "${DIR}" ] || exit 0
   exec node "${DIR}/dist/statusline.js"
   ```
   Make it executable: `chmod +x ~/.claude/claude-recall/statusline-launcher.sh`

5. Merge the statusLine configuration into `~/.claude/settings.json`:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash ~/.claude/claude-recall/statusline-launcher.sh",
       "padding": 1,
       "refreshInterval": 30
     }
   }
   ```
   Preserve all existing settings — only add/update the `statusLine` key.
   - `padding: 1` adds one column of horizontal breathing room around the statusline.
   - `refreshInterval: 30` re-runs the statusline every 30 seconds so the Line 2 elapsed clock stays accurate while the main session is idle. Remove the field to disable idle refreshes.

6. Verify that these files exist (relative to plugin root found in step 2):
   - `hooks/hooks.json`
   - `dist/statusline.js`
   - `dist/hooks/session-start.js`
   - `dist/hooks/prompt-submit.js`
   - `dist/hooks/cwd-changed.js`
   - `dist/hooks/trigger-refinement.js`

7. Report what was configured and tell the user to **restart Claude Code** for the statusline to take effect. Mention that future marketplace updates will be picked up automatically without running `/claude-recall:setup` again, while `--plugin-dir` development runs keep using the explicitly stored local root.
