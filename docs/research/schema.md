# ArcMenu GSettings schema map

Sources:
- Schema: `/tmp/claude-1000/-home-dino-Coding/d2878a56-801c-42b2-bf19-83145b8a82f0/scratchpad/src/ArcMenu/schemas/org.gnome.shell.extensions.arcmenu.gschema.xml` (`L###` in tables = line in this file)
- Dump: `/tmp/claude-1000/-home-dino-Coding/d2878a56-801c-42b2-bf19-83145b8a82f0/scratchpad/arcmenu-settings.ini`
- USED refs point to `/tmp/claude-1000/-home-dino-Coding/d2878a56-801c-42b2-bf19-83145b8a82f0/scratchpad/src/ArcMenu/src/...` (abbreviated below as `src/...`)

Total keys: **149** = 148 in the main schema + 1 in the relocatable child schema (`pinned-apps-folders`, `pinned-apps`).

---

## 1. Schema ids, paths, child schemas

| Schema id | Path | Notes |
|---|---|---|
| `org.gnome.shell.extensions.arcmenu` | `/org/gnome/shell/extensions/arcmenu/` (XML L101) | Main schema, 148 keys |
| `org.gnome.shell.extensions.arcmenu.pinned-apps-folders` | none (relocatable) (XML L94) | 1 key: `pinned-apps` type `aa{ss}`, default `[]` (L95-97) |

Child declaration: `<child name='pinned-apps-folders' schema='org.gnome.shell.extensions.arcmenu.pinned-apps-folders'/>` (L682).

How folder paths work:
- Parent path is `/org/gnome/shell/extensions/arcmenu/`. Each folder is a relocatable instance at `/org/gnome/shell/extensions/arcmenu/pinned-apps-folders/<uuid>/`.
- `<uuid>` is the folder id stored in the parent `pinned-apps` entry (`{'id': '<uuid>', 'name': '...', 'isFolder': 'true'}`).
- The code builds the instance as `` `${settings.path}pinned-apps-folders/${folderId}/` `` with schema `` `${settings.schema_id}.pinned-apps-folders` `` (see `src/settings/menuSettings/listPinnedPage.js:90-91`, `src/menulayouts/baseMenuLayout.js:709-710`, `src/menulayouts/...` and `src/menuWidgets.js:2527`).
- Each folder stores its own `pinned-apps` (`aa{ss}`) list of `{'id': 'x.desktop'}` items.
- Dump: folder instances at `[pinned-apps-folders/<uuid>]` for `3c2219f1-a114-4e2e-a06c-51fdefa91991` (Games), `7d610436-4b17-46cf-99db-97578edac1c1` (Internet), `7d76d6f0-79d7-40fb-87f8-8838ebe22b19` (Tarky). Dump lines 41-48.

---

## 2. Key table (all 149 keys)

Columns: key | GVariant type | default (verbatim XML) | enum / range | meaning (XML summary) | line.
Type `s` with enum = enum-typed key; GVariant string holds the enum nick (section 4).

