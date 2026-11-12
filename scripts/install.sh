#!/bin/sh
# Fork entry point; reuse the upstream installer and its prerequisite/PATH setup.
set -eu

main() {
  installer=$(mktemp "${TMPDIR:-/tmp}/omnigent-install.XXXXXX")
  trap 'rm -f "$installer"' EXIT
  trap 'exit 1' HUP INT TERM
  curl -fsSL \
    https://raw.githubusercontent.com/MrStrenggeheim/omnigent/custom/scripts/install_oss.sh \
    -o "$installer"
  sh "$installer" \
    --repo https://github.com/MrStrenggeheim/omnigent.git@custom \
    --no-databricks "$@"
}

main "$@"
