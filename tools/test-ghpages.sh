#!/usr/bin/env bash
# Exercise tools/lib/ghpages.sh against throwaway git repositories (a bare "origin" and a clone with a .gh-pages
# worktree) in a temporary folder. Needs git only: no podman, no gpg, no network, nothing of yours is touched.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=lib/ghpages.sh
. "$root/tools/lib/ghpages.sh"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid

pass=0
ok() { pass=$((pass + 1)); printf '  ok   %s\n' "$*"; }
fail() { echo "  FAIL $*" >&2; exit 1; }
dirty43=fedora-43/spawn-1.6.0-1.130.dirty.fc43.noarch.rpm

# setup: bare origin plus a repo whose .gh-pages worktree holds a pushed commit "real"
setup() {
    rm -rf "${tmp:?}"/*
    git init -q --bare "$tmp/origin.git"
    git init -q -b main "$tmp/r"
    git -C "$tmp/r" commit -q --allow-empty -m init
    git -C "$tmp/r" remote add origin "$tmp/origin.git"
    git -C "$tmp/r" worktree add -q --orphan -b gh-pages "$tmp/r/.gh-pages"
    wt=$tmp/r/.gh-pages
    mkdir "$wt/fedora-43"
    echo r >"$wt/fedora-43/spawn-1.6.0-1.120.fc43.noarch.rpm"
    git -C "$wt" add -A
    git -C "$wt" commit -qm real
    git -C "$wt" push -q origin gh-pages 2>/dev/null
    git -C "$tmp/r" fetch -q origin +gh-pages:refs/remotes/origin/gh-pages
}
dirtycommit() { echo d >"$wt/$dirty43"; git -C "$wt" add -A; git -C "$wt" commit -qm dirty; }
head_is_origin() { [ "$(git -C "$wt" rev-parse HEAD)" = "$(git -C "$tmp/r" rev-parse origin/gh-pages)" ]; }

echo "== ghpages_sync"
setup; dirtycommit; ( ghpages_sync "$wt" 1 1 ) >/dev/null
{ head_is_origin && [ ! -e "$wt/$dirty43" ]; } && ok "push run drops an unpushed --allow-dirty commit" || fail "push run kept the dirty commit"

setup; dirtycommit; ( ghpages_sync "$wt" 1 0 ) >/dev/null
[ -e "$wt/$dirty43" ] && ok "local run keeps building on the local gh-pages" || fail "local run lost the local commit"

setup; echo junk >"$wt/x"; ( ghpages_sync "$wt" 1 1 ) >/dev/null
[ ! -e "$wt/x" ] && ok "push run removes untracked files" || fail "untracked file survived"

setup; dirtycommit; before=$(git -C "$wt" rev-parse HEAD); ( ghpages_sync "$wt" 0 1 ) >/dev/null
[ "$(git -C "$wt" rev-parse HEAD)" = "$before" ] && ok "without origin/gh-pages HEAD is unchanged" || fail "HEAD moved without a remote"

echo "== diverged"
setup; dirtycommit
git clone -q -b gh-pages "$tmp/origin.git" "$tmp/c"
echo n >"$tmp/c/n"; git -C "$tmp/c" add -A; git -C "$tmp/c" commit -qm other; git -C "$tmp/c" push -q origin gh-pages 2>/dev/null
git -C "$tmp/r" fetch -q origin +gh-pages:refs/remotes/origin/gh-pages
if ( ghpages_sync "$wt" 1 0 ) >/dev/null 2>&1; then fail "local run accepted a diverged branch"; fi
ok "local run refuses a diverged branch"
( ghpages_sync "$wt" 1 1 ) >/dev/null
{ [ -e "$wt/n" ] && head_is_origin && [ ! -e "$wt/$dirty43" ]; } && ok "push run on a diverged branch starts from origin" || fail "push run did not start from origin"

echo "== ghpages_refuse_dirty"
setup
( ghpages_refuse_dirty "$wt" ) >/dev/null 2>&1 && ok "a clean tree is accepted" || fail "clean tree refused"
echo d >"$wt/fedora-43/spawn-1.6.0-1.130.dirty.fc43.src.rpm"
if ( ghpages_refuse_dirty "$wt" ) >/dev/null 2>&1; then fail "dirty src.rpm accepted"; fi
ok "a .dirty source package is refused"
rm "$wt/fedora-43/spawn-1.6.0-1.130.dirty.fc43.src.rpm"; echo d >"$wt/$dirty43"
if ( ghpages_refuse_dirty "$wt" ) >/dev/null 2>&1; then fail "dirty noarch.rpm accepted"; fi
ok "a .dirty binary package is refused"

echo
echo "PASS: $pass checks"
