#!/usr/bin/env bash
# Build the spawn RPM in a Fedora container and publish it to the DNF repository
# that lives on the gh-pages branch (served by GitHub Pages). No CI: everything runs locally with podman.
#
#   tools/publish.sh                 build from HEAD, commit to the local gh-pages worktree
#   tools/publish.sh --push          same, then push main and gh-pages (only from the main branch)
#   tools/publish.sh --allow-dirty   build the working tree (tracked + untracked, not ignored);
#                                    for testing only, cannot be combined with --push
#
# Signing (docs/RELEASING.md, "Signing"): set SPAWN_SIGNING_KEY=<full 40-hex fingerprint> (or --signing-key FPR)
# to sign every package and repodata/repomd.xml on THIS machine with gpg (a software key or a YubiKey; the key
# never enters a container). Once the gh-pages tree holds RPM-GPG-KEY-spawn, publishing unsigned is refused and a
# different key is refused unless --rotate-key is given. Before any key exists, publishing unsigned still works
# but prints a warning.
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
PKG="spawn"
# the package name up to 1.1.1; the new package Obsoletes it, so its files are only pruned from the repository
OLD_PKG="gnome-shell-extension-spawn"
IMAGE_BASE="registry.fedoraproject.org/fedora"
KEEP=3
COMMIT_NAME="Dino Klisura"
COMMIT_EMAIL="115914552+djshiye@users.noreply.github.com"