### 2a. Layout and general menu behaviour

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| update-notifier-project-version | i | 0 | - | Project version when an update notification was last shown | 102 |
| update-notifier-enabled | b | true | - | Enable/disable update notifications | 106 |
| menu-layout | s | 'arcmenu' | choices: 11, arcmenu, az, brisk, budgie, chromebook, elementary, enterprise, gnome-menu, gnome-overview, insider, mint, plasma, pop, raven, redmond, runner, sleek, tognee, unity, whisker, windows, zest (L118-140) | Menu layout | 114 |
| menu-position-alignment | i | 50 | - | Menu position alignment | 110 |
| force-menu-location | enum `forcemenulocation` | 'Off' | Off, TopCentered, TopLeft, TopRight, BottomCentered, BottomLeft, BottomRight, LeftCentered, RightCentered, MonitorCentered | Force menu to a specific location | 249 |
| position-in-panel | enum `menu-position` | 'Left' | Left, Center, Right | Menu position in the panel | 546 |
| settings-width | i | 750 | - | ArcMenu Settings window width | 253 |
| settings-height | i | 800 | - | ArcMenu Settings window height | 257 |
| menu-height | i | 600 | - | Menu height | 482 |
| menu-width-adjustment | i | 0 | - | Menu width adjustment | 486 |
| left-panel-width | i | 290 | - | Menu left panel width | 490 |
| right-panel-width | i | 205 | - | Right panel width | 494 |
| vert-separator | b | false | - | Enable a vertical separator | 478 |
| enable-horizontal-flip | b | false | - | Flip menu horizontally | 422 |
| multi-monitor | b | false | - | Display on all monitors | 514 |
| dash-to-panel-standalone | b | false | - | Force placement of ArcMenu on GNOME top panel | 598 |
| hide-overview-on-startup | b | false | - | Hide overview on startup | 602 |
| hide-overview-on-arcmenu-open | b | false | - | Hide overview when ArcMenu opens | 606 |
| activate-on-launch | b | false | - | Activate existing window instead of opening a new one on app launch | 610 |
| keep-open-on-ctrl-click | b | true | - | Keep menu open when activating an item with Ctrl | 614 |
| activate-on-hover | b | false | - | Activate categories on hover | 350 |
| show-tooltips | b | true | - | Tooltips | 358 |
| show-category-sub-menus | b | false | - | Show category sub menus | 362 |
| group-apps-alphabetically-list-layouts | b | true | - | Group apps alphabetically in "All Apps" sections of list layouts | 366 |
| group-apps-alphabetically-grid-layouts | b | false | - | Group apps alphabetically in "All Apps" sections of grid layouts | 370 |
| multi-lined-labels | b | true | - | Multi-lined labels for large-icon app grid layouts | 374 |
| show-user-avatar | b | true | - | Show user avatar icon in menu | 406 |
| avatar-style | enum `avatar-style` | 'Round' | Round, Square | Avatar icon appearance | 562 |
| enable-activities-shortcut | b | false | - | Enable an Activities Overview shortcut | 410 |
| show-activities-button | b | false | - | Show/hide Activities button in panel | 518 |
| scrollview-fade-effect | b | true | - | Fade effect on scrollviews | 297 |
| scrollbars-visible | b | true | - | Show/hide scrollbars | 301 |
| scrollbars-overlay | b | true | - | Overlay scrollbars on/off | 305 |
| show-external-devices | b | false | - | Show external devices | 498 |
| show-bookmarks | b | false | - | Show bookmarks | 502 |
| show-recently-installed-apps | b | true | - | Show recently installed apps | 354 |
| pop-folders-data | a{ss} | {} | - | Copy of org.gnome.desktop.app-folders id:name | 844 |
| pop-default-view | s | 'Library Home' | - | Folder displayed when opening POP layout | 848 |
| prefs-visible-page | i | 0 | - | Page opened in ArcMenu Settings | 852 |

