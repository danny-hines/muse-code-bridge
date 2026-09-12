#!/bin/sh
# Install selected host integrations from a checkout; bootstrap.sh fetches dependencies.
set -eu
hosts='' check=false login=false opencode_version=auto auth='' key_file='' skills='' list_skills=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --auth|--api-key-file|--skills)
      [ "$#" -ge 2 ] || { echo "$1 requires a value." >&2; exit 2; }
      case "$2" in --*|'') echo "$1 requires a value." >&2; exit 2 ;; esac
      case "$1" in --auth) auth=$2 ;; --api-key-file) key_file=$2 ;; --skills) skills=$2 ;; esac
      shift ;;
    --host)
      [ "$#" -ge 2 ] || { echo '--host needs codex, hermes, or opencode.' >&2; exit 2; }
      case "$2" in codex|hermes|opencode) hosts="$hosts $2" ;; *) echo "Unknown host: $2" >&2; exit 2 ;; esac
      shift ;;
    --opencode-version)
      [ "$#" -ge 2 ] || { echo '--opencode-version needs 1, 2, or auto.' >&2; exit 2; }
      case "$2" in 1|2|auto) opencode_version=$2 ;; *) echo 'OpenCode version must be 1, 2, or auto.' >&2; exit 2 ;; esac
      shift ;;
    --check) check=true ;;
    --list-skills) list_skills=true ;;
    --login) login=true ;;
    --help|-h)
      cat <<'HELP'
Usage: ./install.sh [--host codex|hermes|opencode] [--check] [--login]
                    [--opencode-version auto|1|2] [--auth account|api-key]
                    [--api-key-file /absolute/private/key-file]
                    [--skills all|core|none|implement,review] [--list-skills]
Repeat --host to configure several apps. Default: codex.
Requires Node.js 22+ and Muse Code 1.0.3+; Codex also requires the Codex CLI.
--check validates prerequisites and configuration without changing settings.
--login opens the official Muse browser login.
--auth selects Muse-managed credentials (account) or explicit API billing.
API mode requires --api-key-file; only its path is saved, never the key itself.
Omitting --auth preserves the current choice; a fresh install defaults to account.
Codex bundles all skills. Hermes/OpenCode accept --skills; omitted selections
are preserved on updates and default to all on a fresh installation.
--skills none removes only unmodified skills installed by this installer.
--list-skills lists the collection without checking Muse or changing settings.
OpenCode version is detected from its CLI or existing MCP config; specify it
explicitly if neither is available. Version 2 refers to the OpenCode 2 beta.
Executable overrides: MUSE_BRIDGE_NODE_BIN, MUSE_BRIDGE_EXECUTABLE,
MUSE_BRIDGE_CODEX_BIN, MUSE_BRIDGE_OPENCODE_BIN.
Config overrides: MUSE_BRIDGE_HERMES_CONFIG, MUSE_BRIDGE_OPENCODE_CONFIG.
Skill directory overrides: MUSE_BRIDGE_HERMES_SKILLS_DIR,
MUSE_BRIDGE_OPENCODE_SKILLS_DIR. Hermes also respects HERMES_HOME.
HELP
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
hosts=${hosts:-codex}
case "$skills" in ''|all|core|none|implement|review|implement,review|review,implement) ;; *) echo 'Invalid --skills selection. Use all, core, none, implement, or review (comma-separated).' >&2; exit 2 ;; esac
for host in $hosts; do
  if [ "$host" = codex ] && [ -n "$skills" ] && [ "$skills" != all ]; then
    echo 'Codex bundles all skills; selective --skills applies to Hermes/OpenCode.' >&2; exit 2
  fi