push=0
allow_dirty=0
rotate_key=0
signing_key="${SPAWN_SIGNING_KEY:-}"
while [ $# -gt 0 ]; do
    case "$1" in
        --push) push=1 ;;
        --allow-dirty) allow_dirty=1 ;;
        --rotate-key) rotate_key=1 ;;
        --signing-key) [ $# -ge 2 ] || { echo "--signing-key needs a fingerprint" >&2; exit 2; }
                       signing_key=$2; shift ;;
        --signing-key=*) signing_key=${1#*=} ;;
        -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "usage: $0 [--push] [--allow-dirty] [--signing-key FPR] [--rotate-key]" >&2; exit 2 ;;
    esac
    shift
done
if [ "$push" -eq 1 ] && [ "$allow_dirty" -eq 1 ]; then
    echo "Refusing to push a build made with --allow-dirty." >&2
    exit 2
fi

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
wt="$root/.gh-pages"
# shellcheck source=lib/signing.sh
. "$root/tools/lib/signing.sh"

if [ -t 1 ]; then b=$'\e[1m'; c=$'\e[36m'; r=$'\e[0m'; else b=""; c=""; r=""; fi
step() { printf '%s==>%s %s%s%s\n' "$c" "$r" "$b" "$*" "$r"; }

# ---- 0. signing key (checked before the slow build) ----
signed=0
if [ -n "$signing_key" ]; then
    signed=1
    signing_key=$(signing_normalise_fpr "$signing_key")
    signing_require_tools
    signing_check_key "$signing_key"
    step "Signing with key $(signing_pretty_fpr "$signing_key")"
elif [ "$rotate_key" -eq 1 ]; then
    echo "--rotate-key needs a signing key (SPAWN_SIGNING_KEY or --signing-key)." >&2
    exit 2
fi

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
step "Exporting the tree and compiling the extension (npm ci + tools/build.sh --release)"
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
    tools/build.sh --release >"$work/build.log" 2>&1 || { tail -n 30 "$work/build.log" >&2; exit 1; }
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
# A failed earlier run may have left half-written files; start from exactly what is committed.
if git -C "$wt" rev-parse -q --verify HEAD >/dev/null; then
    git -C "$wt" reset -q --hard HEAD
fi
git -C "$wt" clean -qfdx
if [ "$have_remote" -eq 1 ]; then
    if ! git -C "$wt" merge -q --ff-only origin/gh-pages; then
        echo "Local gh-pages has diverged from origin/gh-pages; reconcile it in .gh-pages/ first." >&2
        exit 1
    fi
fi

# ---- 3b. key policy: no silent downgrade, no silent key change ----
pubkey="$wt/RPM-GPG-KEY-spawn"
published_fpr=""
# What is COMMITTED on gh-pages counts as published, not whatever is lying in the working copy.
if git -C "$wt" cat-file -e HEAD:RPM-GPG-KEY-spawn 2>/dev/null; then
    git -C "$wt" show HEAD:RPM-GPG-KEY-spawn >"$work/published-key.asc"
    published_fpr=$(signing_pubkey_fpr "$work/published-key.asc")
fi
if [ -n "$published_fpr" ] && [ "$signed" -eq 0 ]; then
    cat >&2 <<MSG
Refusing to publish unsigned: the repository already ships RPM-GPG-KEY-spawn ($(signing_pretty_fpr "$published_fpr")),
so clients use gpgcheck=1 and an unsigned package or spawn.repo would break (or silently weaken) every install.
Set SPAWN_SIGNING_KEY=$published_fpr (or --signing-key) and run again.
MSG
    exit 1
fi
if [ -n "$published_fpr" ] && [ "$signing_key" != "$published_fpr" ] && [ "$rotate_key" -eq 0 ]; then
    cat >&2 <<MSG
Refusing to publish with a different key.
  published key: $(signing_pretty_fpr "$published_fpr")
  your key:      $(signing_pretty_fpr "$signing_key")
Clients that already imported the published key will reject the new signatures. If this is a deliberate
rotation (docs/RELEASING.md, "Rotating or extending the key"), run again with --rotate-key.
MSG
    exit 1
fi
if [ "$rotate_key" -eq 1 ] && [ "$signed" -eq 1 ] && [ "$published_fpr" = "$signing_key" ]; then
    echo "   note: --rotate-key given but the key is unchanged; nothing to rotate" >&2
fi
if [ "$signed" -eq 1 ]; then
    # The key file users will fetch; everything is verified against exactly this file.
    signing_export_pubkey "$signing_key" "$wt/RPM-GPG-KEY-spawn"
    pubkey="$wt/RPM-GPG-KEY-spawn"
else
    signing_warn_box "NOT SIGNING: SPAWN_SIGNING_KEY is not set and no key has been published yet."         "spawn.repo will say gpgcheck=0: anyone who can alter the site can alter what users install."         "Create a key with tools/make-signing-key.sh, then publish with SPAWN_SIGNING_KEY=<fingerprint>."
fi

# ---- 4. build in a container, sign on the host, index in a container, per Fedora release ----
for fedora in "${FEDORA_RELEASES[@]}"; do
IMAGE="$IMAGE_BASE:$fedora"
# Fedora version in the path, like the baseurl's $releasever.
repo_dir="$wt/fedora-$fedora"
mkdir -p "$repo_dir"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/spawn-publish/dnf-$fedora"
mkdir -p "$cache"
rm -rf "$work/out"; mkdir -p "$work/out"

step "Running rpmbuild in $IMAGE"
podman run --rm \
    -v "$work:/work:Z" -v "$cache:/var/cache/libdnf5:Z" \
    -e NAME="$name" -e SUFFIX="$release_suffix" -e FEDORA="$fedora" \
    "$IMAGE" bash -euo pipefail -c '
        dnf install -y --setopt=install_weak_deps=False rpm-build glib2 >/dev/null
        [ "$(rpm -E %fedora)" = "$FEDORA" ] || { echo "container is not Fedora $FEDORA" >&2; exit 1; }
        # The package is called plain "spawn": refuse to publish if Fedora itself ever ships something by that name
        clash=$(dnf -q repoquery --whatprovides spawn --qf "%{name}\n" 2>/dev/null | sort -u)
        if [ -n "$clash" ]; then
            echo "Fedora $FEDORA now has a package providing \"spawn\" ($clash): rename ours first" >&2
            exit 1
        fi
        mkdir -p /root/rpmbuild/SOURCES
        cp /work/$NAME.tar.gz /root/rpmbuild/SOURCES/
        tar -xzOf /work/$NAME.tar.gz $NAME/build-aux/spawn.spec > /work/spawn.spec
        if ! rpmbuild -ba --define "release_suffix $SUFFIX" /work/spawn.spec >/work/rpmbuild.log 2>&1; then
            tail -n 60 /work/rpmbuild.log >&2
            exit 1
        fi
        grep -E "^(Wrote:|Checking for unpackaged)" /work/rpmbuild.log
        cp /root/rpmbuild/RPMS/noarch/*.rpm /root/rpmbuild/SRPMS/*.src.rpm /work/out/
    '

if [ "$signed" -eq 1 ]; then
    # On the host, so the private key (or the YubiKey) is never exposed to a container. Must happen before
    # createrepo_c, whose metadata records each package's checksum.
    step "Signing the Fedora $fedora packages"
    signing_sign_rpms "$signing_key" "$work"/out/*.rpm
    signing_verify_rpms "$pubkey" "$work"/out/*.rpm
fi
cp "$work"/out/*.rpm "$repo_dir/"
if [ "$signed" -eq 1 ]; then
    # Packages already in the repository that do not verify against this key would fail gpgcheck=1 for
    # everyone: drop them (see docs/RELEASING.md for why they are dropped and not re-signed).
    signing_drop_unverifiable "$pubkey" "$repo_dir"
fi
# the renamed package replaces the old one (Obsoletes), so the old-name files are no longer needed
# shellcheck disable=SC2086
rm -fv "$repo_dir"/$OLD_PKG-[0-9]*.rpm
# keep the newest $KEEP binary and source packages
for pat in "$PKG-[0-9]*.noarch.rpm" "$PKG-[0-9]*.src.rpm"; do
    # shellcheck disable=SC2012,SC2086
    ls "$repo_dir"/$pat | sort -V | head -n -"$KEEP" | xargs -r rm -v
done

step "Running createrepo_c in $IMAGE"
podman_args=(-v "$repo_dir:/repo:Z" -v "$cache:/var/cache/libdnf5:Z" -e CHECK_SIGNED="$signed")
# the public key only (read-only); the container never sees the private key
[ "$signed" -eq 0 ] || podman_args+=(-v "$pubkey:/key/RPM-GPG-KEY-spawn:ro,Z")
podman run --rm "${podman_args[@]}" \
    "$IMAGE" bash -euo pipefail -c '
        if [ "$CHECK_SIGNED" = 1 ]; then
            # this Fedora release'"'"'s own rpm must accept every package, with a keyring holding only our key
            export LC_ALL=C
            mkdir -p /tmp/k
            rpmkeys --dbpath /tmp/k --define "_keyringpath /tmp/k/pubkeys/" --import /key/RPM-GPG-KEY-spawn
            for f in /repo/*.rpm; do
                out=$(rpmkeys --dbpath /tmp/k --define "_keyringpath /tmp/k/pubkeys/" -K "$f" 2>&1) || true
                if ! printf "%s\n" "$out" | grep -q "signatures OK" \
                    || printf "%s\n" "$out" | grep -Eqi "NOT OK|NOKEY|NOTTRUSTED|BAD|MISSING"; then
                    echo "Fedora $(rpm -E %fedora) rpm rejects $f: $out" >&2
                    exit 1
                fi
            done
            echo "   Fedora $(rpm -E %fedora) rpm accepts every package"
        fi
        dnf install -y --setopt=install_weak_deps=False createrepo_c >/dev/null
        createrepo_c --update --general-compress-type gz /repo
    '
rm -f "$repo_dir/repodata/repomd.xml.asc"
if [ "$signed" -eq 1 ]; then
    step "Signing repodata/repomd.xml (Fedora $fedora)"
    signing_sign_repomd "$signing_key" "$repo_dir"
fi
done

if [ "$signed" -eq 1 ]; then
    step "Verifying every package and repomd.xml.asc against the published public key"
    signing_check_tree "$pubkey" "$wt"
    echo "   all packages and repository metadata verify"
fi

# ---- 5. repo file, landing page, commit ----
step "Writing spawn.repo and index.html"
signing_write_repo_file "$wt/spawn.repo" "$REPO_URL" "$signed"
if [ "$signed" -eq 1 ]; then
    trust_html="<p>Packages and repository metadata are signed. Key fingerprint (compare it with the README, this page comes from the same site):<br><code>$(signing_pretty_fpr "$signing_key")</code><br><a href=\"RPM-GPG-KEY-spawn\">RPM-GPG-KEY-spawn</a></p>"
    trust_note="signed packages"
else
    trust_html=""
    trust_note="unsigned packages"
fi
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
  code { color: #e6e6ee; word-break: break-word; }
  small { display: block; margin-top: 1.6em; color: #6c6c82; }
</style>
</head>
<body>
<main>
  <img src="icon.svg" alt="">
  <h1>Spawn</h1>
  <p>DNF repository for Fedora (GNOME Shell extension)</p>
  <pre>sudo dnf config-manager addrepo --from-repofile=$REPO_URL/spawn.repo
sudo dnf install spawn &amp;&amp; spawn-enable</pre>
  $trust_html
  <small><a href="https://github.com/djshiye/spawn">github.com/djshiye/spawn</a>
  &middot; $trust_note &middot; not affiliated with ArcMenu</small>
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
