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

newkey() { # <name> -> fingerprint
    gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "$1 <throwaway@example.invalid>" ed25519 sign 2y 2>/dev/null
    gpg --batch --with-colons --list-keys "$1" | awk -F: '/^fpr:/ {print $10; exit}'
}
fpr=$(newkey "Spawn test key")
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
signing_check_key "$fpr" && ok "signing_check_key accepts a good primary key"
expect_fail "signing_check_key rejects an unknown fingerprint" signing_check_key "0123456789ABCDEF0123456789ABCDEF01234567"
sub=$(gpg --batch --pinentry-mode loopback --passphrase '' --quick-add-key "$fpr" ed25519 sign 2y 2>&1 >/dev/null; \
      gpg --batch --with-colons --list-keys "$fpr" | awk -F: '/^sub/ {f=1} f && /^fpr:/ {print $10; exit}')
expect_fail "signing_check_key rejects a subkey fingerprint" signing_check_key "$sub"

pub="$tmp/RPM-GPG-KEY-spawn"
signing_export_pubkey "$fpr" "$pub"
[ "$(signing_pubkey_fpr "$pub")" = "$fpr" ] && ok "public key exported and fingerprint read back"
! grep -q 'PRIVATE' "$pub" && ok "export holds no private key block"
otherpub="$tmp/other.asc"; signing_export_pubkey "$other" "$otherpub"

echo "== packages"
mkdir "$tmp/repo"
cp "$rpm_file" "$srpm_file" "$tmp/repo/"
expect_fail "unsigned packages fail verification" signing_verify_rpms "$pub" "$tmp"/repo/*.rpm
signing_sign_rpms "$fpr" "$tmp"/repo/*.rpm && ok "rpmsign signed the rpm and src.rpm"
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
signing_check_tree "$pub" "$tmp/repo" && ok "signing_check_tree passes on a complete signed tree"
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
