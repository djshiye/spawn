# Developing Spawn

Everything you need to build, test and release Spawn. The user-facing overview is in the `README.md`.

## Build

Requirements: Node 20+ with npm, `glib-compile-schemas`, `zip`.

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # compiles, then runs the gjs -m unit tests in tests/
npm run build       # tools/build.sh -> build/ and dist/spawn@djshiye.github.io.shell-extension.zip
```

`npm test` skips the preferences test, with a visible notice, when the GTK 4 / libadwaita typelibs are not installed
(`gir1.2-gtk-4.0` and `gir1.2-adw-1` on Debian and Ubuntu); set `SPAWN_REQUIRE_ALL_TESTS=1` to make that a failure.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and push to `main` (documentation-only changes excepted):
typecheck, lint, unit tests (including the preferences test, which CI requires), `npm audit` and the GNOME Shell 49 /
50 compatibility typechecks. Pull requests to `main` that touch `src/`, `schemas/`, `stylesheet.css` or `tools/` also
run six scenarios in a headless GNOME Shell 51 (`tools/container/Dockerfile.ubuntu`, no network): `smoke`,
`lifecycle`, `core-panel-passthrough`, `core-tray-passthrough`, `core-panel-hover` and `core-fullscreen`. When one
fails, its screenshots and logs are uploaded for seven days. Actions are pinned by commit SHA and kept up to date by
Dependabot. The full harness (`tools/dev-shell.sh all`, with `--with-dtp` for the real Dash to Panel) stays a local
step before a release.
Security reports: see `SECURITY.md`.

## Install from a checkout


```sh
tools/install.sh                 # copies build/ to ~/.local/share/gnome-shell/extensions/<uuid>
tools/install.sh /some/data/dir  # or into <dir>/gnome-shell/extensions/<uuid>
gnome-extensions enable spawn@djshiye.github.io
```

Log out and in (Wayland) if the shell does not pick up a new extension.

## How the package installs

`spawn-enable` (installed by the package) adds the extension to GNOME's enabled list without asking the running shell:
`gnome-extensions enable` only works for extensions the shell already knows, and it learns about a newly installed
system-wide extension at the next login. The extension lands in `/usr/share/gnome-shell/extensions/` and its schema in
`/usr/share/glib-2.0/schemas/`. `spawn.repo` sets `gpgcheck=1`, `repo_gpgcheck=1` and `metadata_expire=1h`, so a plain
`sudo dnf upgrade` sees a new release within an hour without `--refresh` (GNOME Software checks about once a day). The
signing key is downloaded from the same site as the packages, so comparing its fingerprint with the README is what
makes it trustworthy. To forget the repository after uninstalling: `sudo rm /etc/yum.repos.d/spawn.repo`.

## Releasing

`docs/RELEASING.md`: version bump, one-command releases (`tools/release.sh`), the DNF repository (`tools/publish.sh`) and package signing (`tools/make-signing-key.sh`).

## Develop without touching your session

`tools/dev-shell.sh` starts a headless GNOME Shell inside its own `dbus-run-session` with
isolated `XDG_*` directories under `.dev/`. It never touches your running session, your dconf
or your installed extensions (the inner script refuses to run unless every XDG dir is inside
`.dev/`, and `tools/dev-shell.sh isolation` proves it).

```sh
tools/build.sh
tools/dev-shell.sh all                      # EVERYTHING below, each in a fresh shell; fails on any spawn error
tools/dev-shell.sh smoke                    # enable, wait, screenshot to .dev/shots/smoke.png
tools/dev-shell.sh lifecycle                # enable -> open -> search -> close -> disable -> enable
tools/dev-shell.sh hotkeys                  # Super interception in memory, accelerator bind/unbind
tools/dev-shell.sh theme                    # generated stylesheet written / regenerated / removed
tools/dev-shell.sh dtp-toggle --with-dtp    # toggle Dash to Panel 10x (+ a rapid burst), button stays attached
tools/dev-shell.sh dtp-open --with-dtp      # menu on Dash to Panel's bottom panel opens upward (arrow BOTTOM)
tools/dev-shell.sh ui                       # all ui-* scenarios in one session (see below)
tools/dev-shell.sh ui-dnd                   # a single ui scenario
tools/dev-shell.sh runner                   # the standalone runner (ToggleRunner, runner-hotkey, search, Return, Escape)
tools/dev-shell.sh shots                    # review screenshots -> .dev/shots/final/
tools/dev-shell.sh bench                    # in-shell benchmark -> table, raw JSON in .dev/bench.json
```

`all` runs smoke, lifecycle, hotkeys, theme, dtp-toggle, dtp-open, ui, runner, shots and bench, prints a
PASS/FAIL summary and exits non-zero if any scenario failed or any `[spawn] ERROR:` /
`JS ERROR` mentioning the extension showed up in a shell log. Per-scenario output and shell logs
are kept in `.dev/logs/`.

Seeded scenarios (`ui*`, `dtp-open`, `runner`, `shots`, `bench`, or any scenario with `--seed`) load
`tools/dev/seed.ini` into the sandbox dconf: the user's pinned apps, three folders (one with
only missing apps, to exercise the fallback icon), shortcuts, power buttons, the Fedora button icon,
and the Orchis-Dark-Compact shell theme through the user-theme extension when both are installed.
`--with-dtp` copies Dash to Panel from your user extensions directory into the isolated data dir.

The ui scenarios live in `tools/dev/scenarios/ui-*.sh` (open/close 20x, keyboard navigation,
drag and drop, context menus, folder rename, search, settings variants, tooltips, views); they are
sourced by `tools/dev-shell-inner.sh` and use its helpers (`open_menu`, `key`, `click`,
`ui_call`, `state_get`, `expect`, `expect_state`, `check`, `screenshot`, `reset_seed`). Any other
`tools/dev/scenarios/<name>.sh` is runnable as `tools/dev-shell.sh <name>`.

Dev-only D-Bus (dev builds only, never in a release package; exported only while the sandbox's `dev-mode` setting is true):
`io.github.djshiye.Spawn.Dev` (`Open`, `Close`, `Search`, `Screenshot`, `AttachmentStatus`,
`HotkeyStatus`, `OpenRunner`, `CloseRunner`, `RunnerState`, `EmitOverlayKey`, `Benchmark`) and `io.github.djshiye.Spawn.Ui` at
`/io/github/djshiye/Spawn/Ui` (`Search`, `ShowView`, `OpenFolder`, `Key`, `Click`, `Move`, `Drag`,
`Pick`, `State`; see `src/ui/devHooks.ts`).

## Benchmark

`tools/dev-shell.sh bench` calls `Dev.Benchmark`, which measures inside the shell with
`GLib.get_monotonic_time()`: `enable()` duration, a fresh `AppIndex.build()`, popup open to mapped
and to first painted frame (`after-paint`) for the first open, a lazily rebuilt layout and 20
steady-state opens, and search latency for ten queries (debounce bypassed) for the apps provider
and for all enabled providers. The headless shell renders on the real GPU (`renderD128`), so paint
numbers are meaningful, but a virtual monitor has no scanout, so "painted" ends at the stage's
`after-paint` signal.

Preferences can be screenshotted the same way with `tools/dev-prefs.sh [--apply-import] [pages...]`.

## Where things are

See `docs/SPEC.md` (spec and module ownership), `docs/SETTINGS.md` (every setting and the
ArcMenu key it migrates from), `docs/RELEASING.md` (packaging and publishing the DNF repository)
and `docs/research/` (notes on ArcMenu's internals).
