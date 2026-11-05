# Testing on other GNOME Shell releases

Spawn declares GNOME Shell 49, 50 and 51 (`metadata.json`); 51 is the host's release. Two tools check it on all three: a container run of the real headless harness, and a static typecheck.

| Fedora | GNOME Shell | libadwaita |
| ------ | ----------- | ---------- |
| 43     | 49          | 1.8        |
| 44     | 50          | 1.9        |
| 45     | 51          | 1.9+       |

## Headless harness in a container

```
tools/dev-shell-container.sh <43|44|45> <scenario|all|prefs> [flags]
tools/dev-shell-container.sh 44 smoke
tools/dev-shell-container.sh 43 button-menu --with-dtp
tools/dev-shell-container.sh 44 all > .dev/f44/all.out 2>&1      # always redirect, then grep -a
tools/dev-shell-container.sh 43 prefs                            # tools/dev-prefs.sh in the container
```

Needs rootless podman and network on first use (the image `spawn-dev:f<release>` is built from
`tools/container/Containerfile` once and reused; `SPAWN_CONTAINER_REBUILD=1` rebuilds it). Fedora 45 is the
control: it should behave exactly like the host.

- The extension is built on the host; the repo is mounted at `/work`. State, logs and screenshots go to
  `.dev/f<release>/` (prefs: `.dev/prefs-f<release>/`), never to the host's `.dev/` or the real session.
- `metadata.json` is not touched: the image sets `org.gnome.shell disable-extension-version-validation`
  through a gschema override, so Spawn, Dash to Panel and user-theme load on every release.
- Software rendering only (llvmpipe, `--shm-size=1g`); no `--privileged`, no `/dev/dri`. The entry point
  starts an empty private "system bus" because the shell insists on one, and the image has no
  `/run/systemd/seats` so the shell uses its dummy login manager.
- `--with-dtp` mounts the host's Dash to Panel read-only; its `metadata.json` must list the release (v74
  lists 46-51). The host's Orchis theme and user-theme extension are mounted too (as the host harness
  uses them for seeded runs); `SPAWN_CONTAINER_NO_THEME=1` skips them.
- The scenarios depend on the apps installed on the host (`tools/dev/seed.ini` pins them, the context menu
  and Frequent view list them). The host's `.desktop` files from its `XDG_DATA_DIRS` (not
  `~/.local/share/applications`, which the host harness cannot see either) are copied to
  `.dev/f<release>/stub-apps` and mounted read-only as `/usr/local/share/applications`; `TryExec` is dropped
  and `Exec` points at `/usr/bin/true`, because GIO rejects entries whose program is missing.
- `prefs` compiles nothing in the container (no `node_modules`, no network): `tools/dev-prefs.sh` copies the host-built
  `build/` (`SPAWN_PREFS_PREBUILT=1`), which `tools/dev-shell-container.sh` makes sure is fresh.
- `--network none`: the shell's extension updater would otherwise "update" the host's user-theme from
  extensions.gnome.org into the sandbox copy on 49 / 50 and break it.
- The Dev screenshot hook only writes below a `.dev/` directory, which is why the per-release dirs are
  `.dev/f<release>` and not `.dev-f<release>`.
- `SPAWN_CONTAINER_BUILD=<dir>` runs a complete build tree from elsewhere (mounted over `/work/build`,
  state in `.dev/f<release>-patched/`): use it to try a hand-patched build without touching `build/`.
- Run at most two or three releases at once; the scenarios are sleep-timed and a loaded machine produces
  timing flakes (re-run the single scenario alone before believing a failure).

## Static check against the 49 / 50 typings

```
npm run compat:install          # once: npm ci in tools/compat/49 and tools/compat/50
npm run typecheck:compat49      # = tools/compat-typecheck.sh 49
npm run typecheck:compat50
```

`@girs/gnome-shell` 49.1.0 / 50.0.4 are installed in isolated trees under `tools/compat/<release>` (two
releases' ambient `gi://` declarations cannot share one program), `tsconfig.compat-<release>.json` points
`src/env.d.ts`' imports there, and `tools/compat/<release>/ambient.d.ts` loads the `gi://` declarations
the 4.x typings do not load by themselves. The script fails if any file of the main 51 tree ends up in
the program. Both pass; a failure lists an API difference (a renamed or missing member). The 49 packages
have typing quirks that are not runtime differences (for example `Shell.App.get_app_info(): never`);
`src/model/appInfo.ts` and the `drag-begin` callbacks in `src/ui/dnd.ts` cast around them.

## Differences between the releases that Spawn handles

- `St.ButtonMask` is `ONE / TWO / THREE` on 49 and 50, `PRIMARY / MIDDLE / SECONDARY` on 51 (`ui/widgets/interact.ts`).
- `Clutter.KeyController` does not exist on 49 (Clutter 17; 50 has it, though its shell still handles keys on `captured-event`): the
  popup's Escape routing falls back to a `captured-event` handler when it is missing (`ui/menu.ts`).
- `PopupMenu.open() / close()` take a `BoxPointer.PopupAnimation` number on 49 and 50, a params object on 51; the
  keyboard-triggered first-item focus (`_maybeStartKeynav`) is done by 51's `open()` and emulated by
  `ui/menuParams.ts` elsewhere. The source-actor key handling of the shell's `PopupMenu` is a `key-press-event`
  handler on 49 and 50, a `Clutter.KeyController` on 51 (`silenceSourceKeys`).
- Destroying the folder rename entry while a popup is being mapped aborts the shell on every release (a
  `Clutter:ERROR` unrealize assertion); the entry's `key-focus-out` therefore finishes on an idle (`ui/widgets/folderView.ts`).
