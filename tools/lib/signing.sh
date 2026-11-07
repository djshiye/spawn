# shellcheck shell=bash
# Signing helpers for tools/publish.sh (sourced, not run). Kept in their own file so the sign, verify and
# repository-writing logic can be exercised against a throwaway key without podman (see docs/RELEASING.md).
#
# Everything here runs on the HOST: the private key (a software key or a YubiKey, both reached through
# gpg-agent) never enters a container. Nothing here reads, writes or prints private key material; the only
# key file ever written is the exported PUBLIC key.
#
# Needs: bash 4+, gpg, rpmsign (Fedora package rpm-sign), rpmkeys (package rpm).

signing_die() { echo "error: $*" >&2; exit 1; }

# Print a prominent boxed warning on stderr.
signing_warn_box() {
    local line
    {
        echo
        echo "################################################################################"
        for line in "$@"; do printf '##  %s\n' "$line"; done
        echo "################################################################################"
        echo
    } >&2
}

# Require a full 40-hex fingerprint (short and long key IDs are forgeable), print it upper-case.
signing_normalise_fpr() {
    local f=$1
    if ! [[ $f =~ ^[0-9A-Fa-f]{40}$ ]]; then
        signing_die "signing key must be a full 40-hex-digit fingerprint without spaces or 0x (got '$f'); short key IDs are not accepted. Find it with: gpg --list-keys --fingerprint --with-colons | awk -F: '/^fpr/ {print \$10; exit}'"
    fi
    printf '%s\n' "${f^^}"
}

# Fingerprint of the primary key in an armoured or binary public key file. Fails unless the file
# holds exactly one primary key.
signing_pubkey_fpr() {
    local file=$1 out n
    out=$(gpg --batch --show-keys --with-colons "$file" 2>/dev/null) || signing_die "$file is not a readable OpenPGP key"
    n=$(printf '%s\n' "$out" | grep -c '^pub:' || true)
    [ "$n" -eq 1 ] || signing_die "$file must contain exactly one primary key (found $n)"
    printf '%s\n' "$out" | awk -F: '/^fpr:/ {print $10; exit}'
}

# "ABCD EF01 ..." in groups of four, for people to compare.
signing_pretty_fpr() { printf '%s\n' "$1" | sed 's/.\{4\}/& /g; s/ $//'; }

# Tools that must exist before anything is built.
signing_require_tools() {
    command -v gpg >/dev/null 2>&1 || signing_die "gpg not found. Install it: sudo dnf install gnupg2"
    command -v rpmkeys >/dev/null 2>&1 || signing_die "rpmkeys not found. Install it: sudo dnf install rpm"
    if ! command -v rpmsign >/dev/null 2>&1; then
        signing_die "rpmsign not found; it is not part of the rpm package. Install it: sudo dnf install rpm-sign"
    fi
}

# signing_check_key <fingerprint>: primary key present with a secret part (or smartcard stub), not expired
# or revoked, can sign. Warns when it expires within 60 days.
signing_check_key() {
    local fpr=$1 pub sec primary validity expires caps now
    pub=$(gpg --batch --with-colons --fixed-list-mode --list-keys "$fpr" 2>/dev/null) \
        || signing_die "public key $fpr is not in your gpg keyring (gpg --list-keys)"
    primary=$(printf '%s\n' "$pub" | awk -F: '/^fpr:/ {print $10; exit}')
    [ "${primary^^}" = "$fpr" ] \
        || signing_die "$fpr is not the fingerprint of a primary key; use the primary key's fingerprint"
    sec=$(gpg --batch --with-colons --list-secret-keys "$fpr" 2>/dev/null) || sec=""
    printf '%s\n' "$sec" | grep -q '^sec' \
        || signing_die "no secret key for $fpr here (plug in the YubiKey, or check gpg --list-secret-keys)"
    validity=$(printf '%s\n' "$pub" | awk -F: '/^pub:/ {print $2; exit}')
    case "$validity" in
        r) signing_die "key $fpr has been revoked" ;;
        e) signing_die "key $fpr has expired; extend it (gpg --edit-key $fpr expire) or rotate (docs/RELEASING.md)" ;;
        i|d) signing_die "key $fpr is invalid or disabled (validity '$validity')" ;;
    esac
    caps=$(printf '%s\n' "$pub" | awk -F: '/^(pub|sub):/ {printf "%s", $12}')
    case "$caps" in *[sS]*) ;; *) signing_die "key $fpr has no signing capability" ;; esac
    expires=$(printf '%s\n' "$pub" | awk -F: '/^pub:/ {print $7; exit}')
    if [ -n "$expires" ]; then
        now=$(date +%s)
        if [ $((expires - now)) -lt $((60 * 86400)) ]; then
            signing_warn_box "Signing key $fpr expires on $(date -u -d "@$expires" +%F)." \
                "Extend it soon: gpg --edit-key $fpr expire (then re-export and republish)."
        fi
    fi
}

