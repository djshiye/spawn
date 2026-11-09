#!/usr/bin/env bash
# One command for a whole Spawn release, start to finish, on the release machine (Dino's Fedora PC):
#
#   tools/release.sh           update main, build, sign, verify, push gh-pages, then wait until the live site
#                              serves the new signed release and verify it there too
#   tools/release.sh --check   change nothing: check tools, the signing key, git push access and what would be
#                              published, and report whether the live site matches the published branch
#   tools/release.sh --no-wait skip waiting for the live site at the end
#
# The only thing a person ever does is type the signing key's password into the gpg box once, at the very start,
# and only when gpg-agent does not already remember it. The password never passes through this script, a
# terminal, an environment variable or a file: gpg-agent asks for it in its own window (pinentry) and keeps it in
# memory for the length of the release (see docs/RELEASING.md, "One-command releases").
#
# Pushing uses the machine's own signed-in git (no tokens here). Nothing is ever force-pushed; publish.sh refuses
# to sign with any key but the published one and verifies every signature before anything is committed.
set -euo pipefail

# Public fingerprint of the published signing key (also in README.md and on the live site).
SIGNING_KEY="D49A308168257FDBF9D5AE14BD1AC1C6F56A7252"
SITE="https://djshiye.github.io/spawn"
FEDORA_RELEASES=(43 44 45)
PKG="spawn"
LIVE_WAIT_SECONDS=900