### 2b. Per-layout view and layout-specific options

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| default-menu-view | enum `default-menu-view` | 'Pinned_Apps' | Pinned_Apps, Categories_List, Frequent_Apps, All_Programs, Pinned_And_Frequent_Apps | Default view for ArcMenu layout | 378 |
| default-menu-view-tognee | enum `default-menu-view-tognee` | 'Categories_List' | Categories_List, All_Programs | Tognee layout default view | 394 |
| default-menu-view-redmond | enum `default-menu-view-redmond` | 'All_Programs' | All_Programs, Pinned_Apps | Redmond layout default view | 398 |
| default-menu-view-az | enum `default-menu-view-az` | 'Pinned_Apps' | Pinned_Apps, Frequent Apps (with space) | AZ layout default view | 678 |
| default-menu-view-runner | enum `default-menu-view-runner` | 'Default' | Default, Pinned_Apps, Frequent Apps (with space) | Runner layout default view | 470 |
| all-apps-button-action | enum `all-apps-button-action` | 'Categories_List' | Categories_List, All_Programs | ArcMenu layout 'All Apps' button action | 426 |
| arcmenu-layout-max-frequent-apps | i | 8 | - | Max frequent apps when default view is Pinned_And_Frequent_Apps | 650 |
| arcmenu-extra-categories-links | a(ib) | [(0, false), (1, false), (2, false), (3, false), (4, false)] | (id, enabled) | Extra category quick links for ArcMenu layout | 646 |
| arcmenu-extra-categories-links-location | enum `menuitem-location` | 'Bottom' | Bottom, Top | Where extra category quick links are shown on ArcMenu home page | 654 |
| extra-categories | a(ib) | [(3, true), (2, true), (0, false), (1, false), (4, false)] | (id, enabled) | Extra categories (ids per Constants.js Categories) | 642 |
| enable-unity-homescreen | b | true | - | Unity layout shows "Home Screen" as default | 402 |
| eleven-show-frequent-apps | b | true | - | Eleven layout: show frequent apps | 474 |
| windows-show-frequent-apps | b | true | - | Windows layout: show frequent apps | 430 |
| windows-show-pinned-apps | b | true | - | Windows layout: show pinned apps | 434 |
| gnome-dash-show-applications | b | false | - | GNOME Dash layout: show Applications | 438 |
| plasma-enable-hover | b | true | - | Plasma layout: hover activates item | 442 |
| az-layout-merge-panels | b | false | - | AZ layout: merge top and bottom panels | 670 |
| az-layout-max-frequent-apps | i | 20 | - | AZ layout: max frequent apps when default-menu-view-az = Frequent_Apps | 674 |
| sleek-layout-panel-width | i | 225 | - | Sleek layout extra shortcuts panel width | 662 |
| zest-layout-panel-width | i | 225 | - | Zest layout extra shortcuts panel width | 666 |
| raven-position | enum `raven-position` | 'Left' | Left, Right | Raven layout side of screen | 265 |
| raven-search-display-style | enum `search-display-style` | 'Grid' | List, Grid | Raven layout search display style | 261 |
| enable-weather-widget-raven | b | true | - | Raven: weather widget | 269 |
| enable-clock-widget-raven | b | true | - | Raven: clock widget | 273 |
| enable-weather-widget-unity | b | false | - | Unity: weather widget | 277 |
| enable-clock-widget-unity | b | false | - | Unity: clock widget | 281 |
| runner-position | enum `runner-position` | 'Top' | Top, Centered | Runner menu position | 550 |
| runner-search-display-style | enum `search-display-style` | 'List' | List, Grid | Runner search display style | 554 |
| runner-show-settings-button | b | true | - | Runner: show settings button | 446 |
| runner-menu-height | i | 400 | - | Runner menu height | 450 |
| runner-menu-height-static | b | false | - | Runner menu height does not grow with results | 454 |
| runner-menu-width | i | 500 | - | Runner menu width | 458 |
| runner-font-size | i | 0 | - | Runner font size | 462 |
| runner-searchbar-location | enum `searchbar-location` | 'Top' | Bottom, Top | Runner searchbar location | 466 |
| searchbar-default-bottom-location | enum `searchbar-location` | 'Bottom' | Bottom, Top | Searchbar location for layouts defaulting to bottom | 414 |
| searchbar-default-top-location | enum `searchbar-location` | 'Top' | Bottom, Top | Searchbar location for layouts defaulting to top | 418 |

### 2c. Menu button

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| menu-button-appearance | enum `menu-button-appearance` | 'Icon' | Icon, Text, Icon_Text, Text_Icon, None | Appearance of the menu button | 558 |
| menu-button-text | s | 'Apps' | - | Text of the menu button | 618 |
| menu-button-icon | s | 'resource:///org/gnome/shell/extensions/arcmenu/icons/scalable/actions/icon-arcmenu-logo-symbolic.svg' | - | Button icon: file path, resource:/// URI, or symbolic icon name | 622 |
| menu-button-icon-size | i | 20 | - | Menu button icon size | 630 |
| menu-button-padding | i | -1 | - | Menu button padding (-1 = default) | 634 |
| menu-button-position-offset | i | 0 | - | Menu button position offset for main panel | 638 |
| menu-button-left-click-action | enum `menu-button-click-action` | 'ArcMenu' | ArcMenu, ContextMenu, None | Left click action | 382 |
| menu-button-right-click-action | enum `menu-button-click-action` | 'ContextMenu' | ArcMenu, ContextMenu, None | Right click action | 386 |
| menu-button-middle-click-action | enum `menu-button-click-action` | 'ArcMenu' | ArcMenu, ContextMenu, None | Middle click action | 390 |
| menu-arrow-rise | (bi) | (false, 6) | (enabled, px) | Distance from panel and screen edge | 245 |

