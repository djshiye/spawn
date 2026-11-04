# Spawn — v1 specification

A GNOME Shell 51 application menu, rebuilt from the ground up to replace ArcMenu
(GPL-2.0-or-later; Spawn is a derivative work under the same licence and credits
ArcMenu). Research on ArcMenu's internals lives in `docs/research/`; read the file for
your area before writing code.

## Goals
1. **Never break.** No code path in `enable()`/`disable()` may throw out of the
   extension. Enable is idempotent and re-enable always works in the same session.
   Dash to Panel / App Icons Taskbar restarts are handled, not survived by luck.
2. **Fast.** Nothing heavy at enable: the menu, app index and search are built
   lazily on first open (or on idle after startup-complete), then cached and
   updated incrementally.
3. **Native look.** Inherit the shell theme (Orchis) via standard St classes;
   use the GNOME accent colour (`org.gnome.desktop.interface accent-color`) as the
   single accent. Optional custom colours (migrated from ArcMenu) layered on top.
4. **Replace ArcMenu for this user** (v1 scope below), with one-click migration of
   ArcMenu settings, pinned apps and pinned folders.

## v1 scope
- Panel button (icon from bundled set incl. distro-fedora-symbolic, custom icon
  path, size, padding, position left/center/right + offset), on Main.panel, Dash
  to Panel or App Icons Taskbar panels, optional multi-monitor.
- Layout "spawn" = ArcMenu's "arcmenu" two-pane layout (see research/layout.md):
  - Left: search entry (top/bottom), main view = Pinned (default) / All apps
    (by category) / Frequent, Back and All Apps buttons.
  - Right: user avatar + name, directory shortcuts (Home, Documents, …), application
    shortcuts (Software, Settings, …, separators), power buttons (power-options).
  - Pinned apps as a list (default, like ArcMenu's arcmenu layout: one row per app, a
    folder row with a chevron) or a grid (`pinned-apps-display`), with folders
    (open/rename/delete, drop app on app = new folder, drag reorder; in the list the
    top / middle / bottom band of a row means before / onto / after).
  - App context menu: open windows, new window, desktop actions, pin/unpin,
    add to folder, app details (Software), quit.
  - Keyboard: arrows/Tab/Return/Escape, Menu or Shift+F10 = context menu, typing
    anywhere goes to search, mouse button 8 = back.
- Search: apps (own index, ranked prefix > word-prefix > substring > fuzzy), open
  windows, recent files (cached, refreshed on change), GNOME Shell search
  providers (optional). Debounce 80 ms, cancel stale queries, results streamed
  per provider.
- Hotkeys: Super key toggles menu (optional), custom accelerator (default
  `<Super>space` off by default), D-Bus `io.github.djshiye.Spawn` method
  `Toggle`. Super interception must be **in memory only** (block GNOME's handler,
  connect ours); never write mutter's `overlay-key` to dconf.
- Option to hide the Activities button (restore its *previous* visibility).
- Preferences (Adw): General, Button, Menu (views, sizes), Pinned & Shortcuts,
  Appearance, Import from ArcMenu, About.
- Migration: reads ArcMenu settings via a bundled copy of ArcMenu's compiled schema
  (so it works even after ArcMenu is removed), maps every v1 key and copies pinned
  folders, shows a preview of what will be imported, and offers to disable ArcMenu.
- Dev hook (only when `dev-mode` key is true): D-Bus
  `io.github.djshiye.Spawn.Dev` with `Open()`, `Close()`, `Search(s)`,
  `Screenshot(s path)` (uses Shell.Screenshot in-process), `Benchmark(s sections)` (in-shell timings, see README)
  for headless testing; plus a `.Ui` interface (src/ui/devHooks.ts) to drive the menu.

Out of scope for v1 (later): the other 22 ArcMenu layouts, standalone runner,
extra categories links, intellihide integration beyond showing the panel.

## Tech
- TypeScript (strict) compiled by `tsc` to ES modules for GJS; types from
  `@girs/gnome-shell@51` and `@girs/*`. No bundler; one output file per module.
- UUID `spawn@djshiye.github.io`, `shell-version: ["51"]`,
  settings schema `org.gnome.shell.extensions.spawn`
  (path `/org/gnome/shell/extensions/spawn/`), relocatable folder schema
  `org.gnome.shell.extensions.spawn.folder` at `…/folders/<uuid>/`.
- Setting names mirror ArcMenu's where the meaning is the same (simplifies
  migration and docs). Same value formats (e.g. pinned-apps `aa{ss}`,
  `(bs)` override tuples).
- `tools/build.sh` → `build/` (tsc, copy assets, glib-compile-schemas) and
  `dist/spawn@djshiye.github.io.shell-extension.zip`.
