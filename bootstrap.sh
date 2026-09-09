#!/usr/bin/env bash
# Keep execution in a function so a truncated curl download cannot run half a setup.
main() {
  set -euo pipefail
  umask 077
  local root="${MUSE_BRIDGE_ROOT:-$HOME/.local/share/muse-bridge}"
  local ref=main login=auto node_bin muse_bin codex_bin="" npm_bin work os arch archive expected actual
  local wants_codex=false opencode_version=auto
  local -a host_args=()
  local node_base=https://nodejs.org/dist/latest-v22.x
  local repository=danny-hines/muse-code-bridge
  local arg
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --host)
        [[ "$#" -ge 2 ]] || { echo '--host needs codex, hermes, or opencode.' >&2; return 2; }
        case "$2" in codex) wants_codex=true ;; hermes|opencode) ;; *) echo "Unknown host: $2" >&2; return 2 ;; esac
        host_args+=(--host "$2"); shift ;;
      --opencode-version)
        [[ "$#" -ge 2 ]] || { echo '--opencode-version needs 1, 2, or auto.' >&2; return 2; }
        case "$2" in 1|2|auto) opencode_version="$2" ;; *) echo 'OpenCode version must be 1, 2, or auto.' >&2; return 2 ;; esac
        shift ;;
      --login) login=yes ;;
      --no-login) login=no ;;
      --help|-h)
        printf '%s\n' 'Usage: bootstrap.sh [--host codex|hermes|opencode] [--login | --no-login]' \
          'Repeat --host for several apps. Defaults to codex.' \
          'Fetch Muse Code Bridge; install missing Node.js and Muse Code locally.' \
          'Only the Codex integration installs the Codex CLI. Host desktop apps must already be installed.' \
          'Existing compatible tools are reused. No sudo or shell-profile edits.' \
          '--opencode-version auto|1|2: use 2 for the beta; default auto.' \
          '--login: always run Muse login. --no-login: skip optional login.' \
          'MUSE_BRIDGE_REF selects a Git ref (default main). MUSE_BRIDGE_ROOT changes the local install root.'
        return 0 ;;
      *) printf 'Unknown option: %s\n' "$1" >&2; return 2 ;;
    esac
    shift
  done
  if [[ "${#host_args[@]}" -eq 0 ]]; then host_args=(--host codex); wants_codex=true; fi
  ref="${MUSE_BRIDGE_REF:-$ref}"
  case "$root" in /*) ;; *) echo 'MUSE_BRIDGE_ROOT must be an absolute path.' >&2; return 1 ;; esac
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo 'Only macOS and Linux are supported.' >&2; return 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) echo 'Only arm64 and x64 are supported.' >&2; return 1 ;; esac
  for arg in curl tar awk mktemp; do command -v "$arg" >/dev/null || { echo "Required system tool missing: $arg" >&2; return 1; }; done
  mkdir -p "$root/runtime"
  if ! mkdir "$root/.bootstrap-lock" 2>/dev/null; then
    echo "Another setup may be running. If it was interrupted, remove $root/.bootstrap-lock and retry." >&2
    return 1
  fi
  work=$(mktemp -d "$root/.bootstrap.XXXXXX")
  muse_bridge_cleanup_work="$work"
  muse_bridge_cleanup_lock="$root/.bootstrap-lock"
  trap 'rm -rf -- "$muse_bridge_cleanup_work"; rmdir -- "$muse_bridge_cleanup_lock" 2>/dev/null || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export PATH="$root/runtime/bin:${PATH:-/usr/bin:/bin}:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"

  download() {
    curl --fail --silent --show-error --location --retry 2 --connect-timeout 20 \
      --proto '=https' --proto-redir '=https' --output "$2" "$1"
  }
  compatible_node() { [[ -x "$1" ]] && "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' >/dev/null 2>&1; }
  compatible_muse() {
    [[ -x "$1" ]] || return 1
    "$1" --version | "$node_bin" -e '
      let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{
        const v=s.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
        process.exit(v && (+v[1]>1 || (+v[1]===1 && (+v[2]>0 || +v[3]>=3))) ? 0 : 1);
      });' || return 1
    "$1" serve --help >/dev/null 2>&1
  }
  compatible_codex() { [[ -x "$1" ]] && "$1" plugin marketplace add --help >/dev/null 2>&1; }

  node_bin="${MUSE_BRIDGE_NODE_BIN:-$(command -v node || true)}"
  if ! compatible_node "$node_bin"; then
    echo 'Installing a private Node.js 22 runtime from nodejs.org...'
    download "$node_base/SHASUMS256.txt" "$work/checksums"
    archive=$(awk -v suffix="-$os-$arch.tar.gz" '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $2}' "$work/checksums")
    [[ "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-(darwin|linux)-(arm64|x64)\.tar\.gz$ ]] || { echo 'No compatible Node archive found.' >&2; return 1; }
    expected=$(awk -v file="$archive" '$2==file {print $1}' "$work/checksums")
    local node_version="${archive#node-}"
    node_version="${node_version%-$os-$arch.tar.gz}"
    download "https://nodejs.org/dist/$node_version/$archive" "$work/node.tar.gz"
    if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$work/node.tar.gz"); else actual=$(shasum -a 256 "$work/node.tar.gz"); fi
    [[ "${actual%% *}" = "$expected" ]] || { echo 'Node archive checksum mismatch; nothing was executed.' >&2; return 1; }
    mkdir "$work/node"
    tar -xzf "$work/node.tar.gz" -C "$work/node" --strip-components=1
    compatible_node "$work/node/bin/node" || { echo 'The downloaded Node runtime cannot run on this system.' >&2; return 1; }
    # Use a fresh directory; never overwrite a user's existing runtime.
    local node_dir
    node_dir=$(mktemp -d "$root/runtime/node.XXXXXX")
    mv "$work/node" "$node_dir/dist"
    node_bin="$node_dir/dist/bin/node"
  fi
  # Make shebangs in npm and the provider CLIs resolve this compatible Node.
  mkdir "$work/bin"
  ln -s "$node_bin" "$work/bin/node"
  export PATH="$work/bin:$PATH"
  echo "Using Node: $("$node_bin" --version)"

  # Resolve the ref once; code and the plugin then come from the same immutable commit.
  local encoded_ref sha
  encoded_ref=$("$node_bin" -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$ref")
  download "https://api.github.com/repos/$repository/commits/$encoded_ref" "$work/commit.json"
  sha=$("$node_bin" -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1])).sha; if(!/^[a-f0-9]{40}$/.test(s)) process.exit(1); process.stdout.write(s)' "$work/commit.json")
  download "https://codeload.github.com/$repository/tar.gz/$sha" "$work/repo.tar.gz"
  mkdir "$work/repo"
  tar -xzf "$work/repo.tar.gz" -C "$work/repo" --strip-components=1
  [[ -f "$work/repo/install.sh" && -f "$work/repo/scripts/prepare-bootstrap.mjs" ]] || { echo 'The downloaded repository is incomplete.' >&2; return 1; }
  # Refuse to replace modified or unrelated checkout files before installing more tools.
  "$node_bin" "$work/repo/scripts/prepare-bootstrap.mjs" check "$root" "$work/repo" "$sha"

  muse_bin="${MUSE_BRIDGE_EXECUTABLE:-$(command -v muse || true)}"
  local new_muse=false
  if ! compatible_muse "$muse_bin"; then
    echo 'Installing Muse Code using the official Meta installer...'
    download https://dev.meta.ai/install.sh "$work/muse-install.sh"
    bash -n "$work/muse-install.sh"
    local muse_login=0
    [[ "$login" != no ]] && muse_login=1
    (unset META_API_KEY MUSE_LAUNCHER_URL; MUSE_INSTALL_DIR="$root/runtime/muse/bin" MUSE_NO_MODIFY_PATH=1 MUSE_LOGIN="$muse_login" bash "$work/muse-install.sh")
    muse_bin="$root/runtime/muse/bin/muse"
    compatible_muse "$muse_bin" || { echo 'Muse installation did not produce a compatible CLI.' >&2; return 1; }
    new_muse=true
  fi

  if [[ "$wants_codex" = true ]]; then
    codex_bin="${MUSE_BRIDGE_CODEX_BIN:-$(command -v codex || true)}"
    if ! compatible_codex "$codex_bin"; then
      npm_bin="$(dirname "$node_bin")/npm"
      [[ -x "$npm_bin" ]] || npm_bin="$(command -v npm || true)"
      [[ -x "$npm_bin" ]] || { echo 'npm was not found. Install Node with npm and rerun setup.' >&2; return 1; }
      echo 'Installing the official Codex CLI privately from npm...'
      "$npm_bin" install --prefix "$root/runtime/codex" --registry=https://registry.npmjs.org \
        --no-audit --no-fund --ignore-scripts @openai/codex@0.153.4
      codex_bin="$root/runtime/codex/node_modules/.bin/codex"
      compatible_codex "$codex_bin" || { echo 'The installed Codex CLI does not support plugins.' >&2; return 1; }
    fi
  fi

  # Resolve managed symlinks on reruns so none of the runtime links point to themselves.
  node_bin=$("$node_bin" -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$node_bin")
  muse_bin=$("$node_bin" -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$muse_bin")
  if [[ -n "$codex_bin" ]]; then codex_bin=$("$node_bin" -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$codex_bin"); fi
  "$node_bin" "$work/repo/scripts/prepare-bootstrap.mjs" install "$root" "$work/repo" "$sha" "$node_bin" "$muse_bin" "$codex_bin"
  export MUSE_BRIDGE_NODE_BIN="$node_bin" MUSE_BRIDGE_EXECUTABLE="$muse_bin" MUSE_BRIDGE_CODEX_BIN="$codex_bin"
  /bin/sh "$root/repo/install.sh" "${host_args[@]}" --opencode-version "$opencode_version"

  if [[ "$login" = yes || ( "$login" = auto && "$new_muse" = true ) ]]; then
    echo 'Sign in to your Muse account through the official browser flow.'
    (unset META_API_KEY; "$muse_bin" login </dev/null)
  elif [[ "$login" != no ]] && { : </dev/tty; } 2>/dev/null; then
    local reply
    printf 'Run Muse account login now? [y/N] ' >/dev/tty
    read -r reply </dev/tty || reply=n
    if [[ "$reply" = y || "$reply" = Y ]]; then (unset META_API_KEY; "$muse_bin" login </dev/null); fi
  fi
  echo "Installed source commit: $sha"
  echo "Local source: $root/repo"
  echo 'Setup finished. Restart the selected host and start a new local conversation. Ask Muse to review your project.'
}

main "$@"