### 2d. Theme and colours (active when override-menu-theme is true unless noted)

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| override-menu-theme | b | false | - | Override ArcMenu theme | 144 |
| menu-background-color | s | "rgba(48,48,49,0.98)" | CSS colour string | Menu background colour | 148 |
| menu-foreground-color | s | "rgb(223,223,223)" | CSS colour string | Menu foreground colour | 152 |
| menu-border-color | s | "rgb(60,60,60)" | CSS colour string | Menu border colour | 156 |
| menu-border-width | i | 1 | px | Menu border width | 160 |
| menu-border-radius | i | 14 | px | Menu border radius | 164 |
| menu-font-size | i | 11 | px | Menu font size (not in user dump) | 168 |
| menu-separator-color | s | "rgba(255,255,255,0.1)" | CSS colour string | Separator colour | 172 |
| menu-item-hover-bg-color | s | "rgb(21,83,158)" | CSS colour string | Item hover background | 176 |
| menu-item-hover-fg-color | s | "rgb(255,255,255)" | CSS colour string | Item hover foreground | 180 |
| menu-item-active-bg-color | s | "rgb(25,98,163)" | CSS colour string | Item active background | 184 |
| menu-item-active-fg-color | s | "rgb(255,255,255)" | CSS colour string | Item active foreground | 188 |
| menu-themes | aas | [['ArcMenu Style', ...], ['Simply Dark', ...], ['Dark Blue', ...], ['Light Blue', ...]] (L235-242) | 12 ordered strings per theme | List of colour themes (see section 5) | 231 |
| menu-button-fg-color | (bs) | (false, "rgb(242,242,242)") | (enabled, colour) | Menu button foreground | 194 |
| menu-button-bg-color | (bs) | (false, "rgba(242,242,242,0.2)") | (enabled, colour) | Menu button background | 198 |
| menu-button-border-radius | (bi) | (false, 20) | (enabled, px) | Menu button border radius | 202 |
| menu-button-border-width | (bi) | (false, 3) | (enabled, px) | Menu button border width | 206 |
| menu-button-border-color | (bs) | (false, "transparent") | (enabled, colour) | Menu button border colour | 210 |
| menu-button-hover-bg-color | (bs) | (false, "rgba(242,242,242,0.15)") | (enabled, colour) | Menu button hover background | 214 |
| menu-button-hover-fg-color | (bs) | (false, "rgb(242,242,242)") | (enabled, colour) | Menu button hover foreground | 218 |
| menu-button-active-bg-color | (bs) | (false, "rgba(242,242,242,0.2)") | (enabled, colour) | Menu button active background | 222 |
| menu-button-active-fg-color | (bs) | (false, "rgb(242,242,242)") | (enabled, colour) | Menu button active foreground | 226 |
| search-entry-border-radius | (bi) | (true, 25) | (enabled, px) | Search entry border radius | 342 |
| icon-style-categories | enum `menu-item-icon-style` | 'Symbolic' | Full_Color, Symbolic | Category icon style | 285 |
| icon-style-shortcuts | enum `menu-item-icon-style` | 'Symbolic' | Full_Color, Symbolic | Shortcut icon style | 289 |
| icon-style-buttons | enum `menu-item-icon-style` | 'Symbolic' | Full_Color, Symbolic | Button icon style | 293 |

### 2e. Icon sizes (-1 = layout default)

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| icon-size-apps | i | -1 | -1 or px | Icon size of application items | 567 |
| icon-size-shortcuts | i | -1 | -1 or px | Icon size of shortcut items | 572 |
| icon-size-categories | i | -1 | -1, 0 (hide), or px | Icon size of category items | 577 |
| icon-size-buttons | i | -1 | -1 or px | Icon size of button items | 582 |
| icon-size-misc | i | -1 | -1 or px | Icon size of search and navigation icons | 587 |
| icon-size-grid | a{si} | {'width': -1, 'height': -1, 'size': -1} | keys width/height/size | Icon size of app grid items | 592 |

