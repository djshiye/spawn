# Spawn

A fast, resilient application menu for GNOME Shell 49, 50 and 51. It replaces
[ArcMenu](https://gitlab.com/arcmenu/ArcMenu) with a smaller, stricter codebase:

- survives Dash to Panel / App Icons Taskbar restarts (panel targets are re-resolved on every
  change instead of being cached),
- nothing heavy happens at enable time (menu, app index and search are built lazily),
- every resource is owned by a `Scope`, so `disable()` always cleans up completely,
- native look: shell theme classes plus the GNOME accent colour, optional custom colours,
- one-click import of ArcMenu settings, pinned apps and pinned folders (with an Undo button, and an "Import and Disable ArcMenu" shortcut); every Reset in the preferences can be undone too.

Status: feature complete for the v1 scope in `docs/SPEC.md` (panel button, two-pane menu, pinned
apps and folders with drag and drop, search, hotkeys, theming, preferences, ArcMenu import).

## Credits and licence

Based on research into ArcMenu (https://gitlab.com/arcmenu/ArcMenu), GPL-2.0-or-later;
Spawn is a derivative work under the same licence. ArcMenu's icon set and a copy of its
settings schema (used only to migrate settings) are bundled. See `LICENSE`.

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

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and push to `main` (documentation-only changes excepted):
typecheck, lint, unit tests, `npm audit` and the GNOME Shell 49 / 50 compatibility typechecks. Pull requests to `main`
that touch `src/`, `schemas/`, `stylesheet.css` or `tools/` also run the `smoke` and `lifecycle` scenarios in a headless
GNOME Shell 51 (`tools/container/Dockerfile.ubuntu`, no network). Actions are pinned by commit SHA and kept up to date by
Dependabot. The full harness (`tools/dev-shell.sh all`) and the Fedora containers stay a local step before a release.
Security reports: see `SECURITY.md`.

## Install

### Fedora (DNF repository)

Packages and repository metadata are signed. The signing key's fingerprint is:

```
D49A 3081 6825 7FDB F9D5  AE14 BD1A C1C6 F56A 7252
```

Install on Fedora 43, 44 or 45, then log out and back in:

```sh
sudo dnf config-manager addrepo --overwrite --from-repofile=https://djshiye.github.io/spawn/spawn.repo
sudo dnf install -y spawn && spawn-enable
```

On the first install dnf shows the key and asks you to accept it. Check that the fingerprint it shows matches the one
above (the key is downloaded from the same site as the packages, so this comparison is what makes it trustworthy).

- Update: `sudo dnf upgrade` (log out and in to load the new code).
- Uninstall: `spawn-enable --remove; sudo dnf remove spawn` (and `sudo rm /etc/yum.repos.d/spawn.repo` to forget the repository).

`spawn-enable` (installed by the package) adds the extension to GNOME's enabled list without asking the running shell:
`gnome-extensions enable` only works for extensions the shell already knows, and it learns about a newly installed
system-wide extension at the next login.
The extension declares GNOME Shell 49, 50 and 51 (Fedora 43, 44 and 45). `spawn.repo` sets `gpgcheck=1` and `repo_gpgcheck=1`.
The extension lands in `/usr/share/gnome-shell/extensions/` and its schema in `/usr/share/glib-2.0/schemas/`.

**Fedora Glass:** [Fedora Glass](https://github.com/djshiye/fedora-glass) 1.5.6 and later themes Spawn the way it
themes ArcMenu (its "Spawn" entry, under Panel). Import from ArcMenu before you apply Glass, so Spawn's own colours are
the ones Glass's Restore original puts back.

### From a checkout

```sh
tools/install.sh                 # copies build/ to ~/.local/share/gnome-shell/extensions/<uuid>
tools/install.sh /some/data/dir  # or into <dir>/gnome-shell/extensions/<uuid>
gnome-extensions enable spawn@djshiye.github.io
```

Log out and in (Wayland) if the shell does not pick up a new extension.

### Releasing

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

### Benchmark

`tools/dev-shell.sh bench` calls `Dev.Benchmark`, which measures inside the shell with
`GLib.get_monotonic_time()`: `enable()` duration, a fresh `AppIndex.build()`, popup open to mapped
and to first painted frame (`after-paint`) for the first open, a lazily rebuilt layout and 20
steady-state opens, and search latency for ten queries (debounce bypassed) for the apps provider
and for all enabled providers. The headless shell renders on the real GPU (`renderD128`), so paint
numbers are meaningful, but a virtual monitor has no scanout, so "painted" ends at the stage's
`after-paint` signal.

Preferences can be screenshotted the same way with `tools/dev-prefs.sh [--apply-import] [pages...]`.

## Layout

See `docs/SPEC.md` (spec and module ownership), `docs/SETTINGS.md` (every setting and the
ArcMenu key it migrates from), `docs/RELEASING.md` (packaging and publishing the DNF repository)
and `docs/research/` (notes on ArcMenu's internals).
