#!/bin/sh
set -eu
# Dock-launched apps may not inherit a login shell's PATH.
PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo 'Muse Bridge requires Node.js 22 or newer. Install Node.js, then restart the desktop app.' >&2
  exit 1
fi
exec node "$plugin_dir/scripts/server.mjs"
