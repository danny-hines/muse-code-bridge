#!/bin/bash
# A session-only development launch. No Codex config or shell profile is changed.
set -euo pipefail
umask 077
if [[ "$(uname -s)" != Darwin ]]; then echo 'This development launcher requires macOS.' >&2; exit 2; fi
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="${MUSE_ADDITIVE_APP_PATH:-/Applications/ChatGPT.app}"
app_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_dir/Contents/Info.plist")"
real_codex="$app_dir/Contents/Resources/codex"
if [[ ! -x "$real_codex" || ! -f "$repo_dir/dist/muse-additive.mjs" ]]; then echo 'Build the repository first, and check the desktop app path.' >&2; exit 2; fi
# A running Electron instance would ignore the new process environment.
if /bin/ps -axo comm= | /usr/bin/awk -v target="$app_dir/Contents/MacOS/$app_executable" '$0 == target { found = 1 } END { exit !found }'; then
  echo 'Fully quit the desktop app first, then run this launcher again. No running app was interrupted.' >&2; exit 2
fi
node_bin="${MUSE_BRIDGE_NODE_BIN:-$(command -v node || true)}"
if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then echo 'Node.js 22+ is required.' >&2; exit 2; fi
launch_dir="$(mktemp -d "${TMPDIR:-/tmp}/muse-additive-launch.XXXXXXXX")"
# This script owns only its temporary launch directory.
trap '"$node_bin" -e '\''require("fs").rmSync(process.argv[1], {recursive:true, force:true})'\'' "$launch_dir"' EXIT
export MUSE_ADDITIVE_CODEX_BIN="$real_codex"
export MUSE_ADDITIVE_NODE_BIN="$node_bin"
export MUSE_ADDITIVE_ENTRYPOINT="$repo_dir/dist/muse-additive.mjs"
cat > "$launch_dir/codex" <<'WRAPPER'
#!/bin/bash
exec "$MUSE_ADDITIVE_NODE_BIN" "$MUSE_ADDITIVE_ENTRYPOINT" "$@"
WRAPPER
chmod 700 "$launch_dir/codex"
export CODEX_CLI_PATH="$launch_dir/codex"
export CODEX_APP_SERVER_FORCE_CLI=1
echo 'Launching the additive prototype for this app session. Keep this terminal open.'
echo 'Desktop picker visibility and refresh are still under test. Reopen the app normally to return to the standard runtime.'
"$app_dir/Contents/MacOS/$app_executable"
