# Changelog

## 1.10.0

- Add MIT License

## 1.9.0

- Rewrite architecture section as plain-language "How it works"

## 1.8.0

- Add detailed HUD element table to both READMEs (description + data source)

## 1.7.0

- Add split-pane preview image showing 4 parallel sessions

## 1.6.0

- Redesign preview image to show multi-session tab switching

## 1.5.0

- Restructure `/purpose` command to auto-suggest from conversation when called without arguments
- Remove `argument-hint` to prevent Claude from ignoring the empty-args flow

## 1.4.0

- Strengthen `/purpose` empty-args instruction

## 1.3.0

- Handle `/purpose` with no arguments: show current purpose instead of clearing it

## 1.2.0

- Hide sessions with `promptCount=0` from `/list`
- Reduce double output in `/list` command

## 1.1.0

- Replace `claude-recall list` CLI binary with `/list` slash command

## 1.0.0

- Initial release
- Session tracking via hooks: `SessionStart`, `UserPromptSubmit`, `SessionEnd`
- Auto-purpose detection from first prompt
- Custom-title detection from transcript
- Slash command filtering (prompts starting with `/` are ignored)
- Statusline HUD combining session state with Claude Code built-in metrics (model, context%, cost)
- CJK double-width character support
- Progressive hiding of right-side elements on narrow terminals
- Atomic state file writes (tmp + rename)
- `/setup` command for statusline configuration
- `/purpose` command for manual purpose setting
- Bilingual README (English + Korean)
- Marketplace plugin support