### 2f. Pinned apps, shortcuts, and lists

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| pinned-apps | aa{ss} | [{'id': 'firefox.desktop'}, {'id': 'org.gnome.Nautilus.desktop'}, {'id': 'org.gnome.Terminal.desktop'}, {'id': 'gnome-extensions prefs arcmenu@arcmenu.com', 'name': 'ArcMenu Settings', 'icon': 'ArcMenu_ArcMenuIcon'}] (L684-691) | - | Pinned apps (apps, custom items, folders) | 683 |
| directory-shortcuts | aa{ss} | Home, Documents, Downloads, Music, Pictures, Videos (`ArcMenu_*` ids, L697-702) | - | Directory shortcuts | 694 |
| application-shortcuts | aa{ss} | Software, Settings, GNOME Tweaks, Terminal, Activities Overview (L710-714) | - | Application shortcuts | 707 |
| context-menu-items | aa{ss} | Extensions, ArcMenu Settings, Panel Extension Settings, Separator, Power Options, Activities Overview, Show Desktop (L832-839) | - | Context menu shortcut items | 830 |
| recently-installed-apps | as | [] | - | List of recently installed app ids | 658 |
| az-layout-extra-shortcuts | aa{ss} | Nautilus, Terminal, Settings (L722-724) | - | AZ layout extra shortcuts | 719 |
| brisk-layout-extra-shortcuts | aa{ss} | Software, Settings (L732-733) | - | Brisk layout extra shortcuts | 729 |
| eleven-layout-extra-shortcuts | aa{ss} | Nautilus, Terminal, Settings (L741-743) | - | Eleven layout extra shortcuts | 738 |
| insider-layout-extra-shortcuts | aa{ss} | Nautilus, Terminal, Settings (L751-753) | - | Insider layout extra shortcuts | 748 |
| mint-layout-extra-shortcuts | aa{ss} | firefox, Terminal, Settings, Software, Nautilus, Separator, Log Out, Lock, Power Off (L761-769) | - | Mint layout extra shortcuts | 758 |
| sleek-layout-extra-shortcuts | aa{ss} | Home, Documents, Downloads, Music, Pictures, Software, Settings, Terminal (L777-784) | - | Sleek layout extra shortcuts | 774 |
| zest-layout-extra-shortcuts | aa{ss} | Home, Documents, Downloads, Music, Pictures, Software, Settings, Terminal (L792-799) | - | Zest layout extra shortcuts | 789 |
| unity-layout-extra-shortcuts | aa{ss} | Home, Documents, Downloads, Software, Nautilus, Separator, Log Out, Lock, Power Off (L807-815) | - | Unity layout extra shortcuts | 804 |
| windows-layout-extra-shortcuts | aa{ss} | Nautilus, Terminal, Settings (L823-825) | - | Windows layout extra shortcuts | 820 |
| (child) pinned-apps-folders/<uuid>: pinned-apps | aa{ss} | [] | - | Pinned apps inside one folder (relocatable child schema, see section 1) | 95 (schema L94) |

### 2g. Search

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| search-hidden | b | false | - | Hide search entry; shown only when non-empty | 318 |
| max-search-results | i | 5 | - | Number of search results shown | 322 |
| highlight-search-result-terms | b | false | - | Highlight matched terms in results | 326 |
| show-search-result-details | b | false | - | Show search result description label | 330 |
| search-provider-open-windows | b | false | - | Custom search provider: open windows | 334 |
| search-provider-recent-files | b | false | - | Custom search provider: recent files | 338 |
| show-hidden-recent-files | b | false | - | Show hidden recent files | 346 |
| apps-show-extra-details | b | false | - | Larger icon and extra app details | 309 |
| apps-show-generic-names | b | false | - | Show GenericName instead of Name (falls back to Name) | 313 |

### 2h. Hotkeys

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| arcmenu-hotkey | as | ['Super_L'] | accelerator strings | Keybind to open ArcMenu | 522 |
| arcmenu-hotkey-overlay-key-enabled | b | true | - | Override overlay key for ArcMenu hotkey | 526 |
| runner-hotkey | as | [] | accelerator strings | Keybind for standalone runner; setting one enables the standalone runner | 530 |
| runner-hotkey-overlay-key-enabled | b | false | - | Override overlay key for standalone runner hotkey | 534 |
| hotkey-open-primary-monitor | b | false | - | Open ArcMenu on primary monitor via hotkey | 538 |
| runner-hotkey-open-primary-monitor | b | false | - | Open standalone runner on primary monitor via hotkey | 542 |

### 2i. Power

| key | type | default | enum/range | meaning | L |
|---|---|---|---|---|---|
| power-options | a(ib) | [(0, true), (1, true), (2, true), (3, true), (4, false), (5, false), (6, false), (7, false)] | (id, enabled), id 0-7 | Power option items and visibility | 506 |
| power-display-style | enum `power-display-style` | 'Default' | Default, In_Line, Menu | Display type for power options | 510 |

Count per area (main schema): 2a 39, 2b 36, 2c 10, 2d 26, 2e 6, 2f 14 (+1 child key), 2g 9, 2h 6, 2i 2. Main total = 148; with child = 149.

---

