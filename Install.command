#!/bin/sh
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if /bin/sh "$repo_dir/install.sh" "$@"; then
  install_status=0
else
  install_status=$?
fi
if [ -t 0 ]; then
  printf '\nPress Return to close this window. '
  read -r reply || true
fi
exit "$install_status"
