#!/bin/bash
# A session-only development launch. No Codex config or shell profile is changed.
set -euo pipefail
umask 077
check=false
case "${1:-}" in
  --check) check=true; shift ;;
  --help|-h)
    cat <<'HELP'
Usage: launch-additive-macos.sh [--check]
Launch Codex / ChatGPT desktop with both OpenAI and Muse model options.
Older local-only worker prototype. Fully quit the app before launching.
For the shared-gateway Dock shortcut, see docs/shared-gateway-design.md.
--check validates local prerequisites without launching or changing settings.
Bootstrap's private Node and Muse tools are discovered automatically.
Overrides: MUSE_ADDITIVE_APP_PATH, MUSE_BRIDGE_ROOT, MUSE_BRIDGE_NODE_BIN,
MUSE_BRIDGE_EXECUTABLE, MUSE_ADDITIVE_STATE_DIR.
Keep the terminal open. Launch the app normally to use the standard runtime.
Local tasks only: Remote is unavailable with the combined picker.
For mobile Remote access, fully quit and reopen the app normally.
HELP
    exit 0 ;;
esac
if [[ "$#" -ne 0 ]]; then echo 'Unknown argument. Use --help or --check.' >&2; exit 2; fi
if [[ "$(uname -s)" != Darwin ]]; then echo 'This development launcher requires macOS.' >&2; exit 2; fi
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
bridge_root="${MUSE_BRIDGE_ROOT:-$HOME/.local/share/muse-bridge}"
# A bootstrap snapshot carries its install identity, including at custom roots.
if [[ -z "${MUSE_BRIDGE_ROOT:-}" && -f "$repo_dir/.muse-bridge-source.json" ]]; then bridge_root="$(dirname "$repo_dir")"; fi
if [[ "$bridge_root" != /* ]]; then echo 'MUSE_BRIDGE_ROOT must be an absolute path.' >&2; exit 2; fi
export MUSE_BRIDGE_ROOT="$bridge_root"
export MUSE_ADDITIVE_STATE_DIR="${MUSE_ADDITIVE_STATE_DIR:-$bridge_root/additive}"
export PATH="$bridge_root/runtime/bin:${PATH:-/usr/bin:/bin}:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"
app_dir="${MUSE_ADDITIVE_APP_PATH:-/Applications/ChatGPT.app}"
if [[ ! -f "$app_dir/Contents/Info.plist" ]]; then echo 'Desktop app not found. Install it first, or set MUSE_ADDITIVE_APP_PATH to its .app directory.' >&2; exit 2; fi
app_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_dir/Contents/Info.plist")"
real_codex="$app_dir/Contents/Resources/codex"
if [[ ! -x "$real_codex" || ! -x "$app_dir/Contents/MacOS/$app_executable" ]]; then echo 'This desktop app does not contain the required executables. Check MUSE_ADDITIVE_APP_PATH.' >&2; exit 2; fi
if [[ ! -f "$repo_dir/dist/muse-additive.mjs" ]]; then echo 'Adapter bundle missing. Update the bootstrap installation, or run npm run build in a development clone.' >&2; exit 2; fi
node_bin="${MUSE_BRIDGE_NODE_BIN:-$(command -v node || true)}"
if [[ -z "$node_bin" || ! -x "$node_bin" ]] || ! "$node_bin" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  echo 'Node.js 22+ is required. Run bootstrap.sh, or set MUSE_BRIDGE_NODE_BIN.' >&2; exit 2
fi
muse_bin="${MUSE_BRIDGE_EXECUTABLE:-$(command -v muse || true)}"
if [[ -z "$muse_bin" || ! -x "$muse_bin" ]]; then echo 'Muse Code is required. Run bootstrap.sh, or set MUSE_BRIDGE_EXECUTABLE.' >&2; exit 2; fi
muse_version="$("$muse_bin" --version)"
if ! "$node_bin" -e 'const v=process.argv[1].match(/\b(\d+)\.(\d+)\.(\d+)\b/); process.exit(v && (+v[1]>1 || (+v[1]===1 && (+v[2]>0 || +v[3]>=3))) ? 0 : 1)' "$muse_version"; then
  echo 'Muse Code 1.0.3+ is required. Update it and rerun the launcher.' >&2; exit 2
fi
node_bin="$("$node_bin" -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$node_bin")"
export MUSE_BRIDGE_EXECUTABLE="$("$node_bin" -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$muse_bin")"
if [[ "$check" = true ]]; then
  echo 'Local prerequisites passed. No app was launched and no settings were changed. Muse login and account access were not checked.'
  exit 0
fi
# A running Electron instance would ignore the new process environment.
if /bin/ps -axo comm= | /usr/bin/awk -v target="$app_dir/Contents/MacOS/$app_executable" '$0 == target { found = 1 } END { exit !found }'; then
  echo 'Fully quit the desktop app first, then run this launcher again. No running app was interrupted.' >&2; exit 2
fi
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
echo 'Local tasks only: Remote is unavailable in this session. Fully quit and reopen normally for mobile Remote access; the Muse MCP plugin remains installed.'
echo 'OpenAI and Muse selection has been tested on macOS. Automatic picker refresh and broader desktop compatibility remain under test.'
"$app_dir/Contents/MacOS/$app_executable"
