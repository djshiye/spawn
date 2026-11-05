#!/usr/bin/env bash
# Build the gnome-shell-extension-spawn RPM in a Fedora container and publish it to the DNF repository
# that lives on the gh-pages branch (served by GitHub Pages). No CI: everything runs locally with podman.
#
#   tools/publish.sh                 build from HEAD, commit to the local gh-pages worktree
#   tools/publish.sh --push          same, then push main and gh-pages (only from the main branch)
#   tools/publish.sh --allow-dirty   build the working tree (tracked + untracked, not ignored);
#                                    for testing only, cannot be combined with --push
#
# The extension is compiled ONCE on the host (npm ci from package-lock.json + tools/build.sh, in an exported
# copy of the tree) and that build/ tree is packed into the source tarball next to the git archive; the
# containers only run rpmbuild, so the package is identical on every Fedora release and needs no network
# inside the container beyond the Fedora mirrors. See docs/RELEASING.md.
set -euo pipefail

# Where the repository is served. Switch to https://raw.githubusercontent.com/djshiye/spawn/gh-pages
# if GitHub Pages cannot be used.
REPO_URL="https://djshiye.github.io/spawn"
# The package is noarch and identical everywhere; one directory per Fedora release keeps the layout
# (and the $releasever baseurl) the same as the other repositories.
FEDORA_RELEASES=(43 44 45)
PKG="gnome-shell-extension-spawn"
IMAGE_BASE="registry.fedoraproject.org/fedora"
KEEP=3
COMMIT_NAME="Dino Klisura"
COMMIT_EMAIL="115914552+djshiye@users.noreply.github.com"

push=0
allow_dirty=0
for arg in "$@"; do
    case "$arg" in
        --push) push=1 ;;
        --allow-dirty) allow_dirty=1 ;;
        -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "usage: $0 [--push] [--allow-dirty]" >&2; exit 2 ;;
    esac
done
if [ "$push" -eq 1 ] && [ "$allow_dirty" -eq 1 ]; then
    echo "Refusing to push a build made with --allow-dirty." >&2
    exit 2
fi

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
wt="$root/.gh-pages"

if [ -t 1 ]; then b=$'\e[1m'; c=$'\e[36m'; r=$'\e[0m'; else b=""; c=""; r=""; fi
step() { printf '%s==>%s %s%s%s\n' "$c" "$r" "$b" "$*" "$r"; }

