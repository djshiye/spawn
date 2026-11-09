# Releasing Spawn

Spawn is distributed as an RPM (`spawn`) from a DNF repository on GitHub Pages
(https://djshiye.github.io/spawn/). It is not published on extensions.gnome.org.

## Versions

`package.json` `version` is the single source of truth. Two places mirror it and
`tools/bump-version.sh --check` (run by `publish.sh`) fails if any differs:

- `metadata.json` `version-name` (shown by GNOME's Extensions app),
- `build-aux/spawn.spec` `Version:` and the newest `%changelog` entry.

The RPM `Release` is `1.<commit count>.<dist>`, appended by `publish.sh`, so every build from `main` upgrades the previous one.
`metadata.json` `"version"` (an integer) is GNOME's extension counter and is not used by the RPM.

## Cut a release

1. Finish the work on `main`. CI (`.github/workflows/ci.yml`) must be green; it runs typecheck, lint, tests and the
   `smoke` / `lifecycle` shell scenarios but not the whole harness, so also run `tools/dev-shell.sh all` locally.
   Move the `CHANGELOG.md` "Unreleased" entries under the new version.
2. `tools/bump-version.sh 1.1.0 "what changed"` (updates package.json, package-lock.json, metadata.json, the spec and its changelog), review and commit.
3. If the supported shells changed: edit `shell-version` in `metadata.json` and `%global min_shell` in `build-aux/spawn.spec`
   (the RPM must not be installable on a shell the extension refuses to load on).
4. On the release machine: `tools/release.sh`. That is the whole publish (see "One-command releases" below).
5. Optional tag: `git tag v1.1.0 && git push origin v1.1.0` (nothing depends on it).

## One-command releases (`tools/release.sh`)

```sh
tools/release.sh            # the whole release: build, sign, verify, push, and wait until it is live
tools/release.sh --check    # changes nothing: are the tools, the key and git push access ready, is the site up to date?
tools/release.sh --no-wait  # push, but do not wait for GitHub Pages
```

Run it on the release machine (Dino's Fedora PC, where the signing key lives) from a clean checkout. In order, it:

1. checks the tools (git, gpg, rpm-sign, podman, npm, curl);
2. switches to `main`, fast-forwards it from GitHub (never merges or rebases), re-runs itself if `release.sh` changed, and checks the versions agree;
3. checks the signing key `D49A 3081 6825 7FDB F9D5 AE14 BD1A C1C6 F56A 7252` is present and able to sign, and that it is the key already published;
4. checks this machine's git can push to GitHub (a `--dry-run` push, which changes nothing);
5. stops early, with only the live check, if this exact version and release are already on `gh-pages` (so running it twice never re-signs or republishes);
6. unlocks the key once, up front: if gpg-agent needs the password it shows its own password box on screen, before the long build rather than in the middle of it;
7. runs `SPAWN_SIGNING_KEY=<key> tools/publish.sh --push`, which builds in Fedora containers, signs on the host, verifies every
   signature (gpg and each Fedora release's own `rpmkeys`), commits and pushes `main` and `gh-pages` (plain pushes, never forced);
8. checks GitHub's `gh-pages` is exactly the commit built here, then waits (up to 15 minutes) until the live site serves the same
   signed `repomd.xml` for every Fedora release, with a matching key and a `spawn.repo` that requires signatures.

It prints `spawn <version>-<release> is live and signed for Fedora 43 44 45.` when everything checks out, and
`Release stopped: <reason>` otherwise. Nothing is pushed unless every signature has verified.

### Running it from a Claude session

Release threads run `/home/dino/Coding/spawn/tools/release.sh` through Remote Control on the Fedora PC, so Dino does not type
anything. Claude Code's permission checker blocks pushes to a public site by default, so that machine has one narrow allow rule,
for that script only, in `~/Coding/.claude/settings.local.json` (local to that machine, never committed):

```json
{ "permissions": { "allow": [
  "Bash(/home/dino/Coding/spawn/tools/release.sh)",
  "Bash(/home/dino/Coding/spawn/tools/release.sh --check)",
  "Bash(/home/dino/Coding/spawn/tools/release.sh --no-wait)"
] } }
```

No `git push` or other wildcard is allowed. The script only ever publishes what is on GitHub's `main`, so the rule lets a session
publish main, not arbitrary changes. Push access is the machine's own signed-in git; no token lives in the repository, CI or chat.

### The signing password

gpg-agent keeps a typed password in memory for 10 minutes after its last use (`default-cache-ttl`, Fedora's default), at most
2 hours. `release.sh` unlocks the key once at the start and touches it every 4 minutes while `publish.sh` runs, so a release asks
for the password at most once, and the agent forgets it about 10 minutes after the release ends. Nothing stores it on disk.

If the key has no password (`release.sh --check` says so), nothing is ever asked and a release needs nobody at the PC. The cost:
any program running as your user can sign with it, and a copy of the key file is usable without a password. On a machine with
full-disk encryption that mostly matters against malware running as you, which could also push with your git login anyway, so the
password adds a prompt per release for limited extra protection. To add one anyway:
`gpg --change-passphrase D49A308168257FDBF9D5AE14BD1AC1C6F56A7252` (gpg asks in its own box; do it at the PC). Releases then ask once.
If it has a password, do not remove it or save it in a keyring just to avoid that one prompt.

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
   `tools/build.sh` there, and packs the export plus its `build/` into `spawn-<version>.tar.gz`
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

`spawn` (short to type; no package in Fedora 43-45 or RPM Fusion is called or provides `spawn`, and `publish.sh` checks
that again on every release, because a real Fedora package of that name would clash). Up to 1.1.1 it was
`gnome-shell-extension-spawn`; the spec `Obsoletes` that name, so `dnf upgrade` moves old installs over, and `Provides` it,
so `dnf install gnome-shell-extension-spawn` still works. noarch, `Requires: gnome-shell >= 49`, `glib2`, `gjs`:

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
sudo dnf config-manager addrepo --overwrite --from-repofile=https://djshiye.github.io/spawn/spawn.repo && sudo dnf install -y spawn && spawn-enable
sudo dnf upgrade
spawn-enable --remove; sudo dnf remove spawn
```

## Signing

Packages and repository metadata are signed with a GPG key that stays on your machine. The layout is the usual best practice:
an **offline certify-only primary key** (ed25519, no expiry) kept on an encrypted stick, and a **signing subkey** (ed25519, no expiry)
in your everyday keyring or, better, on a YubiKey. `RPM-GPG-KEY-spawn` is the full public certificate (primary, subkey and their
binding signatures); its fingerprint is the primary's, and `publish.sh` is always told the primary's fingerprint.

Why nothing expires: dnf remembers a repository key by the primary key's ID and never refreshes it (its repo keyring is
`<cachedir>/pubring`). A key that expires, or whose expiry is extended afterwards, breaks every user's `dnf upgrade` until each of them
re-imports it by hand, so there is no expiry to run into. The protection against a leaked subkey is revocation and replacement (below),
not a timer.
Users get `gpgcheck=1` (each package) and `repo_gpgcheck=1` (`repodata/repomd.xml`, which lists every package and its checksum).
Signing happens on the host (`tools/lib/signing.sh`), never in a container, so the private key and its passphrase never enter one.

### One-time setup

1. On the machine you publish from: `tools/make-signing-key.sh`. It creates one ed25519 signing key with no expiry
   (gpg asks for the passphrase itself), prints the fingerprint, and uploads nothing.
2. Back it up once with the command it prints (`gpg --export-secret-keys --armor <fpr> > ~/spawn-signing-key-backup.asc`)
   and keep that file somewhere safe outside the repository, such as a password manager or a USB stick. Never commit it.
3. Optional extra hardening, not required: an offline primary with a signing subkey, or a YubiKey (`keytocard`).
   `publish.sh` accepts those layouts too.
4. Install the signing tool on the publishing machine: `sudo dnf install rpm-sign` (`rpmsign` is not in the `rpm` package; `publish.sh` says so if it is missing).
5. Update the README's "Fedora (DNF repository)" section in the same commit as the first signed publish, so that the README and the
   landing page agree. Replace the unsigned note with the fingerprint and these install steps:

   ```sh
   sudo dnf config-manager addrepo --overwrite --from-repofile=https://djshiye.github.io/spawn/spawn.repo
   curl -sSfO https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn
   gpg --show-keys --fingerprint RPM-GPG-KEY-spawn      # compare with the fingerprint in the README
   sudo rpm --import RPM-GPG-KEY-spawn
   sudo dnf install -y spawn && spawn-enable
   ```

   Say that the key comes from the same site as the packages (trust on first use), so users should compare the fingerprint.

### Every release

```sh
export SPAWN_SIGNING_KEY=<the full 40-hex fingerprint, no spaces>   # or --signing-key FPR
tools/publish.sh            # look at .gh-pages/
tools/publish.sh --push
```

Normally `tools/release.sh` does this for you. `publish.sh` asks gpg-agent to sign (passphrase prompt, or YubiKey PIN and touch): once per package and once per `repomd.xml`; gpg-agent caches a typed passphrase, so a software key asks once (a YubiKey asks for a touch each time).
Short key IDs are rejected: only the full fingerprint of the primary key is accepted. Before building it checks that the primary is
neither revoked nor expired and that a valid, unexpired signing key (a subkey, or the primary) has its secret here or on a card; `sec#`
and `ssb>` are fine, and a key with no usable signing subkey is refused.

GitHub Pages caches for about 10 minutes. Right after a publish a user may see "Bad GPG signature" or a checksum error because the
cache holds the new `repomd.xml` but the old `repomd.xml.asc` (or the reverse); it clears by itself, and `sudo dnf clean all` speeds it up.

Before it commits to `gh-pages` it verifies, against a temporary keyring that holds only the exported public key
(`rpmkeys --checksig` with its own `--dbpath`, and `gpg --verify` in an empty `GNUPGHOME`), and fails hard otherwise:
every `.rpm` and `.src.rpm` in EVERY `fedora-*/` directory of the gh-pages tree (including releases no longer built) is signed by that key,
and every `repomd.xml.asc` is a good signature of its `repomd.xml` by that key (GOODSIG and a VALIDSIG for the primary's fingerprint).
A directory that fails stops the publish; remove it (`git -C .gh-pages rm -r fedora-N`) if that release is no longer supported.
In addition each Fedora container checks its own packages with that release's rpm (`rpmkeys --dbpath /tmp/k --import` of the key,
then `-K`) before running `createrepo_c`. The gh-pages worktree is reset to its last commit and cleaned at the start of every run, and
"already published" means what is committed at `HEAD` of `gh-pages`, not what happens to lie in the working copy. `tools/test-signing.sh` runs the same functions against a throwaway key and a dummy package
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

### Replacing the signing subkey

Use this when the YubiKey or the laptop's subkey is lost, broken or suspected stolen. The primary (from the stick) stays the same, so users keep
trusting the same identity.

1. Get the primary secret back temporarily (import the backup on a trusted machine, ideally offline), then
   `gpg --edit-key <primary fpr>`, `addkey` (ed25519, sign, no expiry), optionally `keytocard` it, and `save`. If the old subkey was
   leaked or must not be trusted any more, `key N` then `revkey` first. Export the subkeys, remove the primary secret again, as in setup step 2.
2. `publish.sh` as usual (same primary fingerprint, so no `--rotate-key`). It exports the updated certificate, so `RPM-GPG-KEY-spawn` now holds
   the new subkey (and the revocation of the old one).
3. Existing users already hold the old certificate, and dnf does not refresh a key it knows, so they must update it themselves. Say so in the
   release notes: `sudo rpm --import https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn && sudo dnf clean all`. Both are needed:
   `rpm --import` updates rpm's keyring (package checks), but dnf's own repository keyring (used for `repo_gpgcheck`) is only
   rebuilt after `dnf clean all`. Until then `dnf upgrade` reports a bad signature. New installs are unaffected.

### Rotating to a new primary key

Only if the primary itself is lost or leaked (revoke it with the stored revocation certificate and say so publicly): make a new key with
`tools/make-signing-key.sh`, then `publish.sh --rotate-key --signing-key <new primary fingerprint>`. The new certificate replaces
`RPM-GPG-KEY-spawn`, the new build is signed by it, and packages signed by the old key are dropped. Existing users trust only the old key, so
with `repo_gpgcheck=1` their next `dnf upgrade` fails until they accept the new one. Announce it with the new fingerprint in the README and
the release notes. They take it through dnf's normal import prompt, comparing the fingerprint dnf shows with the announced one
(`sudo dnf clean all` first, so that dnf asks again). Warn them that `dnf -y` and `--assumeyes` accept the key without showing it, which
defeats the check; they should answer the prompt themselves. They may remove the old key afterwards (`rpm -qa 'gpg-pubkey*'`, then `sudo rpm -e <name>`).

### Trust on first use

The public key is served from the same site as the packages (`https://djshiye.github.io/spawn/RPM-GPG-KEY-spawn`). The first time a user
installs, dnf fetches the key from there and asks them to accept it. Whoever controls that site (that is, the GitHub account) could swap the
key and the packages together, and the user would not notice. The signature therefore protects against unsigned or altered packages after you
published them (a mirror, a proxy, a stale cache, a partial compromise of the hosting) and, from the second install on, against anyone who does
not hold the private key. It does not protect a first install against a compromised GitHub account. To narrow that gap the fingerprint is in the
README and on the landing page, and users are asked to compare it with the one dnf displays. The primary key lives on an offline stick and the signing subkey on your
machine or a YubiKey, both outside GitHub and not in an Actions secret, so that one compromised account does not hold both the site and the key.

## Open items

1. The RPM ships the developer test code (`ui/devHooks.js`, `dev/benchmark.js`, the `Dev` D-Bus interface); all of it is inert unless the
   `dev-mode` setting (default `false`) is turned on.
