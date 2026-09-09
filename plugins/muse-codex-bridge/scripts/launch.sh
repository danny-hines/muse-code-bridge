#!/bin/sh
set -eu
# Dock-launched apps may not inherit a login shell's PATH.
runtime_bin="${MUSE_BRIDGE_ROOT:-$HOME/.local/share/muse-bridge}/runtime/bin"
PATH="$runtime_bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"
export PATH
if [ -z "${MUSE_BRIDGE_EXECUTABLE:-}" ] && [ -x "$runtime_bin/muse" ]; then
  MUSE_BRIDGE_EXECUTABLE="$runtime_bin/muse"
  export MUSE_BRIDGE_EXECUTABLE
fi
plugin_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo 'Muse Bridge requires Node.js 22 or newer. Install Node.js, then restart the desktop app.' >&2
  exit 1
fi
exec node "$plugin_dir/scripts/server.mjs"
