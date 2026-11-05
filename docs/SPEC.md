# Spawn — v1 specification

A GNOME Shell application menu (49, 50 and 51), rebuilt from the ground up to replace ArcMenu
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
- Panel button (icon from the bundled Spawn/distro sets incl. distro-fedora-symbolic, any icon of the
  system icon theme, or a custom icon path; the picker has an All/Spawn/Distros/System source filter, a
  symbolic/full-colour filter and debounced search; size, padding, position left/center/right + offset), on Main.panel, Dash
  to Panel or App Icons Taskbar panels, optional multi-monitor.
- Layout "spawn" = ArcMenu's "arcmenu" two-pane layout (see research/layout.md):
  - Left: search entry (top/bottom), main view = Pinned (default) / All apps
    (by category) / Frequent, Back and All Apps buttons.
  - Right: user avatar + name, directory shortcuts (Home, Documents, …), application
    shortcuts (Software, Settings, …, separators), power buttons (power-options).
  - Sidebar extras (opt-in, all off by default; same keys as ArcMenu): category quick links
    (`arcmenu-extra-categories-links`, `-location`: Favorites / Frequent / All Apps / Pinned / Recent Files rows
    above or below the start view's list, hidden on every other view; Recent Files and Favorites are views of
    their own) and external devices + bookmarks in the right pane (`show-external-devices`, `show-bookmarks`; live
    updates, an eject button on removable devices that Right-arrow reaches). All rows follow the hit-area convention.
    `show-category-sub-menus` is not supported (categories are flat). See SETTINGS.md.
  - Pinned apps as a list (default, like ArcMenu's arcmenu layout: one row per app, a
    folder row with a chevron) or a grid (`pinned-apps-display`), with folders
    (open/rename/delete, drop app on app = new folder, drag reorder; in the list the
    top / middle / bottom band of a row means before / onto / after).
  - Pinned hit areas: no dead zones and three sizes (`pinned-item-size`: Compact / Comfortable /
    Large). St only hit-tests an actor's allocation (padding included, margins and container
    spacing excluded), so the pinned list / grid and a folder's contents have no container padding or
    spacing: each entry is a transparent outer `St.Button` whose padding carries the gap to its
    neighbours (and the pane-edge gutter), and the visible row / tile is its `.spawn-surface` child,
    styled through the button's state. Drag & drop bands are fractions of the visible face.
    `tools/dev-shell.sh ui-hit-area` sweeps every pixel (`Ui.HitSweep`).
  - No dead pixels anywhere else either (modern, forgiving click targets): the left pane has no
    horizontal padding of its own, its 8 px at each edge are the padding of the rows / tiles (the
    pointer at the menu's inner edge hits the nearest one); search results, the category column and a
    category's apps, the Frequent lists, the shortcut rows, the user card, the nav buttons and the power
    buttons are all a transparent outer button around a `.spawn-surface` face, with the 1 px pitch /
    8 px pane inset as the button's padding (the right pane has no padding either; its divider above
    the power buttons is its own widget). Dead on purpose: a section title / divider and the gap
    beside it, the 1 px line between the category column and its apps, the flexible spacer between the
    harmless and the destructive power buttons, and the folder header's side margins. Looks are pixel
    identical to before. `tools/dev-shell.sh ui-hit-area2` sweeps each region in List and Grid
    (`Ui.HitSweepIn`; `Ui.SetFrequent` fakes the usage history a sandboxed shell lacks).
  - App context menu: open windows, new window, desktop actions, pin/unpin,
    add to folder, app details (Software), quit.
  - Keyboard: arrows/Tab/Return/Escape, Menu or Shift+F10 = context menu, typing
    anywhere goes to search, mouse button 8 = back. Ctrl+Up/Down/Left/Right and Ctrl+Home/End on a
    focused pinned entry (top level or inside an open folder) move it (List: Up/Down one position;
    Grid: Left/Right one position, Up/Down one row; no-op at the edges); the focus stays on the entry.
  - Delete Folder (its apps move to the top level) shows an in-menu banner "Folder “X” deleted [Undo]"
    for 8 s (Tab-reachable, Ctrl+Z too); Undo restores the folder exactly (uuid, name, apps, slot).
    The banner ends when the menu closes or the pinned list changes otherwise.
- Search: apps (own index, ranked prefix > word-prefix > substring > fuzzy), open
  windows, recent files (cached, refreshed on change), GNOME Shell search
  providers (optional). Debounce 80 ms, cancel stale queries, results streamed
  per provider.
- Hotkeys: Super key toggles menu (optional), custom accelerator (default
  `<Super>space` off by default), D-Bus `io.github.djshiye.Spawn` method
  `Toggle` (`ToggleRunner` for the runner). Super interception must be **in memory only** (block GNOME's handler,
  connect ours); never write mutter's `overlay-key` to dconf.
- Standalone runner (`ui/runner.ts`): a search-only popup with its own accelerator (`runner-hotkey`) and the
  D-Bus method `ToggleRunner`, opened on the monitor under the pointer (Top / Centered). Same search pipeline and
  result widgets as the menu; closes on Escape, on activating a result, on a click outside and when the main menu
  opens (and the other way round).
- Dash to Panel intellihide: while the menu is open on a panel with intellihide enabled, the panel is held
  revealed (Dash to Panel's temporary hold). It is released when the menu closes, once the pointer is off the
  panel, immediately on a fullscreen monitor, and on disable or panel rebuild (src/panel/intellihide.ts).
- Option to hide the Activities button (restore its *previous* visibility).
- Preferences (Adw): General, Button, Menu (views, sizes), Pinned & Shortcuts,
  Appearance, Import from ArcMenu, About.
- Appearance: custom menu colours with theme presets (ArcMenu's `menu-themes` format; a preset chooser incl.
  "Follow the desktop theme", save-current-as-preset, a manage dialog to rename / reorder / remove), the
  menu's distance from the panel (`menu-arrow-rise`) and the panel button's colours. `menu-position-alignment`
  places the menu under a centred button; `runner-font-size` sets the runner's font; `icon-size-categories` /
  `icon-size-shortcuts` = 0 hide those icons, `icon-size-misc` sizes the search and Back / All Apps icons.
- Migration: reads ArcMenu settings via a bundled copy of ArcMenu's compiled schema
  (so it works even after ArcMenu is removed), maps every v1 key and copies pinned
  folders, shows a preview of what will be imported, and offers to disable ArcMenu.
- Dev hook (only when `dev-mode` key is true): D-Bus
  `io.github.djshiye.Spawn.Dev` with `Open()`, `Close()`, `Search(s)`,
  `Screenshot(s path)` (uses Shell.Screenshot in-process), `Benchmark(s sections)` (in-shell timings, see README)
  for headless testing; plus a `.Ui` interface (src/ui/devHooks.ts) to drive the menu.

Out of scope (later): the other 22 ArcMenu layouts, ArcMenu's `extra-categories` rows in the category column,
`force-menu-location`, translations (English only), extensions.gnome.org (distributed through the DNF repo only).

## Tech
- TypeScript (strict) compiled by `tsc` to ES modules for GJS; types from
  `@girs/gnome-shell@51` and `@girs/*`. No bundler; one output file per module.
- UUID `spawn@djshiye.github.io`, `shell-version: ["49", "50", "51"]`,
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
  input/accelerator.ts    one custom accelerator (spawn-hotkey, runner-hotkey) via Main.wm.addKeybinding
  ui/runner.ts            SpawnRunner: the standalone search-only popup (lazy, own scope)
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
