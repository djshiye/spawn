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
4. `SPAWN_SIGNING_KEY=<fingerprint> tools/publish.sh` builds, signs and commits to the local `.gh-pages/` worktree; look at it;
   then `SPAWN_SIGNING_KEY=<fingerprint> tools/publish.sh --push` (see "Signing"; without a key it still publishes, unsigned, with a warning).
5. Optional tag: `git tag v1.1.0 && git push origin v1.1.0` (nothing depends on it).

## The DNF repository (`tools/publish.sh`)

```
tools/publish.sh                 build from HEAD, commit to the local gh-pages worktree (.gh-pages/), push nothing
tools/publish.sh --push          the same, then push main and gh-pages (only from the main branch, clean tree)
tools/publish.sh --allow-dirty   build the working tree as it is on disk; testing only, cannot be combined with --push
tools/publish.sh --signing-key FPR   the same as SPAWN_SIGNING_KEY=FPR (see "Signing")
tools/publish.sh --rotate-key    allow a signing key different from the one already published
```

What it does, in order:

1. Refuses a dirty tree (unless `--allow-dirty`), refuses `--push` off `main`, checks the versions agree.
2. Exports the tree (`git archive HEAD`) to a temp dir, runs `npm ci` (from `package-lock.json`, `--prefer-offline`) and
   `tools/build.sh` there, and packs the export plus its `build/` into `gnome-shell-extension-spawn-<version>.tar.gz`
   (sorted, uid 0, mtime = commit time, `gzip -n`).
3. Creates or updates the `.gh-pages/` git worktree (orphan `gh-pages` branch on first use; fast-forwards from `origin/gh-pages` when it exists).
4. For each of Fedora 43, 44, 45:
   1. `podman run registry.fedoraproject.org/fedora:N`: `dnf install rpm-build glib2`,
      `rpmbuild -ba --define "release_suffix .<count>"`; the `noarch.rpm` and `src.rpm` come out in a temp directory.
   2. With a signing key: on the host, `rpmsign --addsign` each package, then verify it (see "Signing").
   3. Copy them into `.gh-pages/fedora-N/`, drop packages that do not verify against the key, keep the newest 3 of each.
   4. A second container runs `createrepo_c --update` on that directory; with a key, `repodata/repomd.xml.asc` is then made on the host.

   The dnf cache is `~/.cache/spawn-publish/dnf-N`.
5. With a key: verifies every package and every `repomd.xml.asc` once more against the exported public key file and fails if anything is unsigned.
   Then writes `spawn.repo` (`gpgcheck=1`, `repo_gpgcheck=1`, `gpgkey=https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn`; `gpgcheck=0` only while no key exists,
   `baseurl=https://djshiye.github.io/spawn/fedora-$releasever/`), `RPM-GPG-KEY-spawn`, `index.html` (with the fingerprint), `icon.svg`, `.nojekyll`
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
Until then https://djshiye.github.io/spawn/ answers 404. Before the signing key exists the packages are unsigned (`gpgcheck=0`);
create the key (next section) before the first public publish if you can.

User commands (also in the README):

```sh
sudo dnf config-manager addrepo --overwrite --from-repofile=https://djshiye.github.io/spawn/spawn.repo && sudo dnf install -y gnome-shell-extension-spawn && spawn-enable
sudo dnf upgrade
spawn-enable --remove; sudo dnf remove gnome-shell-extension-spawn
```

## Signing

Packages and repository metadata are signed with a GPG key that stays on your machine (a software key, or better a YubiKey).
Users get `gpgcheck=1` (each package) and `repo_gpgcheck=1` (`repodata/repomd.xml`, which lists every package and its checksum).
Signing happens on the host (`tools/lib/signing.sh`), never in a container, so the private key and its passphrase never enter one.

### One-time setup

1. On the machine you publish from: `tools/make-signing-key.sh`. It creates an ed25519 key that can only sign, valid for 2 years;
   gpg asks for the passphrase itself. It uploads and publishes nothing. It prints the fingerprint and the backup and YubiKey steps.
2. Back the key up offline now (secret key, public key and revocation certificate on an encrypted USB stick, away from the computer).
3. Optional: move it to a YubiKey with `keytocard` (the script prints the steps). Back up first; `keytocard` replaces the local key with a stub.
4. Install the signing tool on the publishing machine: `sudo dnf install rpm-sign` (`rpmsign` is not in the `rpm` package; `publish.sh` says so if it is missing).
5. Update the README's "Fedora (DNF repository)" section in the same commit as the first signed publish, so that the README and the
   landing page agree. Replace the unsigned note with the fingerprint and these install steps:

   ```sh
   sudo dnf config-manager addrepo --overwrite --from-repofile=https://djshiye.github.io/spawn/spawn.repo
   curl -sSfO https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn
   gpg --show-keys --fingerprint RPM-GPG-KEY-spawn      # compare with the fingerprint in the README
   sudo rpm --import RPM-GPG-KEY-spawn
   sudo dnf install -y gnome-shell-extension-spawn && spawn-enable
   ```

   Say that the key comes from the same site as the packages (trust on first use), so users should compare the fingerprint.

