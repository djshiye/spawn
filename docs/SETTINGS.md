# Spawn settings

Schema `org.gnome.shell.extensions.spawn` (path `/org/gnome/shell/extensions/spawn/`) plus the relocatable
`org.gnome.shell.extensions.spawn.folder` schema, instantiated at `.../spawn/folders/<uuid>/` (keys `name` (s),
`pinned-apps` (aa{ss})). A folder shows up in `pinned-apps` as
`{'id': '<uuid>', 'name': '<name>', 'isFolder': 'true'}`. The folder schema is deliberately not a `<child>` of the
main schema: code opens it by path (`SpawnSettings.folder(id)`), and the id must match `[A-Za-z0-9_-]{1,64}`
(`isValidFolderId`); entries with any other id are damaged and are never opened.

Conventions: enum keys store the nick string; `(bs)`/`(bi)` are `(enabled, value)` overrides
(value ignored when `enabled` is false); built-in shortcut ids use the prefix `Spawn_`
(ArcMenu's `ArcMenu_` prefix is rewritten by the migration).
Writes: single settings are written immediately. Multi-key operations (group Reset, Undo, the ArcMenu import) go
through `SpawnSettings.batch()`, which delays and applies on a throwaway `Gio.Settings`; the prefs' own `settings.raw`
(every row is bound to it) is never put in delay mode, because GSettings has no way back and later writes would stay pending.
Integer keys with a `<range>` in the schema: `menu-height` 360..1600, `left-panel-width` 420..1200,
`right-panel-width` 180..600, `menu-width-adjustment` -350..800, `max-frequent-apps` 1..50 (the UI floors are 360 / 420 / 180; the migration
clamps ArcMenu values into these ranges and warns). GSettings rejects anything outside, so `SpawnSettings.set()`
returns false for it.
The ArcMenu import never writes a value equal to Spawn's default (it resets the key instead), so a later change of
a default still reaches imported setups.
`menu-button-icon` is a bundled file name from `data/icons/`, an absolute path, or a
themed icon name.

Enum differences from ArcMenu: `menu-button-*-click-action` is `Menu|None|ContextMenu` (ArcMenu:
`ArcMenu|ContextMenu|None`; `ArcMenu` maps to `Menu`).


## General

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `dev-mode` | b | `false` | new |
| `multi-monitor` | b | `false` | `multi-monitor` |
| `hide-activities-button` | b | `false` | `show-activities-button`  (inverted) |
| `activate-on-launch` | b | `false` | `activate-on-launch` |
| `keep-open-on-ctrl-click` | b | `true` | `keep-open-on-ctrl-click` |
| `show-tooltips` | b | `true` | `show-tooltips` |

## Hotkeys

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `super-key-toggle` | b | `true` | `arcmenu-hotkey-overlay-key-enabled`  (and Super_L in arcmenu-hotkey) |
| `spawn-hotkey` | as | `[]` | `arcmenu-hotkey`  (every entry except `Super_L`; bare modifier keys such as `Super_R` are dropped). All entries are editable on the General page; was `menu-hotkey` before v1 |

## Button

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `position-in-panel` | enum menu-position | `'Left'` | `position-in-panel` |
| `menu-button-position-offset` | i | `0` | `menu-button-position-offset` |
| `menu-button-appearance` | enum menu-button-appearance | `'Icon'` | `menu-button-appearance` |
| `menu-button-text` | s | `'Apps'` | `menu-button-text` |
| `menu-button-icon` | s | `'icon-apps-symbolic.svg'` | `menu-button-icon`  (ArcMenu resource URI rewritten to bundled file name) |
| `menu-button-icon-size` | i | `20` | `menu-button-icon-size` |
| `menu-button-padding` | i | `-1` | `menu-button-padding` |
| `context-menu-items` | aa{ss} | Extensions, Spawn Settings, Panel Extension Settings, separator, Power Options, Activities Overview, Show Desktop | `context-menu-items` (ArcMenu_* -> Spawn_*; ArcMenu_Settings* -> `Spawn_Settings`; icon `ArcMenu_ArcMenuIcon` -> `Spawn_SpawnIcon`) |
| `menu-button-left-click-action` | enum menu-button-click-action | `'Menu'` | `menu-button-left-click-action`  (ArcMenu -> Menu, ContextMenu -> ContextMenu, None -> None) |
| `menu-button-right-click-action` | enum menu-button-click-action | `'ContextMenu'` | `menu-button-right-click-action`  (ArcMenu -> Menu, ContextMenu -> ContextMenu, None -> None) |
| `menu-button-middle-click-action` | enum menu-button-click-action | `'Menu'` | `menu-button-middle-click-action`  (ArcMenu -> Menu, ContextMenu -> ContextMenu, None -> None) |

## Menu

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `default-menu-view` | enum default-menu-view | `'Pinned_Apps'` | `default-menu-view` |
| `all-apps-button-action` | enum all-apps-button-action | `'Categories_List'` | `all-apps-button-action` |
| `pinned-apps-display` | enum pinned-apps-display | `'List'` | derived from `menu-layout`: the layouts whose constructor passes `DisplayType.LIST` (arcmenu, brisk, budgie, gnome-menu, mint, whisker, plasma, tognee, windows, zest, runner) give `'List'`, the grid ones (11, az, enterprise, insider, pop, redmond, sleek, unity, chromebook, elementary, raven) `'Grid'`; unknown layouts keep the default. Pinned apps and folders (and folder contents) as rows or as an icon grid |
| `max-frequent-apps` | i | `8` | `arcmenu-layout-max-frequent-apps`  (clamped to 1..50; ArcMenu's 0 = "no limit" becomes 50) |
| `menu-height` | i | `600` | `menu-height`  (clamped to 360..1600) |
| `menu-width-adjustment` | i | `0` | `menu-width-adjustment`  (clamped to -350..800) |
| `left-panel-width` | i | `420` | `left-panel-width`  (clamped to 420..1200; ArcMenu's default is 290) |
| `right-panel-width` | i | `205` | `right-panel-width`  (clamped to 180..600) |
| `vert-separator` | b | `false` | `vert-separator` |
| `multi-lined-labels` | b | `true` | `multi-lined-labels` |
| `scrollbars-visible` | b | `true` | `scrollbars-visible` |
| `scrollbars-overlay` | b | `true` | `scrollbars-overlay` |
| `scrollview-fade-effect` | b | `true` | `scrollview-fade-effect` |
| `show-user-avatar` | b | `true` | `show-user-avatar` |
| `avatar-style` | enum avatar-style | `'Round'` | `avatar-style` |
| `icon-size-apps` | i | `-1` | `icon-size-apps` |
| `icon-size-shortcuts` | i | `-1` | `icon-size-shortcuts` |
| `icon-size-categories` | i | `-1` | `icon-size-categories` |
| `icon-size-buttons` | i | `-1` | `icon-size-buttons` |
| `icon-size-misc` | i | `-1` | `icon-size-misc` |
| `icon-size-grid` | a{si} | `{'width': -1, 'height': -1, 'size': -1}` | `icon-size-grid` |
| `icon-style-categories` | enum menu-item-icon-style | `'Symbolic'` | `icon-style-categories` |
| `icon-style-shortcuts` | enum menu-item-icon-style | `'Symbolic'` | `icon-style-shortcuts` |
| `icon-style-buttons` | enum menu-item-icon-style | `'Symbolic'` | `icon-style-buttons` |

## Pinned & Shortcuts

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `pinned-apps` | aa{ss} | `[ firefox, org.gnome.Nautilus, org.gnome.Software, org.gnome.Settings, org.gnome.Ptyxis ]` (`.desktop` ids; not installed ones are hidden by the menu) | `pinned-apps`  (an app is kept once: top level first, then folders in order) |
| `directory-shortcuts` | aa{ss} | `[ {'id': 'Spawn_Home', 'name': 'Home', 'icon': 'Spawn...` | `directory-shortcuts`  (ArcMenu_ ids -> Spawn_) |
| `application-shortcuts` | aa{ss} | `[ Spawn_Software, org.gnome.Settings.desktop, org.gnome.Ptyxis.desktop, Spawn_ActivitiesOverview ]` | `application-shortcuts`  (ArcMenu_ ids -> Spawn_) |
| `power-options` | a(ib) | `[(0, true), (1, true), (2, true), (3, true), (4, false), ...` | `power-options` |
| `power-display-style` | enum power-display-style | `'Default'` | `power-display-style` |

## Search

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `search-hidden` | b | `false` | `search-hidden` |
| `search-entry-location` | enum searchbar-location (`Bottom`=0, `Top`=1, `Auto`=2) | `'Bottom'` | `searchbar-default-bottom-location`  (ArcMenu's Top/Bottom as-is; `Auto` is new: nearest the panel the menu opens from) |
| `max-search-results` | i | `5` | `max-search-results` |
| `highlight-search-result-terms` | b | `false` | `highlight-search-result-terms` |
| `show-search-result-details` | b | `false` | `show-search-result-details` |
| `search-provider-open-windows` | b | `false` | `search-provider-open-windows` |
| `search-provider-recent-files` | b | `false` | `search-provider-recent-files` |
| `search-provider-shell` | b | `false` | new |
| `show-hidden-recent-files` | b | `false` | `show-hidden-recent-files` |
| `apps-show-extra-details` | b | `false` | `apps-show-extra-details` |
| `apps-show-generic-names` | b | `false` | `apps-show-generic-names` |
| `search-entry-border-radius` | (bi) | `(true, 25)` | `search-entry-border-radius` |

## Appearance

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `override-menu-theme` | b | `false` | `override-menu-theme` |
| `menu-background-color` | s | `"rgba(48,48,49,0.98)"` | `menu-background-color` |
| `menu-foreground-color` | s | `"rgb(223,223,223)"` | `menu-foreground-color` |
| `menu-border-color` | s | `"rgb(60,60,60)"` | `menu-border-color` |
| `menu-border-width` | i | `1` | `menu-border-width` |
| `menu-border-radius` | i | `14` | `menu-border-radius` |
| `menu-font-size` | i | `11` | `menu-font-size` |
| `menu-separator-color` | s | `"rgba(255,255,255,0.1)"` | `menu-separator-color` |
| `menu-item-hover-bg-color` | s | `"rgb(21,83,158)"` | `menu-item-hover-bg-color` |
| `menu-item-hover-fg-color` | s | `"rgb(255,255,255)"` | `menu-item-hover-fg-color` |
| `menu-item-active-bg-color` | s | `"rgb(25,98,163)"` | `menu-item-active-bg-color` |
| `menu-item-active-fg-color` | s | `"rgb(255,255,255)"` | `menu-item-active-fg-color` |
| `menu-button-fg-color` | (bs) | `(false, "rgb(242,242,242)")` | `menu-button-fg-color` |
| `menu-button-bg-color` | (bs) | `(false, "rgba(242,242,242,0.2)")` | `menu-button-bg-color` |
| `menu-button-border-radius` | (bi) | `(false, 20)` | `menu-button-border-radius` |
| `menu-button-border-width` | (bi) | `(false, 3)` | `menu-button-border-width` |
| `menu-button-border-color` | (bs) | `(false, "transparent")` | `menu-button-border-color` |
| `menu-button-hover-bg-color` | (bs) | `(false, "rgba(242,242,242,0.15)")` | `menu-button-hover-bg-color` |
| `menu-button-hover-fg-color` | (bs) | `(false, "rgb(242,242,242)")` | `menu-button-hover-fg-color` |
| `menu-button-active-bg-color` | (bs) | `(false, "rgba(242,242,242,0.2)")` | `menu-button-active-bg-color` |
| `menu-button-active-fg-color` | (bs) | `(false, "rgb(242,242,242)")` | `menu-button-active-fg-color` |

## Misc

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `prefs-visible-page` | i | `0` | not migrated (ArcMenu's page order differs from Spawn's) |
| `migration-done` | b | `false` | new |

## Folder schema `org.gnome.shell.extensions.spawn.folder`

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `name` | s | `''` | name field of the folder entry in ArcMenu `pinned-apps` |
| `pinned-apps` | aa{ss} | `[]` | `pinned-apps-folders/<uuid>/pinned-apps` |

## ArcMenu keys deliberately not migrated

The bundled ArcMenu schema is from ArcMenu release 74 (`BUNDLED_ARCMENU_VERSION`); the Import page warns when the
installed ArcMenu is newer, because keys added since then are not read.

Other layouts' keys (`*-layout-*`, `raven-*`, `runner-*`, `default-menu-view-<layout>`, ...), `menu-layout` (only read to derive `pinned-apps-display`),
`force-menu-location`, `menu-position-alignment`, `menu-arrow-rise`, `menu-themes`,
`extra-categories*`, `recently-installed-apps`, `show-recently-installed-apps`, update-notifier keys,
`settings-width/height`, `prefs-visible-page`, `hide-overview-*`, `enable-horizontal-flip`, `dash-to-panel-standalone`, `pop-*`,
`runner-hotkey*`, `hotkey-open-primary-monitor`, `activate-on-hover`, `show-category-sub-menus`,
`group-apps-alphabetically-*`, `show-external-devices`, `show-bookmarks`, `enable-activities-shortcut`,
`searchbar-default-top-location`, `icon-size` for removed layouts.
