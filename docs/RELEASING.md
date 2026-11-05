# Releasing Spawn

Spawn is distributed as an RPM (`gnome-shell-extension-spawn`) from a DNF repository on GitHub Pages
(https://djshiye.github.io/spawn/). It is not published on extensions.gnome.org.

## Versions

`package.json` `version` is the single source of truth. Two places mirror it and
`tools/bump-version.sh --check` (run by `publish.sh`) fails if any differs:

- `metadata.json` `version-name` (shown by GNOME's Extensions app),
- `build-aux/spawn.spec` `Version:` and the newest `%changelog` entry.

The RPM `Release` is `1.<commit count>.<dist>`, appended by `publish.sh`, so every build from `main` upgrades the previous one.
`metadata.json` `"version"` (an integer) is GNOME's extension counter and is not used by the RPM.

## Cut a release

1. Finish the work on `main`; `npm run typecheck && npm run lint && npm test && tools/dev-shell.sh all` must pass.
2. `tools/bump-version.sh 1.1.0 "what changed"` (updates package.json, package-lock.json, metadata.json, the spec and its changelog), review and commit.
3. If the supported shells changed: edit `shell-version` in `metadata.json` and `%global min_shell` in `build-aux/spawn.spec`
   (the RPM must not be installable on a shell the extension refuses to load on).
4. `tools/publish.sh` builds and commits to the local `.gh-pages/` worktree; look at it; then `tools/publish.sh --push`.
5. Optional tag: `git tag v1.1.0 && git push origin v1.1.0` (nothing depends on it).

## The DNF repository (`tools/publish.sh`)

```
tools/publish.sh                 build from HEAD, commit to the local gh-pages worktree (.gh-pages/), push nothing
tools/publish.sh --push          the same, then push main and gh-pages (only from the main branch, clean tree)
tools/publish.sh --allow-dirty   build the working tree as it is on disk; testing only, cannot be combined with --push
```

What it does, in order:

1. Refuses a dirty tree (unless `--allow-dirty`), refuses `--push` off `main`, checks the versions agree.
2. Exports the tree (`git archive HEAD`) to a temp dir, runs `npm ci` (from `package-lock.json`, `--prefer-offline`) and
   `tools/build.sh` there, and packs the export plus its `build/` into `gnome-shell-extension-spawn-<version>.tar.gz`
   (sorted, uid 0, mtime = commit time, `gzip -n`).
3. Creates or updates the `.gh-pages/` git worktree (orphan `gh-pages` branch on first use; fast-forwards from `origin/gh-pages` when it exists).
4. For each of Fedora 43, 44, 45: `podman run registry.fedoraproject.org/fedora:N`, `dnf install rpm-build createrepo_c glib2`,
   `rpmbuild -ba --define "release_suffix .<count>"`, copy the `noarch.rpm` and `src.rpm` into `.gh-pages/fedora-N/`, keep the newest 3 of each, `createrepo_c --update`.
   The dnf cache is `~/.cache/spawn-publish/dnf-N`.
5. Writes `spawn.repo` (`gpgcheck=0`, `baseurl=https://djshiye.github.io/spawn/fedora-$releasever/`), `index.html`, `icon.svg`, `.nojekyll`
   and commits them to `gh-pages` as Dino Klisura (`GIT_AUTHOR_*`/`GIT_COMMITTER_*` set explicitly, no trailers).
6. With `--push`: `git push origin main`, then `git -C .gh-pages push origin gh-pages` (a plain, non-forced push; on the very first publish this creates the remote `gh-pages` branch).

A test run (`--allow-dirty`) leaves a local `gh-pages` branch with `.dirty` packages in it. Delete it before the real publish,
otherwise `publish.sh` builds on top of it: `git worktree remove --force .gh-pages && git branch -D gh-pages`.

Why the extension is compiled on the host and not in the container: building needs Node, `tsc` and the type packages
from npm. Doing that in the container would need the npm registry at build time, and Fedora's nodejs differs per release.
Compiling once from the lockfile ships the same bytes for all three Fedora releases and the containers only need the Fedora mirrors.
The price is that the SRPM holds a prebuilt `build/` tree next to the sources (documented in the spec);
`npm ci && tools/build.sh` on the unpacked source regenerates it.

### Package layout

`gnome-shell-extension-spawn` (Fedora's naming convention for shell extensions; `dnf repoquery '*spawn*'` finds no clashing
package in F43/44/45), noarch, `Requires: gnome-shell >= 49`, `glib2`, `gjs`:

- `/usr/share/gnome-shell/extensions/spawn@djshiye.github.io/`: the `build/` tree minus `schemas/`.
- `/usr/share/glib-2.0/schemas/org.gnome.shell.extensions.spawn.gschema.xml`, compiled by glib2's file trigger. Spawn's own
  `gschemas.compiled` is not shipped. `src/extension.ts` uses the default schema source when the extension has no `schemas/`
  directory (as `Extension.getSettings()` does). `data/migration/arcmenu/gschemas.compiled` (ArcMenu's schema, read by the import) is shipped on purpose.
- `/usr/bin/spawn-enable` (`build-aux/spawn-enable`, a gjs script): adds the UUID to `org.gnome.shell` `enabled-extensions`
  (keeping the other entries, no duplicates) and removes it from `disabled-extensions`; `--remove` takes it off again.
  Needed because `gnome-extensions enable` talks to the running shell, which does not know a freshly installed system extension until the next login.

### First publish (once)

After the first `--push`, enable GitHub Pages: repository Settings, Pages, "Deploy from a branch", branch `gh-pages`, folder `/ (root)`.
Until then https://djshiye.github.io/spawn/ answers 404. Packages are unsigned (`gpgcheck=0`).

User commands (also in the README):

```sh
sudo dnf config-manager addrepo --overwrite --from-repofile=https://djshiye.github.io/spawn/spawn.repo && sudo dnf install -y gnome-shell-extension-spawn && spawn-enable
sudo dnf upgrade
spawn-enable --remove; sudo dnf remove gnome-shell-extension-spawn
```

## Open items

1. The RPM ships the developer test code (`ui/devHooks.js`, `dev/benchmark.js`, the `Dev` D-Bus interface); all of it is inert unless the
   `dev-mode` setting (default `false`) is turned on.