main() {
    local check=0 wait_live=1 pulled=0 arg
    for arg in "$@"; do
        case "$arg" in
            --check) check=1 ;;
            --no-wait) wait_live=0 ;;
            --already-pulled) pulled=1 ;;   # internal: set when the script re-runs itself after updating
            -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
            *) echo "usage: $0 [--check] [--no-wait]" >&2; exit 2 ;;
        esac
    done

    root=$(cd "$(dirname "$0")/.." && pwd)
    cd "$root"
    # shellcheck source=lib/signing.sh
    . "$root/tools/lib/signing.sh"
    if [ -t 1 ]; then b=$'\e[1m'; g=$'\e[32m'; c=$'\e[36m'; y=$'\e[33m'; r=$'\e[0m'; else b=""; g=""; c=""; y=""; r=""; fi

    # ---- 1. tools ----
    step "Checking the tools"
    local t missing=()
    for t in git gpg gpg-connect-agent rpmsign rpmkeys podman npm node curl; do
        command -v "$t" >/dev/null 2>&1 || missing+=("$t")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        fail "missing: ${missing[*]} (rpmsign is in the rpm-sign package: sudo dnf install rpm-sign)"
    fi
    ok "git, gpg, rpm-sign, podman, npm and curl are installed"

    # ---- 2. main, up to date and clean ----
    step "Updating main"
    [ -z "$(git status --porcelain)" ] || { git status --short >&2; fail "the spawn folder has uncommitted changes; commit or stash them first"; }
    if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
        git switch -q main || fail "could not switch to main"
    fi
    if [ "$pulled" -eq 0 ]; then
        local before
        before=$(git hash-object "$0")
        git pull -q --ff-only origin main || fail "main could not be fast-forwarded from GitHub; reconcile it by hand"
        if [ "$(git hash-object "$0")" != "$before" ]; then
            ok "release.sh itself was updated; running the new version"
            exec "$0" "$@" --already-pulled
        fi
    fi
    tools/bump-version.sh --check >/dev/null || fail "the version numbers disagree (tools/bump-version.sh --check)"
    version=$(awk '/^Version:/ {print $2; exit}' build-aux/spawn.spec)
    release="1.$(git rev-list --count HEAD)"
    ok "main is at $(git rev-parse --short HEAD): $PKG $version, release $release"

    # ---- 3. signing key (public checks only; the private key never leaves gpg-agent) ----
    step "Checking the signing key"
    signing_require_tools
    signing_check_key "$SIGNING_KEY"
    ok "key $(signing_pretty_fpr "$SIGNING_KEY") is here and can sign"

    # ---- 4. what is published, and can we push? ----
    step "Checking GitHub"
    git fetch -q origin +gh-pages:refs/remotes/origin/gh-pages || fail "could not fetch gh-pages from GitHub"
    local published_fpr
    git show origin/gh-pages:RPM-GPG-KEY-spawn >"$work/published-key.asc" 2>/dev/null \
        || fail "origin/gh-pages has no RPM-GPG-KEY-spawn"
    published_fpr=$(signing_pubkey_fpr "$work/published-key.asc")
    [ "$published_fpr" = "$SIGNING_KEY" ] \
        || fail "the published key ($published_fpr) is not $SIGNING_KEY; a key change needs tools/publish.sh --rotate-key by hand"
    # A dry-run push authenticates against GitHub's push endpoint without changing anything.
    git push -q --dry-run origin refs/remotes/origin/gh-pages:refs/heads/gh-pages >/dev/null 2>&1 \
        || fail "this machine's git is not allowed to push to github.com/djshiye/spawn (sign in with: gh auth login)"
    ok "git can push to GitHub, and the published key matches"

    local already=0 f
    for f in $(git ls-tree --name-only origin/gh-pages "fedora-${FEDORA_RELEASES[0]}/"); do
        case "$f" in */"$PKG-$version-$release".fc*.noarch.rpm) already=1 ;; esac
    done

    if [ "$check" -eq 1 ]; then
        step "Checking the signing password"
        if key_unprotected; then note "the signing key has no password: a release never asks, but anything running as you can sign (docs/RELEASING.md)"
        elif key_cached; then ok "gpg-agent remembers the password: a release would not ask for it"
        else note "gpg-agent does not remember the password: a release asks for it once, in a box on screen"; fi
        if [ "$already" -eq 1 ]; then note "$PKG $version-$release is already published; a release would only re-check the live site"
        else note "a release would publish $PKG $version-$release for Fedora ${FEDORA_RELEASES[*]}"; fi
        verify_live 0 || true
        printf '\n%s%sAll checks passed. Nothing was changed.%s\n' "$g" "$b" "$r"
        exit 0
    fi

    if [ "$already" -eq 1 ]; then
        note "$PKG $version-$release is already on gh-pages; nothing to build"
    else
        # ---- 5. unlock the key once, keep it unlocked only while this release runs ----
        step "Unlocking the signing key"
        if key_unprotected; then
            ok "the key has no password, so nothing to type"
        elif key_cached; then
            ok "gpg-agent already remembers the password"
        else
            note "type the signing key's password in the box on screen (once for this release)"
        fi
        unlock_key || fail "the key was not unlocked (box cancelled, wrong password, or nobody at the PC); nothing was built or pushed"
        ok "key unlocked"
        keep_unlocked &
        keeper=$!

        # ---- 6. build, sign, verify, commit and push (publish.sh does the work and all signature checks) ----
        step "Building, signing and publishing $PKG $version-$release"
        SPAWN_SIGNING_KEY=$SIGNING_KEY tools/publish.sh --push
        kill "$keeper" 2>/dev/null || true
        keeper=""

        # ---- 7. GitHub now has exactly what was built here ----
        local remote local_head
        remote=$(git ls-remote origin refs/heads/gh-pages | awk '{print $1}')
        local_head=$(git -C .gh-pages rev-parse HEAD)
        [ "$remote" = "$local_head" ] || fail "GitHub's gh-pages ($remote) is not the commit built here ($local_head)"
        ok "pushed gh-pages $(git -C .gh-pages rev-parse --short HEAD)"
        git fetch -q origin +gh-pages:refs/remotes/origin/gh-pages
    fi

    # ---- 8. the live site ----
    if [ "$wait_live" -eq 1 ]; then
        verify_live 1
        printf '\n%s%s%s %s-%s is live and signed for Fedora %s.%s\n' "$g" "$b" "$PKG" "$version" "$release" "${FEDORA_RELEASES[*]}" "$r"
    else
        printf '\n%s%sPushed. Not waiting for the live site (--no-wait).%s\n' "$g" "$b" "$r"
    fi
}

step() { printf '\n%s==>%s %s%s%s\n' "$c" "$r" "$b" "$*" "$r"; }
ok()   { printf '   %s✓%s %s\n' "$g" "$r" "$*"; }
note() { printf '   %s•%s %s\n' "$y" "$r" "$*"; }
fail() { printf '\n%sRelease stopped:%s %s\n' "$b" "$r" "$*" >&2; exit 1; }

# Keygrips of the key's signing-capable parts (the primary and/or a signing subkey).
signing_keygrips() {
    LC_ALL=C gpg --batch --with-colons --with-keygrip --list-secret-keys "$SIGNING_KEY" 2>/dev/null \
        | awk -F: '/^(sec|ssb):/ {s = ($12 ~ /s/)} /^grp:/ && s {print $10}'
}

# True when signing needs no password right now: for every signing-capable part, gpg-agent either holds the
# passphrase (KEYINFO field 7 is "1") or the key has none (protection field 8 is "C", clear).
key_cached() {
    local grip any=0
    for grip in $(signing_keygrips); do
        any=1
        gpg-connect-agent "KEYINFO $grip" /bye 2>/dev/null \
            | awk '$2 == "KEYINFO" {found = 1; ok = ($7 == "1" || $8 == "C")} END {exit !(found && ok)}' || return 1
    done
    [ "$any" -eq 1 ]
}