done
[ "$check:$login" != true:true ] || { echo '--check and --login cannot be combined.' >&2; exit 2; }
case "$auth" in ''|account|api-key) ;; *) echo '--auth must be account or api-key.' >&2; exit 2 ;; esac
[ -z "$key_file" ] || [ "$auth" = api-key ] || { echo '--api-key-file requires --auth api-key.' >&2; exit 2; }
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATH="${PATH:-/usr/bin:/bin}:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"
export PATH
node_bin=${MUSE_BRIDGE_NODE_BIN:-$(command -v node || true)}
if [ "$list_skills" = true ]; then
  [ -n "$node_bin" ] && [ -x "$node_bin" ] || { echo 'Node.js is required to list the skill catalog from a checkout.' >&2; exit 1; }
  exec "$node_bin" "$repo_dir/dist/configure-skills.mjs" --list
fi
muse_bin=${MUSE_BRIDGE_EXECUTABLE:-$(command -v muse || true)}
[ -n "$node_bin" ] && [ -x "$node_bin" ] || { echo 'Node.js 22+ is required. Use bootstrap.sh to install dependencies.' >&2; exit 1; }
"$node_bin" -e 'process.exit(+process.versions.node.split(".")[0]>=22 ? 0:1)' || { echo 'Node.js 22+ is required.' >&2; exit 1; }
[ -n "$muse_bin" ] && [ -x "$muse_bin" ] || { echo 'Muse Code 1.0.3+ is required. Use bootstrap.sh to install it.' >&2; exit 1; }
version=$("$muse_bin" --version)
"$node_bin" -e 'const v=process.argv[1].match(/\b(\d+)\.(\d+)\.(\d+)\b/); if(!v || +v[1]<1 || (+v[1]===1 && +v[2]===0 && +v[3]<3)) {console.error("Muse Code 1.0.3 or newer is required.");process.exit(1)}' "$version"
"$muse_bin" serve --help >/dev/null
node_bin=$("$node_bin" -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$node_bin")
muse_bin=$("$node_bin" -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$muse_bin")
export MUSE_BRIDGE_NODE_BIN="$node_bin" MUSE_BRIDGE_EXECUTABLE="$muse_bin"

configure_auth() {
  mode=$1
  set -- "$node_bin" "$repo_dir/dist/configure-auth.mjs"
  [ -z "$auth" ] || set -- "$@" --auth "$auth"
  [ -z "$key_file" ] || set -- "$@" --api-key-file "$key_file"
  [ "$login" != true ] || set -- "$@" --login
  [ "$mode" != check ] || set -- "$@" --check
  "$@"
}

configure_host() {
  host=$1; mode=$2
  if [ "$host" = codex ]; then
    if [ "$mode" = check ]; then /bin/sh "$repo_dir/integrations/codex/install.sh" --check
    else /bin/sh "$repo_dir/integrations/codex/install.sh"; fi
  else
    set -- "$node_bin" "$repo_dir/dist/configure-host.mjs" --host "$host" --repo "$repo_dir" --node "$node_bin" --muse "$muse_bin" --opencode-version "$opencode_version"
    [ "$mode" != check ] || set -- "$@" --check
    "$@"
  fi
}
configure_skills() {
  host=$1; mode=$2
  set -- "$node_bin" "$repo_dir/dist/configure-skills.mjs" --host "$host" --repo "$repo_dir"
  [ -z "$skills" ] || set -- "$@" --skills "$skills"
  [ "$mode" != check ] || set -- "$@" --check
  "$@"
}
# Preflight every selected host before writing any host configuration.
configure_auth check
for host in $hosts; do configure_host "$host" check; configure_skills "$host" check; done
if [ "$check" = true ]; then
  echo 'Prerequisites passed. No settings changed; login and subscription status were not checked.'
  exit 0
fi
if [ "$login" = true ]; then (unset META_API_KEY; "$muse_bin" login </dev/null); fi
configure_auth install
for host in $hosts; do configure_host "$host" install; configure_skills "$host" install; done
echo 'Muse Code Bridge is ready. Restart the selected host and start a new local conversation.'
echo 'Ask: Use Muse to review this project. Muse is a collaborator, not a new entry in the model picker.'
echo 'For delegated implementation, ask: Use muse-implement to implement this task; you own scope and final verification.'
