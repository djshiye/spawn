#!/usr/bin/env bash
# Exercise tools/lib/signing.sh end to end with THROWAWAY keys in a temporary GNUPGHOME (no passphrase, deleted
# afterwards): builds a trivial noarch rpm, signs it, builds a repository with createrepo_c, signs repomd.xml
# and checks that verification passes for the right key and fails for unsigned, wrongly signed and tampered files.
# Needs gpg, rpmbuild, rpmsign, rpmkeys and createrepo_c; no podman, no network, nothing of yours is touched.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=lib/signing.sh
. "$root/tools/lib/signing.sh"

for t in gpg gpgconf rpmbuild rpmsign rpmkeys createrepo_c; do
    command -v "$t" >/dev/null 2>&1 || { echo "missing tool: $t" >&2; exit 2; }
done

tmp=$(mktemp -d)
export GNUPGHOME="$tmp/gnupg"
mkdir -m 700 "$GNUPGHOME"
cleanup() { gpgconf --kill all 2>/dev/null || true; rm -rf "$tmp"; }
trap cleanup EXIT
unset GPG_TTY

pass=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$*"; }
# expect_fail <description> <command...>: the command (run in a subshell) must exit non-zero
expect_fail() {
    local d=$1; shift
    if ( "$@" ) >/dev/null 2>&1; then echo "  FAIL $d (succeeded, should have failed)" >&2; exit 1; fi
    ok "$d"
}

newkey_cert() { # <name> -> fingerprint of a certify-only primary
    gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "$1 <throwaway@example.invalid>" ed25519 cert never 2>/dev/null
    gpg --batch --with-colons --list-keys "$1" | awk -F: '/^fpr:/ {print $10; exit}'
}
newkey() { # <name> -> fingerprint
    gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "$1 <throwaway@example.invalid>" ed25519 sign 2y 2>/dev/null
    gpg --batch --with-colons --list-keys "$1" | awk -F: '/^fpr:/ {print $10; exit}'
}
gp() { gpg --batch --pinentry-mode loopback --passphrase '' "$@"; }
# the real layout: certify-only primary without expiry, signing subkey without expiry, primary secret taken offline
gp --quick-generate-key "Spawn test key <throwaway@example.invalid>" ed25519 cert never 2>/dev/null
fpr=$(gpg --batch --with-colons --list-keys "Spawn test key" | awk -F: '/^fpr:/ {print $10; exit}')
gp --quick-add-key "$fpr" ed25519 sign never 2>/dev/null
# a primary key that only certifies and has no signing subkey (must be refused)
nosub=$(newkey_cert "No subkey key" 2>/dev/null || true)
# a plain sign-capable primary with expiry (the older layout; still accepted)
other=$(newkey "Other test key")
echo "throwaway keys: $fpr / $other"

# a trivial noarch package, twice (so KEEP-style pruning has something to prune)
mkdir -p "$tmp/rpmbuild"/{SPECS,RPMS,SRPMS,BUILD,SOURCES}
cat >"$tmp/rpmbuild/SPECS/dummy.spec" <<'SPEC'
Name: spawn-test-dummy
Version: 1
Release: 1
Summary: Throwaway package for tools/test-signing.sh
License: MIT
BuildArch: noarch
%description
Nothing.
%install
mkdir -p %{buildroot}/usr/share/spawn-test-dummy
echo hello > %{buildroot}/usr/share/spawn-test-dummy/hello
%files
/usr/share/spawn-test-dummy/hello
SPEC
rpmbuild -ba --define "_topdir $tmp/rpmbuild" "$tmp/rpmbuild/SPECS/dummy.spec" >"$tmp/rpmbuild.log" 2>&1 \
    || { tail -n 30 "$tmp/rpmbuild.log" >&2; exit 1; }
