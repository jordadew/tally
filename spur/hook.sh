#!/bin/bash
# Claude Code UserPromptSubmit hook (added by `tally spur install`): Spur decides in the background
# whether to pop up, so prompts are never slowed. Only inside herdr or tmux, where it can open a popup.
[[ -n $HERDR_PANE_ID || -n $TMUX ]] || exit 0
( node "$(dirname "$0")/../bin/tally.mjs" spur check ${1:+--config "$1"} >/dev/null 2>&1 & )
exit 0