# signing_export_pubkey <fingerprint> <file>: armoured PUBLIC key only, minimal (no third-party signatures).
signing_export_pubkey() {
    local fpr=$1 file=$2 got
    gpg --batch --yes --armor --export-options export-minimal --export "$fpr" >"$file.tmp" \
        || { rm -f "$file.tmp"; signing_die "could not export the public key $fpr"; }
    grep -q '^-----BEGIN PGP PUBLIC KEY BLOCK-----' "$file.tmp" \
        || { rm -f "$file.tmp"; signing_die "exported key is empty"; }
    got=$(signing_pubkey_fpr "$file.tmp")
    [ "$got" = "$fpr" ] || { rm -f "$file.tmp"; signing_die "exported key has fingerprint $got, expected $fpr"; }
    mv "$file.tmp" "$file"
}

# signing_sign_rpms <fingerprint> <rpm>...: add the signature in place. Both macro spellings are passed:
# _openpgp_sign_id is read by newer rpm, _gpg_name by older rpm; the one a given rpm does not know is ignored.
# gpg-agent asks for the passphrase (or the YubiKey PIN and touch) itself.
signing_sign_rpms() {
    local fpr=$1 f; shift
    [ $# -gt 0 ] || signing_die "no rpm files to sign"
    # a terminal for pinentry (harmless when there is none)
    if [ -z "${GPG_TTY:-}" ] && tty -s 2>/dev/null; then GPG_TTY=$(tty); export GPG_TTY; fi
    for f in "$@"; do
        rpmsign --addsign --define "_signature gpg" \
            --define "_openpgp_sign_id $fpr" --define "_gpg_name $fpr" "$f" >/dev/null \
            || signing_die "rpmsign failed for $f"
    done
}

# signing_verify_rpms <public-key-file> <rpm>...: every package must carry a valid signature that checks
# out against a temporary keyring holding ONLY that key (not the host's rpm database or gpg keyring).
signing_verify_rpms() {
    local pub=$1 db f out rc; shift
    [ $# -gt 0 ] || signing_die "no rpm files to verify"
    db=$(mktemp -d)
    rpmkeys --dbpath "$db" --define "_keyringpath $db/pubkeys/" --import "$pub" >/dev/null 2>&1 \
        || { rm -rf "$db"; signing_die "could not import $pub into a temporary rpm keyring"; }
    for f in "$@"; do
        rc=0
        out=$(rpmkeys --dbpath "$db" --define "_keyringpath $db/pubkeys/" --checksig "$f" 2>&1) || rc=$?
        # unsigned packages report "digests OK" and may exit 0, so insist on the word "signatures"
        if [ "$rc" -ne 0 ] || ! printf '%s\n' "$out" | grep -q 'signatures OK' \
            || printf '%s\n' "$out" | grep -Eqi 'NOT OK|NOKEY|NOTTRUSTED|BAD|MISSING'; then
            rm -rf "$db"
            signing_die "package is unsigned or not signed by the Spawn key: $f ($out)"
        fi
    done
    rm -rf "$db"
}

# signing_rpm_verifies <public-key-file> <rpm>: like signing_verify_rpms for one file, but returns 1 instead of dying.
signing_rpm_verifies() { ( signing_verify_rpms "$1" "$2" ) >/dev/null 2>&1; }

# signing_drop_unverifiable <public-key-file> <repo-dir>: delete every rpm in the directory that does not
# verify against the key. Prints what it removes.
signing_drop_unverifiable() {
    local pub=$1 dir=$2 f
    for f in "$dir"/*.rpm; do
        [ -e "$f" ] || continue
        if ! signing_rpm_verifies "$pub" "$f"; then
            echo "   dropping $(basename "$f"): not signed by the Spawn key (it would fail gpgcheck=1)"
            rm -f "$f"
        fi
    done
}

# signing_sign_repomd <fingerprint> <repo-dir>: detached armoured signature next to repodata/repomd.xml,
# which is the file dnf looks for with repo_gpgcheck=1.
signing_sign_repomd() {
    local fpr=$1 dir=$2
    [ -f "$dir/repodata/repomd.xml" ] || signing_die "$dir/repodata/repomd.xml does not exist"
    if [ -z "${GPG_TTY:-}" ] && tty -s 2>/dev/null; then GPG_TTY=$(tty); export GPG_TTY; fi
    gpg --yes --detach-sign --armor -u "$fpr" --output "$dir/repodata/repomd.xml.asc" "$dir/repodata/repomd.xml" \
        || signing_die "could not sign $dir/repodata/repomd.xml"
}

# signing_verify_repomd <public-key-file> <repo-dir>: the signature must be valid and made by this key
# (primary or its signing subkey), checked in an empty temporary gnupg home.
signing_verify_repomd() {
    local pub=$1 dir=$2 home status want
    [ -f "$dir/repodata/repomd.xml.asc" ] || signing_die "$dir/repodata/repomd.xml.asc is missing"
    want=$(signing_pubkey_fpr "$pub")
    home=$(mktemp -d); chmod 700 "$home"
    gpg --homedir "$home" --batch --quiet --import "$pub" >/dev/null 2>&1 \
        || { rm -rf "$home"; signing_die "could not import $pub into a temporary gnupg home"; }
    status=$(gpg --homedir "$home" --batch --status-fd 1 --verify \
        "$dir/repodata/repomd.xml.asc" "$dir/repodata/repomd.xml" 2>/dev/null) \
        || { gpgconf --homedir "$home" --kill all 2>/dev/null || true; rm -rf "$home"
             signing_die "bad signature on $dir/repodata/repomd.xml"; }
    gpgconf --homedir "$home" --kill all 2>/dev/null || true
    rm -rf "$home"
    printf '%s\n' "$status" | grep '^\[GNUPG:\] VALIDSIG' | grep -q " $want\( \|\$\)" \
        || signing_die "repomd.xml.asc in $dir was not made by key $want"
}

# signing_write_repo_file <file> <site-url> <signed 0|1>
signing_write_repo_file() {
    local file=$1 url=$2 signed=$3
    if [ "$signed" -eq 1 ]; then
        cat >"$file" <<REPO
[spawn]
name=Spawn
baseurl=$url/fedora-\$releasever/
enabled=1
# Packages and repository metadata are signed; compare the key fingerprint with the README before trusting it.
gpgcheck=1
repo_gpgcheck=1
gpgkey=$url/RPM-GPG-KEY-spawn
metadata_expire=1h
REPO
    else
        cat >"$file" <<REPO
[spawn]
name=Spawn
baseurl=$url/fedora-\$releasever/
enabled=1
# The packages are built locally and are NOT signed yet.
gpgcheck=0
metadata_expire=1h
REPO
    fi
}

# signing_check_tree <public-key-file> <repo-dir>...: the final gate before committing. Every rpm in every
# directory verifies, every repomd.xml.asc verifies, and nothing is left unsigned.
signing_check_tree() {
    local pub=$1 dir f n; shift
    for dir in "$@"; do
        n=0
        for f in "$dir"/*.rpm; do
            [ -e "$f" ] || continue
            signing_verify_rpms "$pub" "$f"; n=$((n + 1))
        done
        [ "$n" -gt 0 ] || signing_die "no packages in $dir"
        signing_verify_repomd "$pub" "$dir"
    done
}