## 3. User-set keys (dump `arcmenu-settings.ini`)

Root section `[/]` (dump L2-L39), 38 keys. All are **USED** (referenced by name in `src/`, outside `schemas/`).

| key | dump value | default | changed vs default? | USED (example refs) |
|---|---|---|---|---|
| application-shortcuts | `[{'id': 'ArcMenu_Software', 'name': 'Software'}, {'name': 'Separator', 'icon': 'list-remove-symbolic', 'id': 'ArcMenu_Separator'}, {'id': 'org.gnome.Ptyxis.desktop'}, {'id': 'org.gnome.Nautilus.desktop'}, {'id': 'org.gnome.Settings.desktop'}]` | 5 items (L710-714) | yes | `src/menuController.js:124`, `src/menulayouts/arcmenu.js`, `src/menulayouts/tognee.js` |
| context-menu-items | 9 items starting `org.gnome.Nautilus.desktop` | 7 items (L832-839) | yes | `src/menuButton.js:855`, `src/settings/menuSettings/listPinnedPage.js:239` |
| directory-shortcuts | `[{'id': 'ArcMenu_Home', 'name': 'Home', 'icon': 'ArcMenu_Home'}]` | 6 items (L697-702) | yes | `src/menuController.js:124` |
| icon-size-apps | -1 | -1 | no | `src/menuWidgets.js:1405` |
| icon-size-buttons | -1 | -1 | no | `src/menuWidgets.js:817` |
| icon-size-categories | -1 | -1 | no | `src/menuWidgets.js:1296` |
| icon-size-misc | -1 | -1 | no | `src/menuWidgets.js:1172` |
| icon-size-shortcuts | -1 | -1 | no | `src/menuWidgets.js:612` |
| menu-background-color | 'rgba(48,48,49,0.98)' | same | no | `src/theming.js:22` |
| menu-border-color | 'rgb(60,60,60)' | same | no | `src/theming.js:23` |
| menu-border-radius | 14 | same | no | `src/theming.js:23` |
| menu-border-width | 1 | same | no | `src/theming.js:23` |
| menu-button-active-bg-color | (false, 'rgba(242,242,242,0.2)') | same | no | `src/theming.js:26` |
| menu-button-active-fg-color | (false, 'rgb(242,242,242)') | same | no | `src/theming.js:27` |
| menu-button-bg-color | (false, 'rgba(242,242,242,0.2)') | same | no | `src/theming.js:25` |
| menu-button-border-color | (false, 'transparent') | same | no | `src/theming.js:24` |
| menu-button-border-radius | (false, 20) | same | no | `src/theming.js:27` |
| menu-button-border-width | (false, 3) | same | no | `src/theming.js:27` |
| menu-button-fg-color | (false, 'rgb(242,242,242)') | same | no | `src/theming.js:25` |
| menu-button-hover-bg-color | (false, 'rgba(242,242,242,0.15)') | same | no | `src/theming.js:26` |
| menu-button-hover-fg-color | (false, 'rgb(242,242,242)') | same | no | `src/theming.js:26` |
| menu-button-icon | 'resource:///org/gnome/shell/extensions/arcmenu/icons/scalable/actions/distro-fedora-symbolic.svg' | icon-arcmenu-logo-symbolic.svg | yes | `src/menuController.js:147` |
| menu-button-icon-size | 30 | 20 | yes | `src/menuController.js:150` |
| menu-button-padding | -1 | -1 | no | `src/menuController.js:151` |
| menu-foreground-color | 'rgb(223,223,223)' | same | no | `src/theming.js:22` |
| menu-item-active-bg-color | 'rgb(25,98,163)' | same | no | `src/theming.js:24` |
| menu-item-active-fg-color | 'rgb(255,255,255)' | same | no | `src/theming.js:25` |
| menu-item-hover-bg-color | 'rgb(21,83,158)' | same | no | `src/theming.js:24` |
| menu-item-hover-fg-color | 'rgb(255,255,255)' | same | no | `src/theming.js:24` |
| menu-layout | 'arcmenu' | 'arcmenu' | no | `src/menuController.js:153`, `src/menuButton.js:215` |
| menu-separator-color | 'rgba(255,255,255,0.1)' | same | no | `src/theming.js:23` |
| override-menu-theme | false | false | no | `src/theming.js:22` |
| pinned-apps | 6 entries: steam.desktop, com.anthropic.Claude.desktop, husk.desktop, folder 7d610436-... (Internet), folder 3c2219f1-... (Games), folder 7d76d6f0-... (Tarky) | 4 apps (L684-691) | yes | `src/menuController.js:145` |
| power-options | [(0, false), (1, true), (2, true), (3, true), (4, false), (5, false), (6, false), (7, false)] | differs at index 0 only | yes | `src/menuController.js:124` |
| prefs-visible-page | 0 | 0 | no | `src/menuButton.js:893`, `src/prefs.js:50` |
| recently-installed-apps | 12 desktop ids (dump L37) | [] | yes | `src/menuController.js:196` |
| search-entry-border-radius | (true, 25) | (true, 25) | no | `src/theming.js:22` |
| update-notifier-project-version | 74 | 0 | yes | `src/updateNotifier.js:53` |

