# Spawn Menu settings

Schema `org.gnome.shell.extensions.spawn-menu` (path `/org/gnome/shell/extensions/spawn-menu/`) plus the relocatable
`org.gnome.shell.extensions.spawn-menu.folder` schema, instantiated at `.../spawn-menu/folders/<uuid>/` (keys `name` (s),
`pinned-apps` (aa{ss})). A folder shows up in `pinned-apps` as
`{'id': '<uuid>', 'name': '<name>', 'isFolder': 'true'}`.

Conventions: enum keys store the nick string; `(bs)`/`(bi)` are `(enabled, value)` overrides
(value ignored when `enabled` is false); built-in shortcut ids use the prefix `SpawnMenu_`
(ArcMenu's `ArcMenu_` prefix is rewritten by the migration).
`menu-button-icon` is a bundled file name from `data/icons/`, an absolute path, or a
themed icon name.

Enum differences from ArcMenu: `menu-button-*-click-action` is `Menu|None` (ArcMenu:
`ArcMenu|ContextMenu|None`; the button context menu is not in v1).


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
| `menu-hotkey` | as | `[]` | `arcmenu-hotkey`  (non-Super entries) |

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
| `menu-button-left-click-action` | enum menu-button-click-action | `'Menu'` | `menu-button-left-click-action`  (ArcMenu -> Menu, ContextMenu -> None) |
| `menu-button-right-click-action` | enum menu-button-click-action | `'None'` | `menu-button-right-click-action`  (ArcMenu -> Menu, ContextMenu -> None) |
| `menu-button-middle-click-action` | enum menu-button-click-action | `'Menu'` | `menu-button-middle-click-action`  (ArcMenu -> Menu, ContextMenu -> None) |

## Menu

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `default-menu-view` | enum default-menu-view | `'Pinned_Apps'` | `default-menu-view` |
| `all-apps-button-action` | enum all-apps-button-action | `'Categories_List'` | `all-apps-button-action` |
| `max-frequent-apps` | i | `8` | `arcmenu-layout-max-frequent-apps` |
| `menu-height` | i | `600` | `menu-height` |
| `menu-width-adjustment` | i | `0` | `menu-width-adjustment` |
| `left-panel-width` | i | `290` | `left-panel-width` |
| `right-panel-width` | i | `205` | `right-panel-width` |
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
| `pinned-apps` | aa{ss} | `[ {'id': 'firefox.desktop'}, {'id': 'org.gnome.Nautilus.d...` | `pinned-apps` |
| `directory-shortcuts` | aa{ss} | `[ {'id': 'SpawnMenu_Home', 'name': 'Home', 'icon': 'Spawn...` | `directory-shortcuts`  (ArcMenu_ ids -> SpawnMenu_) |
| `application-shortcuts` | aa{ss} | `[ {'id': 'SpawnMenu_Software', 'name': 'Software'}, {'id'...` | `application-shortcuts`  (ArcMenu_ ids -> SpawnMenu_) |
| `power-options` | a(ib) | `[(0, true), (1, true), (2, true), (3, true), (4, false), ...` | `power-options` |
| `power-display-style` | enum power-display-style | `'Default'` | `power-display-style` |

## Search

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `search-hidden` | b | `false` | `search-hidden` |
| `search-entry-location` | enum searchbar-location | `'Bottom'` | `searchbar-default-bottom-location` |
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
| `prefs-visible-page` | i | `0` | `prefs-visible-page` |
| `migration-done` | b | `false` | new |

## Folder schema `org.gnome.shell.extensions.spawn-menu.folder`

| Key | Type | Default | Migrates from (ArcMenu) |
|---|---|---|---|
| `name` | s | `''` | name field of the folder entry in ArcMenu `pinned-apps` |
| `pinned-apps` | aa{ss} | `[]` | `pinned-apps-folders/<uuid>/pinned-apps` |

## ArcMenu keys deliberately not migrated

Other layouts' keys (`*-layout-*`, `raven-*`, `runner-*`, `default-menu-view-<layout>`, ...), `menu-layout`,
`force-menu-location`, `menu-position-alignment`, `menu-arrow-rise`, `context-menu-items`, `menu-themes`,
`extra-categories*`, `recently-installed-apps`, `show-recently-installed-apps`, update-notifier keys,
`settings-width/height`, `hide-overview-*`, `enable-horizontal-flip`, `dash-to-panel-standalone`, `pop-*`,
`runner-hotkey*`, `hotkey-open-primary-monitor`, `activate-on-hover`, `show-category-sub-menus`,
`group-apps-alphabetically-*`, `show-external-devices`, `show-bookmarks`, `enable-activities-shortcut`,
`searchbar-default-top-location`, `icon-size` for removed layouts.
