#!/usr/bin/env zsh
set -euo pipefail

cat >&2 <<'MESSAGE'
PhotosByElie Photos Bridge is retired (PBB-92).
Backstage is the sole supported PhotoKit authority; this script will not build,
install, repair, launch, or downgrade the standalone helper.
MESSAGE
exit 64
