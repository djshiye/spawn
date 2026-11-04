# Spawn Menu

A fast, resilient application menu for GNOME Shell 51. It replaces
[ArcMenu](https://gitlab.com/arcmenu/ArcMenu) with a smaller, stricter codebase:

- survives Dash to Panel / App Icons Taskbar restarts (panel targets are re-resolved on every
  change instead of being cached),
- nothing heavy happens at enable time (menu, app index and search are built lazily),
- every resource is owned by a `Scope`, so `disable()` always cleans up completely,
- native look: shell theme classes plus the GNOME accent colour, optional custom colours,
- one-click import of ArcMenu settings, pinned apps and pinned folders.

Status: skeleton. Panel attachment, settings, the D-Bus dev hook and the build/dev tooling
work; the menu UI, search, hotkeys, theming, preferences and migration are stubs with final
interfaces (see the header comment of each module and `docs/SPEC.md`).

## Credits and licence

Based on research into ArcMenu (https://gitlab.com/arcmenu/ArcMenu), GPL-2.0-or-later;
Spawn Menu is a derivative work under the same licence. ArcMenu's icon set and a copy of its
settings schema (used only to migrate settings) are bundled. See `LICENSE`.

## Build

Requirements: Node 20+ with npm, `glib-compile-schemas`, `zip`.

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # compiles, then runs the gjs -m unit tests in tests/
npm run build       # tools/build.sh -> build/ and dist/spawn-menu@djshiye.github.io.shell-extension.zip
```

## Install

```sh
tools/install.sh                 # copies build/ to ~/.local/share/gnome-shell/extensions/<uuid>
tools/install.sh /some/data/dir  # or into <dir>/gnome-shell/extensions/<uuid>
gnome-extensions enable spawn-menu@djshiye.github.io
```

Log out and in (Wayland) if the shell does not pick up a new extension.

## Develop without touching your session

`tools/dev-shell.sh` starts a headless GNOME Shell inside its own `dbus-run-session` with
isolated `XDG_*` directories under `.dev/`. It never touches your running session, your dconf
or your installed extensions.

```sh
tools/build.sh
tools/dev-shell.sh smoke                    # enable, wait, screenshot to .dev/shots/smoke.png
tools/dev-shell.sh dtp-toggle --with-dtp    # toggle Dash to Panel 10x, check the button stays attached
```

`--with-dtp` copies Dash to Panel from your user extensions directory into the isolated
data dir. The extension's `dev-mode` setting (set only in the isolated session) exports the
`io.github.djshiye.SpawnMenu.Dev` D-Bus interface (`Open`, `Close`, `Search`, `Screenshot`,
`AttachmentStatus`). The shell log, filtered for `spawn-menu`, `JS ERROR`, `Extension` and
`TypeError`, is printed at the end.

## Layout

See `docs/SPEC.md` (spec and module ownership), `docs/SETTINGS.md` (every setting and the
ArcMenu key it migrates from) and `docs/research/` (notes on ArcMenu's internals).
