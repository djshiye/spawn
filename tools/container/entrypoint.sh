#!/usr/bin/env bash
# Container entry point (see tools/dev-shell-container.sh): the shell expects a system bus (the time limits
# manager, login manager, ... connect to it at start-up), so provide an empty private one that nothing owns
# names on, then run the given command.
set -euo pipefail
sock="${TMPDIR:-/tmp}/spawn-system-bus"
rm -f "$sock"
dbus-daemon --session --fork --address="unix:path=$sock" >/dev/null
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$sock"
exec "$@"
