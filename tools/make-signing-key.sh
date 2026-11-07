#!/usr/bin/env bash
# Create the Spawn package-signing key on THIS machine (the one you publish from).
#
#   tools/make-signing-key.sh
#
# Makes one ed25519 signing key with no expiry in your normal gpg keyring. gpg asks for the passphrase itself; it is
# never taken from the command line, the environment or a file. Prints the fingerprint and one backup command.
# Uploads and publishes nothing.
#
# Why no expiry: dnf remembers a repository key and never refreshes it, so a key that expires breaks every user's
# "dnf upgrade" on that day.
set -euo pipefail

UID_STRING="${SPAWN_KEY_UID:-Spawn package signing <115914552+djshiye@users.noreply.github.com>}"

case "${1:-}" in
    "") ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "usage: $0" >&2; exit 2 ;;
esac

command -v gpg >/dev/null 2>&1 || { echo "gpg not found. Install it: sudo dnf install gnupg2" >&2; exit 1; }
# so pinentry can ask on the terminal when there is no graphical prompt
if [ -z "${GPG_TTY:-}" ] && tty -s 2>/dev/null; then GPG_TTY=$(tty); export GPG_TTY; fi

if gpg --batch --list-keys --with-colons "=$UID_STRING" >/dev/null 2>&1; then
    echo "A Spawn signing key already exists in this keyring:" >&2
    gpg --list-keys --fingerprint "=$UID_STRING" >&2
    exit 1
fi

status=$(mktemp)
trap 'rm -f "$status"' EXIT
echo "Creating the key. gpg will ask for a passphrase: make it long and keep it in your password manager."
gpg --status-fd 3 --quick-generate-key "$UID_STRING" ed25519 sign never 3>"$status"
fpr=$(awk '$1 == "[GNUPG:]" && $2 == "KEY_CREATED" {print $4; exit}' "$status")
[[ $fpr =~ ^[0-9A-F]{40}$ ]] || { echo "Could not read the fingerprint; run: gpg --list-keys --fingerprint" >&2; exit 1; }

cat <<MSG

Key created. Nothing was uploaded.

  Fingerprint:  $(printf '%s\n' "$fpr" | sed 's/.\{4\}/& /g; s/ $//')

Back it up once (it asks for the passphrase) and keep the file somewhere safe outside this folder,
for example your password manager or a USB stick. Never commit it:

  gpg --export-secret-keys --armor $fpr > ~/spawn-signing-key-backup.asc

To publish signed packages:

  export SPAWN_SIGNING_KEY=$fpr
  tools/publish.sh
MSG