# ---- 1. version + release suffix ----
if [ "$allow_dirty" -eq 0 ] && [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is dirty; commit or stash first (or use --allow-dirty to test)." >&2
    git status --short >&2
    exit 1
fi
if [ "$push" -eq 1 ] && [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
    echo "--push publishes main; check out main first." >&2
    exit 1
fi
if [ "$allow_dirty" -eq 0 ]; then
    tools/bump-version.sh --check >/dev/null
else
    tools/bump-version.sh --check
fi
version=$(awk '/^Version:/ {print $2; exit}' build-aux/spawn.spec)
release_suffix=.$(git rev-list --count HEAD)
[ "$allow_dirty" -eq 0 ] || release_suffix+=.dirty
name=$PKG-$version
step "Building $name (release suffix $release_suffix) for Fedora ${FEDORA_RELEASES[*]}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/out"

# ---- 2. export the tree, compile it once on the host, make the source tarball ----
step "Exporting the tree and compiling the extension (npm ci + tools/build.sh)"
mkdir -p "$work/tree/$name"
if [ "$allow_dirty" -eq 0 ]; then
    git archive --format=tar HEAD | tar -x -C "$work/tree/$name"
else
    # tracked + untracked files that are not ignored, as they are on disk right now
    git ls-files -z --cached --others --exclude-standard | sort -z | while IFS= read -r -d '' f; do
        if [ -e "$f" ] || [ -L "$f" ]; then printf '%s\0' "$f"; fi
    done | tar --null -T - -cf - | tar -x -C "$work/tree/$name"
fi
(
    cd "$work/tree/$name"
    npm ci --prefer-offline --no-audit --no-fund --ignore-scripts >"$work/npm.log" 2>&1 \
        || { tail -n 30 "$work/npm.log" >&2; exit 1; }
    tools/build.sh >"$work/build.log" 2>&1 || { tail -n 30 "$work/build.log" >&2; exit 1; }
    # the tarball is the git archive plus build/; not the tools' scratch output
    rm -rf node_modules dist build/.built
)
epoch=$(git log -1 --format=%ct)
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@$epoch" -C "$work/tree" -cf - "$name" \
    | gzip -n > "$work/$name.tar.gz"

# ---- 3. gh-pages worktree ----
step "Preparing the gh-pages worktree (.gh-pages/)"
# Base on origin/gh-pages whenever it exists so the final push is a fast-forward.
if git fetch -q origin +gh-pages:refs/remotes/origin/gh-pages 2>/dev/null; then
    echo "   fetched origin/gh-pages"
fi
have_remote=0
git show-ref --verify --quiet refs/remotes/origin/gh-pages && have_remote=1
if ! git worktree list --porcelain | grep -qx "worktree $wt"; then
    if git show-ref --verify --quiet refs/heads/gh-pages; then
        git worktree add "$wt" gh-pages
    elif [ "$have_remote" -eq 1 ]; then
        git worktree add -b gh-pages "$wt" origin/gh-pages
    else
        git worktree add --orphan -b gh-pages "$wt"
    fi
fi
if [ "$have_remote" -eq 1 ]; then
    if ! git -C "$wt" merge -q --ff-only origin/gh-pages; then
        echo "Local gh-pages has diverged from origin/gh-pages; reconcile it in .gh-pages/ first." >&2
        exit 1
    fi
fi

# ---- 4. build, copy, prune and index inside a container per Fedora release ----
for fedora in "${FEDORA_RELEASES[@]}"; do
IMAGE="$IMAGE_BASE:$fedora"
# Fedora version in the path, like the baseurl's $releasever.
repo_dir="$wt/fedora-$fedora"
mkdir -p "$repo_dir"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/spawn-publish/dnf-$fedora"
mkdir -p "$cache"
rm -rf "$work/out"; mkdir -p "$work/out"

step "Running rpmbuild and createrepo_c in $IMAGE"
podman run --rm \
    -v "$work:/work:Z" -v "$repo_dir:/repo:Z" -v "$cache:/var/cache/libdnf5:Z" \
    -e NAME="$name" -e PKG="$PKG" -e SUFFIX="$release_suffix" -e FEDORA="$fedora" -e KEEP="$KEEP" \
    "$IMAGE" bash -euo pipefail -c '
        dnf install -y --setopt=install_weak_deps=False rpm-build createrepo_c glib2 >/dev/null
        [ "$(rpm -E %fedora)" = "$FEDORA" ] || { echo "container is not Fedora $FEDORA" >&2; exit 1; }
        mkdir -p /root/rpmbuild/SOURCES
        cp /work/$NAME.tar.gz /root/rpmbuild/SOURCES/
        tar -xzOf /work/$NAME.tar.gz $NAME/build-aux/spawn.spec > /work/spawn.spec
        if ! rpmbuild -ba --define "release_suffix $SUFFIX" /work/spawn.spec >/work/rpmbuild.log 2>&1; then
            tail -n 60 /work/rpmbuild.log >&2
            exit 1
        fi
        grep -E "^(Wrote:|Checking for unpackaged)" /work/rpmbuild.log
        cp /root/rpmbuild/RPMS/noarch/*.rpm /root/rpmbuild/SRPMS/*.src.rpm /work/out/
        cp /work/out/*.rpm /repo/
        # keep the newest $KEEP binary and source packages
        for pat in "$PKG-[0-9]*.noarch.rpm" "$PKG-[0-9]*.src.rpm"; do
            ls /repo/$pat | sort -V | head -n -"$KEEP" | xargs -r rm -v
        done
        createrepo_c --update --general-compress-type gz /repo
    '
done

# ---- 5. repo file, landing page, commit ----
step "Writing spawn.repo and index.html"
cat > "$wt/spawn.repo" <<REPO
[spawn]
name=Spawn
baseurl=$REPO_URL/fedora-\$releasever/
enabled=1
# The packages are built locally and are not signed.
gpgcheck=0
metadata_expire=1h
REPO
touch "$wt/.nojekyll"
cat > "$wt/icon.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#9b6bff"/><stop offset="1" stop-color="#22d3ee"/>
  </linearGradient></defs>
  <rect width="96" height="96" rx="22" fill="#161720"/>
  <g fill="url(#g)"><rect x="22" y="24" width="20" height="20" rx="5"/><rect x="54" y="24" width="20" height="20" rx="5"/>
  <rect x="22" y="56" width="20" height="20" rx="5"/><rect x="54" y="56" width="20" height="20" rx="5"/></g>
</svg>
SVG
cat > "$wt/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spawn DNF repository</title>
<link rel="icon" href="icon.svg">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c0d11;
         color: #e6e6ee; font: 16px/1.5 system-ui, sans-serif; }
  main { width: min(640px, 92vw); text-align: center; }
  img { width: 96px; height: 96px; }
  h1 { margin: .4em 0 .1em; font-size: 2rem;
       background: linear-gradient(90deg, #9b6bff, #22d3ee); -webkit-background-clip: text;
       background-clip: text; color: transparent; }
  p { margin: 0 0 1.4em; color: #9a9ab0; }
  pre { margin: 0; padding: 1em 1.2em; text-align: left; overflow-x: auto; background: #161720;
        border: 1px solid #262838; border-radius: 12px; font-size: .85rem; }
  a { color: #22d3ee; }
  small { display: block; margin-top: 1.6em; color: #6c6c82; }
</style>
</head>
<body>
<main>
  <img src="icon.svg" alt="">
  <h1>Spawn</h1>
  <p>DNF repository for Fedora (GNOME Shell extension)</p>
  <pre>sudo dnf config-manager addrepo --from-repofile=$REPO_URL/spawn.repo
sudo dnf install $PKG
gnome-extensions enable spawn@djshiye.github.io</pre>
  <small><a href="https://github.com/djshiye/spawn">github.com/djshiye/spawn</a>
  &middot; unsigned packages &middot; not affiliated with ArcMenu</small>
</main>
</body>
</html>
HTML

step "Committing to gh-pages"
git -C "$wt" add -A
if git -C "$wt" diff --cached --quiet; then
    echo "   nothing changed"
else
    GIT_AUTHOR_NAME=$COMMIT_NAME GIT_AUTHOR_EMAIL=$COMMIT_EMAIL \
    GIT_COMMITTER_NAME=$COMMIT_NAME GIT_COMMITTER_EMAIL=$COMMIT_EMAIL \
        git -C "$wt" commit -q -m "Publish $name-1$release_suffix for Fedora ${FEDORA_RELEASES[*]}"
    git -C "$wt" log --oneline -1
fi

# ---- 6. push (only on request): main first, then gh-pages ----
if [ "$push" -eq 1 ]; then
    step "Pushing main and gh-pages"
    git push origin main
    git -C "$wt" push origin gh-pages
else
    echo
    echo "Built locally, nothing pushed. To publish: tools/publish.sh --push"
fi
echo "Repository directories: $wt/fedora-{$(IFS=,; echo "${FEDORA_RELEASES[*]}")}"