# True when the key has no passphrase at all (worth a warning: anything running as this user can sign).
key_unprotected() {
    local grip any=0
    for grip in $(signing_keygrips); do
        any=1
        gpg-connect-agent "KEYINFO $grip" /bye 2>/dev/null \
            | awk '$2 == "KEYINFO" {found = 1; c = ($8 == "C")} END {exit !(found && c)}' || return 1
    done
    [ "$any" -eq 1 ]
}

# One throwaway signature: makes gpg-agent ask for the passphrase now (in its own pinentry window), before the
# long build, instead of somewhere in the middle of it.
unlock_key() {
    if [ -z "${GPG_TTY:-}" ] && tty -s 2>/dev/null; then GPG_TTY=$(tty); export GPG_TTY; fi
    printf 'spawn release %s\n' "$(date -u +%FT%TZ)" | gpg --quiet -u "$SIGNING_KEY" --detach-sign --output /dev/null 2>/dev/null
}

# gpg-agent forgets an unused passphrase after 10 idle minutes (default-cache-ttl). A cold build can take longer
# than that before its first signature, so touch the key every 4 minutes while publish.sh runs. Stopped as soon as
# publish.sh finishes; it never asks for the passphrase itself (--pinentry-mode error).
keep_unlocked() {
    while sleep 240; do
        printf 'keep-alive\n' | gpg --batch --quiet --pinentry-mode error -u "$SIGNING_KEY" --detach-sign --output /dev/null 2>/dev/null || true
    done
}

# verify_live <wait 0|1>: the live site serves exactly the committed origin/gh-pages metadata, every repomd.xml
# signature verifies against the published key, and spawn.repo requires signatures. With wait=1, retries for up
# to LIVE_WAIT_SECONDS (GitHub Pages takes a few minutes to deploy and caches for about 10).
verify_live() {
    local wait=$1 deadline problem
    step "Checking the live site ($SITE)"
    deadline=$(( $(date +%s) + LIVE_WAIT_SECONDS ))
    while :; do
        problem=$(live_problem) && { ok "the live site serves the published release, signed with key $(signing_pretty_fpr "$SIGNING_KEY")"; return 0; }
        if [ "$wait" -eq 0 ]; then note "the live site is not up to date yet: $problem"; return 1; fi
        [ "$(date +%s)" -lt "$deadline" ] || fail "after $((LIVE_WAIT_SECONDS / 60)) minutes the live site is still not right: $problem. The push succeeded; run tools/release.sh again later to re-check."
        note "not live yet ($problem); checking again in 30 s"
        sleep 30
    done
}

# Prints what is wrong with the live site and fails, or prints nothing and succeeds.
live_problem() {
    local d n fed live_fpr
    d=$(mktemp -d "$work/live.XXXX")
    get() { curl -fsSL --proto '=https' --tlsv1.2 --max-time 30 -H 'Cache-Control: no-cache' -o "$2" "$SITE/$1?t=$(date +%s)"; }
    get spawn.repo "$d/spawn.repo" || { echo "spawn.repo cannot be downloaded"; return 1; }
    grep -qx 'gpgcheck=1' "$d/spawn.repo" && grep -qx 'repo_gpgcheck=1' "$d/spawn.repo" \
        || { echo "spawn.repo does not require signatures"; return 1; }
    get RPM-GPG-KEY-spawn "$d/key.asc" || { echo "the public key cannot be downloaded"; return 1; }
    live_fpr=$( (signing_pubkey_fpr "$d/key.asc") 2>/dev/null) || live_fpr=""
    [ "$live_fpr" = "$SIGNING_KEY" ] || { echo "the live key is not $(signing_pretty_fpr "$SIGNING_KEY")"; return 1; }
    for fed in "${FEDORA_RELEASES[@]}"; do
        n="$d/fedora-$fed"; mkdir -p "$n/repodata"
        get "fedora-$fed/repodata/repomd.xml" "$n/repodata/repomd.xml" \
            && get "fedora-$fed/repodata/repomd.xml.asc" "$n/repodata/repomd.xml.asc" \
            || { echo "Fedora $fed metadata cannot be downloaded"; return 1; }
        git show "origin/gh-pages:fedora-$fed/repodata/repomd.xml" | cmp -s - "$n/repodata/repomd.xml" \
            || { echo "Fedora $fed still serves older metadata"; return 1; }
        ( signing_verify_repomd "$d/key.asc" "$n" ) >/dev/null 2>&1 \
            || { echo "Fedora $fed metadata signature does not verify"; return 1; }
    done
    return 0
}

work=$(mktemp -d)
keeper=""
cleanup() { [ -z "$keeper" ] || kill "$keeper" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT
main "$@"
exit
