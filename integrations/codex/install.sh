#!/bin/sh
# Install the bundled plugin from this checkout. Does not download dependencies.
set -eu

usage() {
  cat <<'EOF'
Usage: ./install.sh [--check] [--login]

  --check  Check prerequisites and package contents without changing settings.
  --login  Run the official Muse login flow before installing the plugin.
  --help   Show this help.

Requires Node.js 22+, Muse Code 1.0.3+, and the Codex CLI.
Optional executable overrides: MUSE_BRIDGE_NODE_BIN, MUSE_BRIDGE_CODEX_BIN,
MUSE_BRIDGE_EXECUTABLE. Each must identify a single executable, not a command.
EOF
}

check_only=false
login=false
for option in "$@"; do
  case "$option" in
    --check) check_only=true ;;
    --login) login=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $option" >&2; usage >&2; exit 2 ;;
  esac
done
if [ "$check_only" = true ] && [ "$login" = true ]; then
  echo '--check and --login cannot be combined.' >&2
  exit 2
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
PATH="${PATH:-/usr/bin:/bin}:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"
export PATH

node_bin=${MUSE_BRIDGE_NODE_BIN:-$(command -v node || true)}
codex_bin=${MUSE_BRIDGE_CODEX_BIN:-$(command -v codex || true)}
muse_bin=${MUSE_BRIDGE_EXECUTABLE:-$(command -v muse || true)}

if [ -z "$node_bin" ] || [ ! -x "$node_bin" ]; then
  echo 'Node.js is missing. Install Node.js 22+ from https://nodejs.org/ and rerun this script.' >&2
  exit 1
fi
if ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'Muse Code Bridge requires Node.js 22 or newer.' >&2
  exit 1
fi
if [ -z "$muse_bin" ] || [ ! -x "$muse_bin" ]; then
  echo 'Muse Code is missing. Install it from https://developer.meta.com/ai/lp/muse-code/ and rerun this script.' >&2
  exit 1
fi
if [ -z "$codex_bin" ] || [ ! -x "$codex_bin" ]; then
  echo 'The Codex CLI is missing. See https://developers.openai.com/codex/cli/ or set MUSE_BRIDGE_CODEX_BIN to its executable.' >&2
  exit 1
fi

muse_version=$("$muse_bin" --version)
"$node_bin" -e '
  const v = process.argv[1].match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!v || Number(v[1]) < 1 || (Number(v[1]) === 1 && Number(v[2]) === 0 && Number(v[3]) < 3)) {
    console.error("Muse Code 1.0.3 or newer is required."); process.exit(1);
  }
' "$muse_version"
"$muse_bin" serve --help >/dev/null
"$codex_bin" plugin marketplace add --help >/dev/null

"$node_bin" --input-type=module - "$repo_dir" <<'JS'
import { readFileSync, accessSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const marketplace = read('.agents/plugins/marketplace.json');
const plugin = read('plugins/muse-codex-bridge/.codex-plugin/plugin.json');
if (marketplace.name !== 'muse-code-bridge' || plugin.name !== 'muse-codex-bridge' ||
    !marketplace.plugins.some(p => p.name === 'muse-codex-bridge' && p.source.path === './plugins/muse-codex-bridge')) {
  throw new Error('Unexpected plugin/marketplace identity. Re-download the repository.');
}
for (const path of ['scripts/server.mjs', 'scripts/launch.sh', 'skills/muse/SKILL.md', '.mcp.json']) {
  accessSync(join(root, 'plugins/muse-codex-bridge', path));
}
console.log(`Package checked: Muse Code Bridge ${plugin.version}`);
JS
echo "Muse checked: $muse_version"
echo "Node checked: $("$node_bin" --version)"

# Avoid activating two copies of the same tools under different marketplaces.
installed_plugins=$("$codex_bin" plugin list --json)
printf '%s\n' "$installed_plugins" | "$node_bin" --input-type=module -e '
  let data = ""; for await (const chunk of process.stdin) data += chunk;
  const list = JSON.parse(data);
  if (!Array.isArray(list.installed)) throw new Error("Unexpected Codex plugin inventory; no changes made.");
  const existing = list.installed.find(p => (["muse-bridge", "muse-codex-bridge"].includes(p.name)) && !(p.name === "muse-codex-bridge" && p.marketplaceName === "muse-code-bridge"));
  if (existing) {
    console.error(`Muse Code Bridge is already installed from ${existing.marketplaceName}.`);
    console.error("Remove that copy from the desktop Plugins screen, then rerun this script to switch to the repository version. Your Muse sessions are retained.");
    process.exit(1);
  }
'

if [ "$check_only" = true ]; then
  echo 'Prerequisites passed. No settings changed; login and subscription status were not checked.'
  exit 0
fi

if [ "$login" = true ]; then
  # Muse documents META_API_KEY as taking precedence over account login.
  (unset META_API_KEY; exec "$muse_bin" login)
fi

"$codex_bin" plugin marketplace add "$repo_dir"
"$codex_bin" plugin add muse-codex-bridge@muse-code-bridge
echo
echo 'Muse Code Bridge installed. Start a NEW local conversation in ChatGPT desktop.'
echo 'Enable the Muse Code Bridge plugin (not the model picker) and ask: Ask Muse to review my changes.'
echo 'If you have not signed in to Muse yet, run muse login or rerun ./install.sh --login.'
echo 'Keep this checkout; run git pull --ff-only and ./install.sh to update.'