Child sections (dump L41-L48), all USED via `src/menuWidgets.js:2527`, `src/menulayouts/baseMenuLayout.js:709-710`, `src/settings/menuSettings/listPinnedPage.js:90-91`:
- `[pinned-apps-folders/3c2219f1-a114-4e2e-a06c-51fdefa91991]` pinned-apps: eden.desktop, com.heroicgameslauncher.hgl.desktop, com.usebottles.bottles.desktop, org.prismlauncher.PrismLauncher.desktop, com.discordapp.Discord.desktop (Games)
- `[pinned-apps-folders/7d610436-4b17-46cf-99db-97578edac1c1]` pinned-apps: slack.desktop, Zoom.desktop, code.desktop, obsidian.desktop (Internet)
- `[pinned-apps-folders/7d76d6f0-79d7-40fb-87f8-8838ebe22b19]` pinned-apps: 'SPT - Server.desktop', 'SPT - Launcher.desktop' (Tarky)

Keys in the main schema but NOT in the dump (use schema default): 148 - 38 = 110 keys. Each is at its schema default.

Dump line 1 is `[/]` (root). Dump lines 40, 43 are blank separators.

---

## 4. Enums (nick to value)

Value numbers are the `value=` attribute. Nicks are the strings stored in GSettings.

| enum id (suffix) | nick → value |
|---|---|
| `forcemenulocation` (L3-14) | Off→0, TopCentered→1, TopLeft→2, TopRight→3, BottomCentered→4, BottomLeft→5, BottomRight→6, LeftCentered→7, RightCentered→8, MonitorCentered→9 |
| `menu-position` (L15-19) | Left→0, Center→1, Right→2 |
| `menu-button-click-action` (L20-24) | ArcMenu→0, ContextMenu→1, None→2 |
| `raven-position` (L25-28) | Left→0, Right→1 |
| `menu-button-appearance` (L29-35) | Icon→0, Text→1, Icon_Text→2, Text_Icon→3, None→4 |
| `avatar-style` (L36-39) | Round→0, Square→1 |
| `default-menu-view` (L40-46) | Pinned_Apps→0, Categories_List→1, Frequent_Apps→2, All_Programs→3, Pinned_And_Frequent_Apps→4 |
| `all-apps-button-action` (L47-50) | Categories_List→0, All_Programs→1 |
| `default-menu-view-tognee` (L51-54) | Categories_List→0, All_Programs→1 |
| `default-menu-view-redmond` (L55-58) | All_Programs→0, Pinned_Apps→1 |
| `default-menu-view-az` (L59-62) | Pinned_Apps→0, "Frequent Apps"→1 (space, not underscore) |
| `default-menu-view-runner` (L63-67) | Default→0, Pinned_Apps→1, "Frequent Apps"→2 (space) |
| `runner-position` (L68-71) | Top→0, Centered→1 |
| `search-display-style` (L72-75) | List→0, Grid→1 |
| `searchbar-location` (L76-79) | Bottom→0, Top→1 |
| `menuitem-location` (L80-83) | Bottom→0, Top→1 |
| `power-display-style` (L84-88) | Default→0, In_Line→1, Menu→2 |
| `menu-item-icon-style` (L89-92) | Full_Color→0, Symbolic→1 |

Non-enum choice list: `menu-layout` (type `s`, L114-142) uses `<choices>` not an enum; values listed in section 2a.

---

## 5. Non-obvious value formats

