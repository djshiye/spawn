# Testing on other GNOME Shell releases

Spawn targets GNOME Shell 51 (`metadata.json`), the host's release. Two tools check it against the
neighbours: a container run of the real headless harness, and a static typecheck.

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
- The seeded scenarios pin apps from `tools/dev/seed.ini` that the container does not have; `.desktop`
  stubs (copies of the host's files when found) are generated into `.dev/f<release>/stub-apps` and put on
  `XDG_DATA_DIRS`.
- The Dev screenshot hook only writes below a `.dev/` directory, which is why the per-release dirs are
  `.dev/f<release>` and not `.dev-f<release>`.

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
the program. The result lists API differences (renamed or missing members); it is expected to fail until
`src/` carries the compatibility shims. A few errors are typing quirks of the 49 packages (for example
`Shell.App.get_app_info(): never`), not runtime differences.
