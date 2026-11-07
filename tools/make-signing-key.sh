#!/usr/bin/env bash
# Create the Spawn package-signing key on THIS machine. Run it yourself, on the computer you publish from.
#
#   tools/make-signing-key.sh [--backup-dir DIR]
#
# Creates, in your normal gpg keyring: an ed25519 PRIMARY key that can only certify, with no expiry (it is meant to be
# taken offline), and an ed25519 SIGNING SUBKEY, also with no expiry. gpg asks for the passphrase itself (a pinentry
# dialog or the terminal); it is never taken from the command line, the environment or a file. Prints the fingerprint
# and the exact commands to back the primary up, take it off this computer, and optionally move the subkey to a
# YubiKey. It does not upload, export or publish anything and writes no key file; the commands it prints write backups
# to DIR (default ~/spawn-key-backup), which must be outside the repository.
#
# Why no expiry: dnf remembers a repository key by the primary key's ID and never refreshes it, so a key that expires
# (or whose expiry is extended) breaks every user's "dnf upgrade" until each of them re-imports it.
set -euo pipefail

UID_STRING="${SPAWN_KEY_UID:-Spawn package signing <115914552+djshiye@users.noreply.github.com>}"
backup_dir="$HOME/spawn-key-backup"

if [ -t 1 ]; then b=$'\e[1m'; c=$'\e[36m'; r=$'\e[0m'; else b=""; c=""; r=""; fi
step() { printf '%s==>%s %s%s%s\n' "$c" "$r" "$b" "$*" "$r"; }

while [ $# -gt 0 ]; do
    case "$1" in
        --backup-dir) [ $# -ge 2 ] || { echo "--backup-dir needs a directory" >&2; exit 2; }
                      backup_dir=$2; shift ;;
        -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "usage: $0 [--backup-dir DIR]" >&2; exit 2 ;;
    esac
    shift
done

# The backup directory must not be inside this repository, where a careless "git add" could publish it.
repo_root=$(cd "$(dirname "$0")/.." && pwd -P)
mkdir -p "$backup_dir"
backup_abs=$(cd "$backup_dir" && pwd -P)
case "$backup_abs/" in
    "$repo_root"/*) echo "The backup directory must be outside the repository ($repo_root); got $backup_abs." >&2; exit 2 ;;
esac

command -v gpg >/dev/null 2>&1 || { echo "gpg not found. Install it: sudo dnf install gnupg2" >&2; exit 1; }
# gpg --quick-generate-key and --quick-add-key need 2.1.17 or later for the algorithm and expiry arguments.
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

step "Creating the offline primary key, certify only, no expiry (gpg asks for a passphrase: choose a long one, keep it in your password manager)"
gpg --status-fd 3 --quick-generate-key "$UID_STRING" ed25519 cert never 3>"$status"
fpr=$(awk '$1 == "[GNUPG:]" && $2 == "KEY_CREATED" {print $4; exit}' "$status")
if ! [[ $fpr =~ ^[0-9A-F]{40}$ ]]; then
    echo "Could not read the new key's fingerprint from gpg; see: gpg --list-keys --fingerprint" >&2
    exit 1
fi

step "Adding the signing subkey, no expiry (same passphrase)"
gpg --quick-add-key "$fpr" ed25519 sign never

pretty=$(printf '%s\n' "$fpr" | sed 's/.\{4\}/& /g; s/ $//')
hdir="${GNUPGHOME:-\$HOME/.gnupg}"

cat <<EOF

${b}Key created.${r}

  Fingerprint of the primary key:  $pretty
  Full form:                       $fpr
  Expiry:                          none (primary and signing subkey)

Nothing has been uploaded or published, and no file has been written.

${b}1. Back up the primary key (do this now, before anything else)${r}

  The primary key is the identity users trust; the subkey only signs. Without a backup of the primary, losing this
  disk means a new identity and every user has to trust it again. The commands write OUTSIDE the repository:

  B="$backup_abs"
  mkdir -p -m 700 "\$B"
  gpg --export-secret-keys --armor $fpr > "\$B/spawn-signing-primary-secret.asc"
  gpg --export --armor $fpr > "\$B/spawn-signing-public.asc"
  cp "$hdir/openpgp-revocs.d/$fpr.rev" "\$B/"

  Copy that directory to an encrypted USB stick (or two) and check that the files can be read back from it.

  Keep the passphrase separately from the stick. The .rev file revokes the key: anybody holding it can do that,
  and you need it if the primary is ever leaked. Never commit any of these files (.gitignore blocks the usual names).

${b}2. Take the primary key off this computer${r}

  Keep only the signing subkey in your everyday keyring. The primary is then needed only to rotate or extend the
  subkey, from the stick.

  gpg --export-secret-subkeys --armor $fpr > "\$B/subkeys.asc"
  gpg --delete-secret-keys $fpr                                      # answer yes
  gpg --import "\$B/subkeys.asc"
  shred -u "$hdir/openpgp-revocs.d/$fpr.rev"

  Only after the stick has been checked: remove every file from "\$B" on this computer.

  shred -u "\$B"/* && rmdir "\$B"

  Check: "gpg --list-secret-keys" must now show "sec#" (primary secret absent) and "ssb" (subkey present).
  tools/publish.sh accepts exactly that layout.

${b}3. Optional: move the signing subkey to a YubiKey${r}

  A key on a YubiKey cannot be copied off it, so malware on this computer cannot steal it. Do steps 1 and 2 first:
  keytocard REPLACES the local subkey with a stub, and the card cannot be read back.

  gpg --card-status                      # the card must show up
  gpg --edit-key $fpr
    gpg> key 1                           # selects the signing subkey (a * appears next to it)
    gpg> keytocard                       # choose slot 1 (Signature key); enter the Admin PIN
    gpg> save
  ykman openpgp keys set-touch sig on    # require a touch for every signature (ykman is in yubikey-manager)

  Afterwards "gpg --list-secret-keys" shows "sec#" and "ssb>" (the > means: on a card). Publishing asks for the
  card's PIN and a touch for each signature (one per package and one per repomd.xml). Change the default PINs first
  (gpg --change-pin). If the card is lost or broken, make a new subkey under the same primary from the backup:
  docs/RELEASING.md, "Replacing the signing subkey".

${b}4. Use it${r}

  export SPAWN_SIGNING_KEY=$fpr          # the primary key's fingerprint, always
  tools/publish.sh                       # then, after looking at .gh-pages/: tools/publish.sh --push

  Update README.md in the same commit: docs/RELEASING.md, "Signing", step 5.
EOF