- **(bool, value) tuples** (`(bs)`, `(bi)`): `(enabled, value)`. When `enabled` is false the value is ignored and the built-in theme/default is used; when true, the stored value overrides. Examples: `menu-button-fg-color (false, 'rgb(242,242,242)')`, `search-entry-border-radius (true, 25)` (enabled, so 25 is in effect), `menu-arrow-rise (false, 6)`.
- **power-options `a(ib)`**: array of `(id, enabled)`. Ids 0-7 are present in both default and dump. The schema does not define the meaning of each id; it lives in code.
- **extra-categories / arcmenu-extra-categories-links `a(ib)`**: array of `(category id, enabled)`. Ids per the summary refer to `Constants.js` Categories (not in schema).
- **pinned-apps / directory-shortcuts / application-shortcuts / context-menu-items / *-layout-extra-shortcuts `aa{ss}`**: array of dicts with string keys and string values. Shapes seen:
  - App: `{'id': 'x.desktop'}`
  - Custom item: `{'id': 'ArcMenu_Software', 'name': 'Software'}` or with `'icon': '<icon-name>'`. Built-in ids use the `ArcMenu_` prefix (e.g. `ArcMenu_Home`, `ArcMenu_Separator`, `ArcMenu_PowerOff`).
  - Separator: `{'id': 'ArcMenu_Separator', 'name': 'Separator', 'icon': 'list-remove-symbolic'}`.
  - Settings item with a command as id: `{'id': 'gnome-extensions prefs arcmenu@arcmenu.com', 'name': 'ArcMenu Settings', 'icon': 'ArcMenu_ArcMenuIcon'}` (default pinned-apps, L689).
  - Folder (in `pinned-apps` only): `{'id': '<uuid>', 'name': '<folder name>', 'isFolder': 'true'}`. `isFolder` is the **string** `'true'` in the dump; the folder's items are in `pinned-apps-folders/<uuid>/`.
- **icon-size-grid `a{si}`**: dict with keys `width`, `height`, `size` (int). -1 = layout default.
- **menu-themes `aas`**: each theme is a 12-string array in this order (L232-234): `[Theme Name, menuBGColor, menuFGColor, menuBorderColor, menuBorderWidth, menuBorderRadius, menuFontSize, menuSeparatorColor, itemHoverBGColor, itemHoverFGColor, itemActiveBGColor, itemActiveFGColor]`. Numeric fields are strings (e.g. `'1'`, `'14'`, `'11'`).
- **Colours** are CSS-style strings (`rgb(...)`, `rgba(...)`, `transparent`).
- **menu-button-icon**: a file path, a `resource:///` URI, or a symbolic icon name (L623-628).
- **update-notifier-project-version**: int; `0` default; dump 74 means "notification shown for project version 74."
- **pop-folders-data `a{ss}`**: id→name map for `org.gnome.desktop.app-folders`. Default `{}`.
- **Enum-typed keys** are stored as the nick string, e.g. `'Pinned_Apps'`, not the numeric value.

---

## 6. Dump values that differ from schema defaults (migration-relevant)

- `menu-button-icon`: `distro-fedora-symbolic.svg` instead of `icon-arcmenu-logo-symbolic.svg`.
- `menu-button-icon-size`: 30 (default 20).
- `power-options`: index 0 `(0, false)` (default `(0, true)`).
- `application-shortcuts`, `context-menu-items`, `directory-shortcuts`, `pinned-apps`, `recently-installed-apps`: all replaced by user values.
- `update-notifier-project-version`: 74 (default 0).
- Folders `pinned-apps-folders/<uuid>`: default `[]`, user has items.

---

## 7. Discrepancies noticed in the schema

- `menu-layout` `<choices>` (L118) contains `'11'` but not `'eleven'`. `menu-layout` is `s` with no enum, so the tool should not validate against that list alone.
- `menu-button-border-width` summary (L208) says "border radius". `menu-button-border-color` summary (L212) says "hover bg color". Summary text only, no effect on values.
- `default-menu-view-az` and `default-menu-view-runner` use nick `"Frequent Apps"` (with a space), unlike other enums (underscore). Use exact nicks.
- `menu-button-appearance` enum `None` (L34) and `menu-button-click-action` enum `None` (L23) are both nick `None`. Unambiguous per enum, but do not share a lookup table.
- `menu-font-size` (L168) is in the schema but absent from the dump (default 11).

Cross-check: the schema has 148 main keys. Grep of `<key ` in the XML returns 149 (148 main + 1 child `pinned-apps`).