rpm_file=$(ls "$tmp"/rpmbuild/RPMS/noarch/*.rpm)
srpm_file=$(ls "$tmp"/rpmbuild/SRPMS/*.src.rpm)

echo "== helpers"
[ "$(signing_normalise_fpr "${fpr,,}")" = "$fpr" ] && ok "fingerprint normalised to upper case"
expect_fail "short key ID rejected" signing_normalise_fpr "${fpr: -16}"
expect_fail "fingerprint with spaces rejected" signing_normalise_fpr "$(signing_pretty_fpr "$fpr")"
signing_check_key "$fpr" && ok "signing_check_key accepts primary + signing subkey (primary secret present)"
signing_check_key "$other" && ok "signing_check_key accepts a signing-capable primary"
expect_fail "signing_check_key rejects a primary with no signing key" signing_check_key "$nosub"
expect_fail "signing_check_key rejects an unknown fingerprint" signing_check_key "0123456789ABCDEF0123456789ABCDEF01234567"
sub=$(gpg --batch --with-colons --list-keys "$fpr" | awk -F: '/^sub/ {f=1} f && /^fpr:/ {print $10; exit}')
expect_fail "signing_check_key rejects a subkey fingerprint" signing_check_key "$sub"

# take the primary's secret off the keyring, keeping only the subkey (the pattern make-signing-key.sh prints)
gpg --batch --pinentry-mode loopback --passphrase '' --export-secret-subkeys --armor "$fpr" >"$tmp/subkeys.asc"
gpg --batch --yes --delete-secret-keys "$fpr" 2>/dev/null
gp --import "$tmp/subkeys.asc" 2>/dev/null
rm -f "$tmp/subkeys.asc"
gpg --list-secret-keys --with-colons "$fpr" | grep -q '^sec:' && gpg --list-secret-keys --with-colons "$fpr" | awk -F: '/^sec:/ {print $15}' | grep -qx '#' \
    && ok "primary secret is offline (sec#), subkey secret present"
signing_check_key "$fpr" && ok "signing_check_key accepts sec# with a usable signing subkey"
# a copy of the keyring with the subkey secret removed too: only the public key is left
mkdir -m 700 "$tmp/pubonly"
gpg --export "$fpr" | GNUPGHOME="$tmp/pubonly" gpg --batch --import 2>/dev/null
expect_fail "signing_check_key rejects a key with no secret signing key at all" env GNUPGHOME="$tmp/pubonly" bash -c ". '$root/tools/lib/signing.sh'; signing_check_key '$fpr'"
GNUPGHOME="$tmp/pubonly" gpgconf --kill all 2>/dev/null || true

pub="$tmp/RPM-GPG-KEY-spawn"
signing_export_pubkey "$fpr" "$pub"
[ "$(signing_pubkey_fpr "$pub")" = "$fpr" ] && ok "public key exported and fingerprint read back"
gpg --show-keys --with-colons "$pub" | grep -q '^sub:' && ok "exported certificate includes the signing subkey"
! grep -q 'PRIVATE' "$pub" && ok "export holds no private key block"
otherpub="$tmp/other.asc"; signing_export_pubkey "$other" "$otherpub"

echo "== packages"
mkdir "$tmp/repo"
cp "$rpm_file" "$srpm_file" "$tmp/repo/"
expect_fail "unsigned packages fail verification" signing_verify_rpms "$pub" "$tmp"/repo/*.rpm
signing_sign_rpms "$fpr" "$tmp"/repo/*.rpm && ok "rpmsign signed the rpm and src.rpm with the subkey (primary offline)"
signing_verify_rpms "$pub" "$tmp"/repo/*.rpm && ok "signed packages verify against a keyring holding only the public key"
expect_fail "verification against a different key fails" signing_verify_rpms "$otherpub" "$tmp"/repo/*.rpm
cp "$rpm_file" "$tmp/repo/unsigned-old.rpm"
signing_drop_unverifiable "$pub" "$tmp/repo"
[ ! -e "$tmp/repo/unsigned-old.rpm" ] && [ -e "$tmp/repo/$(basename "$rpm_file")" ] && ok "unsigned package dropped, signed ones kept"

echo "== repository"
createrepo_c --general-compress-type gz "$tmp/repo" >/dev/null 2>&1
expect_fail "missing repomd.xml.asc fails verification" signing_verify_repomd "$pub" "$tmp/repo"
signing_sign_repomd "$fpr" "$tmp/repo" && ok "repomd.xml signed"
signing_verify_repomd "$pub" "$tmp/repo" && ok "repomd.xml.asc verifies"
expect_fail "repomd.xml.asc fails against a different key" signing_verify_repomd "$otherpub" "$tmp/repo"
mkdir "$tmp/site"; cp -r "$tmp/repo" "$tmp/site/fedora-43"; cp -r "$tmp/repo" "$tmp/site/fedora-44"
signing_check_tree "$pub" "$tmp/site" && ok "signing_check_tree passes on a complete signed tree"
mkdir "$tmp/site/fedora-42"; cp "$rpm_file" "$tmp/site/fedora-42/"
expect_fail "signing_check_tree refuses an extra unsigned fedora-* directory" signing_check_tree "$pub" "$tmp/site"
rm -rf "$tmp/site"
cp "$tmp/repo/repodata/repomd.xml" "$tmp/repomd.bak"
echo "<!-- tampered -->" >>"$tmp/repo/repodata/repomd.xml"
expect_fail "tampered repomd.xml fails verification" signing_verify_repomd "$pub" "$tmp/repo"
cp "$tmp/repomd.bak" "$tmp/repo/repodata/repomd.xml"
cp "$rpm_file" "$tmp/repo/zz-unsigned.rpm"
expect_fail "signing_check_tree fails when one package is unsigned" signing_check_tree "$pub" "$tmp/repo"
rm "$tmp/repo/zz-unsigned.rpm"

echo "== repo file"
signing_write_repo_file "$tmp/spawn.repo" "https://example.invalid/spawn" 1
grep -qx 'gpgcheck=1' "$tmp/spawn.repo" && grep -qx 'repo_gpgcheck=1' "$tmp/spawn.repo" \
    && grep -qx 'gpgkey=https://example.invalid/spawn/RPM-GPG-KEY-spawn' "$tmp/spawn.repo" && ok "signed spawn.repo"
signing_write_repo_file "$tmp/spawn.repo" "https://example.invalid/spawn" 0
grep -qx 'gpgcheck=0' "$tmp/spawn.repo" && ! grep -q repo_gpgcheck "$tmp/spawn.repo" && ok "unsigned spawn.repo"

echo
echo "PASS: $pass checks"