- `tools/install.sh` → installs build into `~/.local/share/gnome-shell/extensions/`.
- `tools/dev-shell.sh` → headless GNOME Shell (`gnome-shell --headless --wayland
  --virtual-monitor 1600x900 --no-x11` inside `dbus-run-session`) with isolated
  XDG dirs under `.dev/`, installs the build there, sets `dev-mode`, enables the
  extension, optionally enables Dash to Panel copied from the user's install, runs
  a scenario script (open menu, search, screenshot to `.dev/shots/`) and dumps the
  shell log. Must never touch the real session.
- Unit tests for pure modules (ranking, migration mapping, pinned store, panel
  target validation) runnable with `gjs -m` via `tools/test.sh`.
- ESLint flat config + `tsc --noEmit` must pass.

## Architecture (module ownership)

```
src/
  extension.ts            SpawnExtension: enable/disable only; builds a Scope
  core/scope.ts           Scope: LIFO disposer. add(fn), connect(obj, sig, cb),
                          timeout(ms, cb), idle(cb), child(); dispose() runs each
                          teardown in try/catch, logs, never throws. Re-usable.
  core/log.ts             log/warn/error with "[spawn]" prefix
  core/settings.ts        typed accessors over Gio.Settings + folder schema
  core/debounce.ts
  panel/targets.ts        PanelTargets: resolves CURRENT targets every time
                          (never caches global.dashToPanel); validates a target
                          (statusArea present, actor not destroyed); emits
                          'changed' (debounced 150 ms) on extension-state-changed,
                          the current emitter's 'panels-created', monitors-changed;
                          reconnects to the new emitter whenever DtP restarts.
  panel/attacher.ts       ButtonAttacher: keeps one MenuButton per valid target,
                          retries invalid targets with backoff (100 ms → 2 s, give
                          up after 10 s and fall back to Main.panel), guarded
                          removal, Activities-button handling.
  ui/button.ts            MenuButton (PanelMenu.Button subclass): icon/label/style
  ui/menu.ts              SpawnPopup: single popup shared by all buttons,
                          re-anchored to the clicked button; lazily builds layout
  ui/layout.ts            the two-pane "spawn" layout
  ui/widgets/*.ts         AppTile, AppRow (+ ActionRow), FolderTile (+ FolderRow), FolderView,
                          CategoryList, ShortcutRow, PowerBar, UserCard, SearchBox, ResultList
  ui/contextMenu.ts       app context menu
  ui/dnd.ts               pinned drag & drop
  model/appIndex.ts       AppIndex: Shell.AppSystem + GMenu tree; categories,
                          frequent (Shell.AppUsage), search keys; debounced
                          rebuild on installed-changed; no UI imports
  model/pinned.ts         PinnedStore over pinned-apps + folder schema
  search/engine.ts        SearchEngine: providers, debounce, cancellation
  search/rank.ts          pure ranking functions (unit-tested)
  search/providers/*.ts   apps, windows, recentFiles, shellProviders
  input/hotkeys.ts        Super interception (in memory) + accelerator
  input/dbus.ts           io.github.djshiye.Spawn (+ Dev when dev-mode)
  theme/theme.ts          accent + optional custom colours → stylesheet written
                          synchronously to $XDG_RUNTIME_DIR/spawn/theme.css,
                          loaded into St theme, unloaded on dispose
  prefs.ts                Adw preferences window
  prefs/pages/*.ts
  migrate/arcmenu.ts      pure mapping (unit-tested) + Gio.Settings I/O
stylesheet.css            base styles (St classes, uses theme vars)
schemas/                  gschema xml
data/icons/               button icons (symbolic SVGs)
data/migration/arcmenu/   compiled copy of ArcMenu's schema (GPL, credited)
```

## Hard rules (from ArcMenu's bugs — see research/lifecycle.md)
- No singletons that throw. No module-level mutable state that survives disable.
- Every resource is registered in a Scope at creation; disable() = scope.dispose().
- If enable fails midway, dispose what was created and stay ACTIVE-but-idle with a
  logged error; never leave prototype patches behind. Avoid prototype patching
  entirely in v1 (input-source per-window and SearchController hooks are not needed).
- Never hold a reference to a DtP panel across a 'changed' event; re-resolve.
- Every signal connection is owned (connectObject with owner, or Scope.connect).
- Teardown code guards every external object (`?.`), and one failing teardown never
  stops the rest.
- No `hasOverview` hacks. No dconf writes outside our own schema (except the
  explicit "disable ArcMenu" action in migration, which edits enabled-extensions
  through Main.extensionManager / gnome-extensions D-Bus API).
- No timers/idles without Scope ownership.
- Lazy: popup + layout built on first open or on an idle after startup-complete;
  AppIndex built once and patched on change.

## Done for v1
- Builds, lints, type-checks, unit tests pass.
- In the headless dev shell: enable → open → search → close → disable → enable
  works with no errors in the log, with and without Dash to Panel, and while
  toggling Dash to Panel 10× in a row the button always ends up attached.
- Screenshots of the menu reviewed by the user before installing on their desktop.
- Migration imports the user's settings (`docs/research/user-arcmenu-settings.ini`)
  correctly (unit test against that fixture).