### Every release

```sh
export SPAWN_SIGNING_KEY=<the full 40-hex fingerprint, no spaces>   # or --signing-key FPR
tools/publish.sh            # look at .gh-pages/
tools/publish.sh --push
```

`publish.sh` asks gpg-agent to sign (passphrase prompt, or YubiKey PIN and touch): once per package and once per `repomd.xml`, so expect
several prompts per run unless gpg-agent caches the passphrase. Short key IDs are rejected: only the full fingerprint of the primary key is accepted.
Before building it checks that the key exists, has a secret part (or a card stub), can sign and is neither revoked nor expired, and it warns when expiry is less than 60 days away.

Before it commits to `gh-pages` it verifies, against a temporary keyring that holds only the exported public key
(`rpmkeys --checksig` with its own `--dbpath`, and `gpg --verify` in an empty `GNUPGHOME`), and fails hard otherwise:
every `.rpm` and `.src.rpm` in every `fedora-N/` directory is signed by that key, and every `repomd.xml.asc` is a valid signature of
its `repomd.xml` by that key. `tools/test-signing.sh` runs the same functions against a throwaway key and a dummy package
(needs `rpm`, `rpm-sign`, `createrepo_c` and `gnupg2`; no podman).

Safety rules, enforced by `publish.sh`:

- Once `.gh-pages/` contains `RPM-GPG-KEY-spawn`, publishing without a key is refused. There is no flag to publish unsigned after that;
  `spawn.repo` never silently goes back to `gpgcheck=0`.
- Once `.gh-pages/` contains `RPM-GPG-KEY-spawn`, a different fingerprint is refused unless you pass `--rotate-key`.
- Before any key has been published, publishing unsigned still works but prints a boxed warning and writes `gpgcheck=0`.

**Older packages.** The repository keeps the newest 3 builds (`KEEP=3`). Builds made before the first signed publish are unsigned and would
fail `gpgcheck=1`, which would make `dnf upgrade` fail for everybody. On a signed publish `publish.sh` therefore **drops** every package
that does not verify against the key, instead of re-signing it. Dropping is the safer choice: a signature says "the maintainer built and vouches
for these exact bytes", and re-signing would vouch for old files that were merely sitting in a git branch, without anyone rebuilding them.
The price is that the first signed publish leaves only the new version in the repository, so nobody can install or roll back to a pre-signing build.
The same rule removes packages signed by the old key after a rotation.

### Rotating or extending the key

- **Extend** (the usual case, before the key expires): `gpg --edit-key <fpr>`, then `expire`, then `save`. The fingerprint stays the same, so run
  `publish.sh` normally; it re-exports `RPM-GPG-KEY-spawn` with the new expiry. Users who already imported the old copy re-import it with
  `sudo rpm --import https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn` if dnf complains about an expired key.
- **Rotate** (key lost, leaked, or replaced by a new key on a YubiKey): make the new key (`tools/make-signing-key.sh`), then
  `publish.sh --rotate-key --signing-key <new fingerprint>`. The new key replaces `RPM-GPG-KEY-spawn`, the new build is signed by it, and
  older packages signed by the old key are dropped. Existing users still trust only the old key, so with `repo_gpgcheck=1` their next
  `dnf upgrade` fails until they import the new one. Announce the rotation (README, release notes) with the new fingerprint and tell them to run
  `sudo rpm --import https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn` after comparing it, and to remove the old key
  (`rpm -qa 'gpg-pubkey*'`, then `sudo rpm -e <name>`). If the old key was leaked, revoke it with the revocation certificate and say so.

### Trust on first use

The public key is served from the same site as the packages (`https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn`). The first time a user
installs, dnf fetches the key from there and asks them to accept it. Whoever controls that site (that is, the GitHub account) could swap the
key and the packages together, and the user would not notice. The signature therefore protects against unsigned or altered packages after you
published them (a mirror, a proxy, a stale cache, a partial compromise of the hosting) and, from the second install on, against anyone who does
not hold the private key. It does not protect a first install against a compromised GitHub account. To narrow that gap the fingerprint is in the
README and on the landing page, and users are asked to compare it with the one dnf displays. The private key lives outside GitHub, on your
machine or a YubiKey, and not in an Actions secret, so that one compromised account does not hold both the site and the key.

## Open items

1. The RPM ships the developer test code (`ui/devHooks.js`, `dev/benchmark.js`, the `Dev` D-Bus interface); all of it is inert unless the
   `dev-mode` setting (default `false`) is turned on.
