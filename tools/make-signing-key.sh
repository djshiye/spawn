#!/usr/bin/env bash
# Create the Spawn package-signing key on THIS machine. Run it yourself, on the computer you publish from.
#
#   tools/make-signing-key.sh
#
# Creates an ed25519 primary key that can only sign (certify and sign), valid for 2 years, in your normal gpg
# keyring. gpg asks for the passphrase itself (a pinentry dialog or the terminal); it is never taken from the
# command line, the environment or a file. Prints the fingerprint and how to back the key up and how to move it
# to a YubiKey. It does not upload, export or publish anything, and writes no key file.
set -euo pipefail

UID_STRING="${SPAWN_KEY_UID:-Spawn package signing <115914552+djshiye@users.noreply.github.com>}"
EXPIRY="2y"

if [ -t 1 ]; then b=$'\e[1m'; c=$'\e[36m'; r=$'\e[0m'; else b=""; c=""; r=""; fi
step() { printf '%s==>%s %s%s%s\n' "$c" "$r" "$b" "$*" "$r"; }

case "${1:-}" in
    "") ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "usage: $0" >&2; exit 2 ;;
esac

command -v gpg >/dev/null 2>&1 || { echo "gpg not found. Install it: sudo dnf install gnupg2" >&2; exit 1; }
# gpg --quick-generate-key needs 2.1.17 or later for the algorithm and expiry arguments.
gpg_version=$(gpg --version | awk 'NR==1 {print $NF}')
if [ "$(printf '%s\n2.1.17\n' "$gpg_version" | sort -V | head -n1)" != "2.1.17" ]; then
    echo "gpg $gpg_version is too old; 2.1.17 or later is needed." >&2
    exit 1
fi
# so pinentry can ask on the terminal when there is no graphical prompt
if [ -z "${GPG_TTY:-}" ] && tty -s 2>/dev/null; then GPG_TTY=$(tty); export GPG_TTY; fi

if gpg --batch --list-keys --with-colons "=$UID_STRING" >/dev/null 2>&1; then
    echo "A key for '$UID_STRING' already exists in this keyring:" >&2
    gpg --list-keys --fingerprint "=$UID_STRING" >&2
    echo "Refusing to create a second one. Use that key, or delete it first if it was a mistake." >&2
    exit 1
fi

status=$(mktemp)
trap 'rm -f "$status"' EXIT

step "Creating the key (gpg will ask you to choose a passphrase; pick a long one and keep it in your password manager)"
gpg --status-fd 3 --quick-generate-key "$UID_STRING" ed25519 sign "$EXPIRY" 3>"$status"

fpr=$(awk '$1 == "[GNUPG:]" && $2 == "KEY_CREATED" {print $4; exit}' "$status")
if ! [[ $fpr =~ ^[0-9A-F]{40}$ ]]; then
    echo "Could not read the new key's fingerprint from gpg; see: gpg --list-keys --fingerprint" >&2
    exit 1
fi
pretty=$(printf '%s\n' "$fpr" | sed 's/.\{4\}/& /g; s/ $//')
expires=$(gpg --batch --with-colons --list-keys "$fpr" | awk -F: '/^pub:/ {print $7; exit}')

cat <<EOF

${b}Key created.${r}

  Fingerprint:  $pretty
  Full form:    $fpr
  Valid until:  $(date -u -d "@$expires" +%F 2>/dev/null || echo "$EXPIRY from now")

Nothing has been uploaded or published.

${b}1. Use it${r}

  export SPAWN_SIGNING_KEY=$fpr
  tools/publish.sh                      # then, after looking at .gh-pages/: tools/publish.sh --push

  Update README.md (the "Fedora (DNF repository)" section) in the same commit: docs/RELEASING.md, "Signing", step 5.

${b}2. Back it up offline (do this now, before anything else)${r}

  Without a backup, a lost or broken disk means a new key, and every user has to trust it again.

  # the secret key (asks for the passphrase); put the file on an encrypted USB stick kept away from this computer
  gpg --export-secret-keys --armor $fpr > spawn-signing-secret.asc
  # the public key and gpg's ready-made revocation certificate; copy both to the same place
  gpg --export --armor $fpr > spawn-signing-public.asc
  cp "\${GNUPGHOME:-\$HOME/.gnupg}/openpgp-revocs.d/$fpr.rev" .
  # then remove the loose copies from this computer:  shred -u spawn-signing-secret.asc

  Keep the revocation certificate (*.rev) somewhere safe: anybody holding it can revoke the key, and you will
  need it if the key is ever lost or leaked. Also store the passphrase separately from the backup.
  Never commit any of these files.

${b}3. Optional: move it to a YubiKey${r}

  A key on a YubiKey cannot be copied off it, so malware on this computer cannot steal it.
  Do the backup in step 2 first: keytocard REPLACES the local secret key with a stub, and the card cannot be read back.

  gpg --card-status                      # the card must show up
  gpg --edit-key $fpr
    gpg> keytocard                       # answer y; choose slot 1 (Signature key); enter the card's Admin PIN
    gpg> save
  ykman openpgp keys set-touch sig on    # optional: require a touch for every signature (ykman from yubikey-manager)

  Afterwards "gpg --list-secret-keys" shows "sec>" (the > means: the key is on a card). Publishing then asks for
  the card's PIN, and for a touch if you enabled it. Change the default PINs first (gpg --change-pin).

${b}4. Extend or replace it later${r}

  docs/RELEASING.md, "Signing", explains extending the expiry and rotating the key.
EOF
