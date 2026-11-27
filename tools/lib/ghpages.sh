# shellcheck shell=bash
# gh-pages worktree helpers for tools/publish.sh (sourced, not run); tested by tools/test-ghpages.sh (git only).
ghpages_die() { echo "error: $*" >&2; exit 1; }

# ghpages_sync <worktree> <have_remote 0|1> <push 0|1>
# Start from exactly what is committed. A --push run starts from exactly origin/gh-pages: local commits that
# were never pushed (test builds, earlier local runs) are rebuilt anyway and must never ride along.
ghpages_sync() {
    local wt=$1 have_remote=$2 push=$3 ahead
    if git -C "$wt" rev-parse -q --verify HEAD >/dev/null; then
        git -C "$wt" reset -q --hard HEAD
    fi
    git -C "$wt" clean -qfdx
    [ "$have_remote" -eq 1 ] || return 0
    if [ "$push" -eq 1 ]; then
        ahead=$(git -C "$wt" log --oneline origin/gh-pages..HEAD)
        if [ -n "$ahead" ]; then
            echo "   discarding local gh-pages commits that were never pushed (test or earlier local runs):"
            printf '%s\n' "$ahead" | sed 's/^/     /'
        fi
        git -C "$wt" reset -q --hard origin/gh-pages
    elif ! git -C "$wt" merge -q --ff-only origin/gh-pages; then
        ghpages_die "Local gh-pages has diverged from origin/gh-pages; reconcile it in .gh-pages/ first."
    fi
}

# ghpages_refuse_dirty <worktree>: backstop, never publish a test (--allow-dirty) package
ghpages_refuse_dirty() {
    local f bad=()
    for f in "$1"/fedora-*/*.dirty.*rpm; do [ -e "$f" ] && bad+=("${f#"$1"/}"); done
    [ "${#bad[@]}" -eq 0 ] || ghpages_die "refusing to publish test (--allow-dirty) packages: ${bad[*]}"
}
