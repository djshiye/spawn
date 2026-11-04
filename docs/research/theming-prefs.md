# ArcMenu: theming and preferences (analysis)

Source root: `ArcMenu (https://gitlab.com/arcmenu/ArcMenu, master)`
Paths below are relative to that root. Verification status is marked where it matters.

## 1. Theming

### 1a. How styling is applied
- **Generated stylesheet, not inline styles.** `CustomStylesheet` (`src/theming.js:12`) writes a temp file (`Gio.File.new_tmp('XXXXXX-arcmenu-stylesheet.css')`, `theming.js:14, 39`), then loads it into the St theme with `theme.load_stylesheet()` (`theming.js:144-145`) and unloads the previous one first (`theming.js:73-79, 87`).
- Regeneration is triggered by `connectSettings([...])` on 23 keys (`theming.js:21-30`) and debounced (`theming.js:33-35`).
- `extension.js:31` creates it; `extension.js:74` destroys it on shutdown; `extension.js:87` on disable.
- `src/stylesheet.css` (static, 134 lines) is not referenced by any JS file (grep). **Unverified:** it is presumably auto-loaded by GNOME Shell from the extension root, since `Makefile:11-16` ships `src/*` to the zip root.

### 1b. Two CSS layers in `_update` (`theming.js:81-149`)
1. **Always applied (no override flag needed)**, `theming.js:104-125`: menu-button fg/bg/hover/active colors, radius, border width and color, `.arcmenu-panel-menu` rules; plus `menu-arrow-rise` (`theming.js:122-123`, `-arrow-rise` on `.arcmenu-menu`) and `search-entry-border-radius` (`theming.js:124-125`, `#ArcMenuSearchEntry`). Each is gated on the bool in its `(bs)`/`(bi)` tuple (`theming.js:90-100`).
2. **Only when `override-menu-theme` is true**, `theming.js:127-128`, appends `_buildCustomCSS()` (`theming.js:151-250`), which covers menu font size and fg, the popup content box (`.arcmenu-menu .popup-menu-content`), StButton, scrollbar handles, popup items (hover/active), insensitive items, world-clocks/weather labels, separators, StEntry, `.hint-text`, `#ArcMenu_Tooltip`, and `.user-icon`.
- Early return when `css` is empty (`theming.js:130-131`), which leaves the previous sheet unloaded.
- Colour derivation uses `_adjustLuminance()` (`theming.js:252-276`), which works in HLS and forces alpha via `overrideAlpha` (e.g. `0.1, .4` at `theming.js:229`).
- **Likely-broken fallback (unverified):** the `Cogl` branch at `theming.js:258-259, 273` calls `Cogl.color_init_from_hsl(...)` as a function on a non-instance. It runs only if `Clutter.Color` is undefined. Not tested.

### 1c. CSS class and id names used
- Menu root: `.arcmenu-menu` (`src/appMenu.js` / `src/menuController.js` class usage at `src/appMenu.js:154`; `src/menuButton.js:757` adds `panel-menu arcmenu-menu`; `src/menuButton.js:833` adds `panel-menu app-menu` for the context menu).
- Panel button: `.arcmenu-panel-menu` (`src/menuButton.js:120`); `.arcmenu-menu-button` on the icon and label (`src/menuButton.js:45, 52`); `panel-status-menu-box` (`src/menuButton.js:41`).
- Bottom-location modifier: `.arcmenu-menu-location-bottom` (`src/menuButton.js:352, 355`).
- Search: `#ArcMenuSearchEntry` (`theming.js:125`, `theming.js:226-237` for StEntry).
- Tooltip: `#ArcMenu_Tooltip` (`theming.js:241`); `.arcmenu-tooltip` in stylesheet.css:113.
- Others defined only in `src/stylesheet.css`: `.ArcMenuIconGrid` (l.1), `.ArcMenuGroupFolder` (l.8), `.arcmenu-menu-item` (l.61), `.arcmenu-search-entry`/`-top`/`-bottom` (l.39-52), `.symbolic-icons`/`.regular-icons` (l.54-59), `.arcmenu-plasma-button` (l.66), `.small-vfade` (l.75), `.arcmenu-margin-box` (l.79), `.arcmenu-button`/`.arcmenu-small-button`/`.arcmenu-alphabet-button` (l.83-102), `.arcmenu-avatar-round`/`-square` (l.104-111), `.arcmenu-indicator` (l.121), `.arcmenu-text-indicator` (l.127), `.separator-color-style` (theming.js:223). Usage of these in layouts was not traced (unverified).
- Hard-coded accent in stylesheet.css, not themed: GNOME blue `rgba(53,132,228,…)` for drop targets (l.13-14, 18-19); `rgb(41,165,249)` for `.arcmenu-indicator` (l.123).

### 1d. Theme presets and override flag
- Presets live in GSettings `menu-themes` (`aas`, 12 fields per theme), default array at `schemas/org.gnome.shell.extensions.arcmenu.gschema.xml:231-244` (presets: "ArcMenu Style", "Simply Dark", "Dark Blue", "Light Blue"). Field order is documented at `schemas/...xml:232-234` and `settings/menuSettings/themingDialog.js:170-172`.
- `ThemePage` (`settings/menuSettings/themePage.js`): override switch (`:23-44`) writes `override-menu-theme` and shows/hides the theme, styling and item-styling groups (`:28-35, 220-226`). The theme dropdown fills colours from the preset (`:95-117`). `checkIfThemeMatch` (`:228-258`) selects the matching preset and disables "Save as Theme" (`:249`) when a match is found, otherwise enables it (`:255`).
- **Probable bug:** the compare loop at `themePage.js:239` uses `i < currentSettingsArray.length - 1`, which skips the last field (`itemActiveFGColor`, index 11).
- **Risk (unverified):** matching compares strings from `Gdk.RGBA.to_string()` (`themePage.js:297`) against stored strings like `"rgba(48,48,49,0.98)"`. Format differences could stop presets from matching.
- Theme page has its restore button hidden (`themePage.js:18`); no reset.

### 1e. Menu-button icon, text, and appearance
- Settings: `menu-button-appearance` enum Icon/Text/Icon_Text/Text_Icon/None (`schemas/...xml:29-35`, default `'Icon'` at `:558-561`); `menu-button-text` default `'Apps'` (`:618-621`); `menu-button-icon` string default `resource:///org/gnome/shell/extensions/arcmenu/icons/scalable/actions/icon-arcmenu-logo-symbolic.svg` (`:622-629`); `menu-button-icon-size` default 20 (`:630-633`); `menu-button-padding` -1 (`:634-637`); `menu-button-position-offset` 0 (`:638-641`).
- Apply logic: `src/menuController.js:311-341` (appearance switch, hides for NONE and sets container to 0 size), `:343-349` text, `:351-363` icon (`Gio.Icon.new_for_string(path)`, falls back to `start-here-symbolic` at `:362`), `:365-371` icon size, `:373-391` padding (`-natural-hpadding`/`-minimum-hpadding` style at `:376`).
- Widget: `MenuButtonWidget` (`src/menuButton.js:34-109`) holds an `St.Icon` and `St.Label`, with show/hide helpers at `:70-96`.
- Also in the menu-button context menu, "Button" settings deep-link via `prefs-visible-page` (`src/menuButton.js:874-875, 893`).
- Icon sources (from the icon chooser, `settings/iconChooserDialog.js:11-16`; list built in `prefs.js:165-233`):
  - **Extension bundled icons**: `resource:///org/gnome/shell/extensions/arcmenu/icons/scalable/actions/*.svg` (`src/constants.js:3`, `prefs.js:183-197`). These include `icon-*-symbolic.svg`, including `icon-arcmenu-logo-symbolic.svg` and the `distro-*` set.
  - **Distro icons**: `distro-*.svg` in the `actions/` directory (group DISTRO, `prefs.js:192`). Full-colour and symbolic variants.
  - **System icon-theme names** (`IconGroup.SYSTEM`, `prefs.js:218-231`).
  - **Arbitrary file** via FileChooser, filter `add_pixbuf_formats` (`iconChooserDialog.js:256-278`). Stores an absolute path.
- Resource registration: `src/extension.js:22-23` (`Gio.Resource.load(${path}/data/resources.gresource)`); the prefs side does the same plus `iconTheme.add_resource_path` (`prefs.js:34-40`).
- Gresource XML `data/resources.gresource.xml:1-4` (prefix `/org/gnome/shell/extensions/arcmenu`). The file is **regenerated on every build** by `Makefile:54-70`; the committed copy is a generated artifact.
- Menu button widget class `St.ButtonMask.ONE` appears at `src/menuWidgets.js:2099` (menu items, not the panel button).

## 2. Icon options summary
- Modes: distro icon, bundled ArcMenu icon, system theme name, custom file path, or text-only. Icon filter groups: All, Extension, Distros, System; type: All, Symbolic, Full Colour (`iconChooserDialog.js:18-35, 136-157, 180-229`).
- Grid view, `max_columns: 9` (`iconChooserDialog.js:86-92`).
- Known inconsistency: the action list at `iconChooserDialog.js:222` uses `'distros'`, while the menu item and `IconGroupFromString` use `'distro'` (`:188-193, :19-22`). Only the default is checked, so impact looks small.

## 3. Preferences app

Entry: `src/prefs.js`. Window pages added at `prefs.js:105-123`: GeneralPage, MenuPage, MenuButtonPage, DonatePage, AboutPage. Page routing via `prefs-visible-page` (`prefs.js:128-163`). `LAYOUT_TWEAKS` (`constants.js:59`) has no branch in `prefs.js`. Window size read from `settings-width/height` at `prefs.js:47`.

Adw widgets used: `Adw.PreferencesWindow`/`Page`/`Group`, `Adw.ActionRow`, `Adw.ExpanderRow` (enable switch), `Adw.ComboRow`, `Adw.SwitchRow` (`prefsWidgets.js:11-36` custom wrapper), `Adw.NavigationPage`, `Adw.ToolbarView`, `Adw.HeaderBar`, `Adw.Toast`, `Adw.Window`. Plus `Gtk.SpinButton`, `Gtk.Switch`, `Gtk.ColorButton` (`use_alpha`), `Gtk.Scale`, `Gtk.DropDown`, `Gtk.GridView`, `Gtk.FileChooserDialog`, `Gtk.MessageDialog`.

### General (`settings/generalPage.js`)
- Panel Display Options: `position-in-panel` combo (`:67-78`); `menu-position-alignment` slider 0-100, shown only for Centre (`:82-103`); `multi-monitor` (`:106-121`); `dash-to-panel-standalone` "Always Prefer Top Panel" (`:124-138`); `show-activities-button` (`:47-59`).
- General Settings: ArcMenu Hotkey row with `arcmenu-hotkey` (`:152, 187-218`); Standalone Runner Menu with `runner-hotkey`, plus a configure button that opens Runner tweaks (`:153, 227-240`); `hide-overview-on-startup` (`:157-170`); `hide-overview-on-arcmenu-open` (`:172-184`).
- HotkeyDialog (`:262-677`) captures keys, checks conflicts against `org.gnome.mutter`, `org.gnome.shell.keybindings`, `org.gnome.desktop.wm.keybindings`, and media keys (`:575-656`), sets overlay-key and primary-monitor sub-settings (`:313-316`). Uses `Gtk.accelerator_get_default_mod_mask` (`:445`).

### Menu (`settings/menuPage.js`)
Groups "How should the menu look?" (`:32-84`):
- Menu Layout → LayoutsPage (`menu-layout`).
- Menu Theme → ThemePage.
- Menu Visual Appearance → VisualSettingsPage.
- Fine Tune → FineTunePage.

Group "What should show on the menu?" (`:86-168`):
- "<Layout> Layout Tweaks" → LayoutTweaksPage.
- Pinned Apps (`pinned-apps`), Directory Shortcuts (`directory-shortcuts`), Application Shortcuts (`application-shortcuts`) → ListPinnedPage.
- Search Options → SearchOptionsPage.
- Power Options (`power-options`, `power-display-style`) and Extra Categories (`extra-categories`) → ListOtherPage.

Context menu group (`:170-183`): `context-menu-items` via ListPinnedPage.

`settingsUtils.setVisibleRows` (`settings/settingsUtils.js:41-97`) hides rows per layout.

### Menu Theme (`settings/menuSettings/themePage.js`)
- Override Theme switch, which writes `override-menu-theme` (`:23-44`).
- Current Theme dropdown, plus manage button and "Save as Theme" (`:46-174`).
- Menu Styling (`:176-201`): `menu-background-color`, `menu-foreground-color`, `menu-border-color` (colour); `menu-border-width` 0-5, `menu-border-radius` 0-25, `menu-font-size` 8-18 (spin); `menu-separator-color`.
- Menu Items Styling (`:203-218`): `menu-item-hover-bg-color`, `menu-item-hover-fg-color`, `menu-item-active-bg-color`, `menu-item-active-fg-color`.

### Theme management (`settings/menuSettings/themingDialog.js`)
- ManageThemesDialog (`:57-285`): list with drag reorder and rename/delete (`:195-245`); selection via `EditEntriesBox` (`prefsWidgets.js:317-434`).
- **Import and export of themes as JSON** (`:73-126` import, `:126-158` export, `:169-193` serialisation). Keys: `Name`, `Menu_Background_Color`, and so on. Import merges by `concat` (`:110`) with no de-duplication and no validation of missing keys (`:87-102`); a missing key would store `undefined` and likely make the GVariant build throw (unverified).
- SaveThemeDialog (`:12-55`).

### Menu Visual Appearance (`settings/menuSettings/visualSettings.js`)
- Menu Size: `menu-height` 300-4320; `left-panel-width` 175-2500; `right-panel-width` 200-2500; `menu-width-adjustment` -350-5000 (`:24-79`).
- Menu Location: `force-menu-location` combo (`:81-105`); `menu-arrow-rise` switch plus spin -50..50 (`:107-141`).
- Grid Menu Items: `icon-size-grid` (`a{si}`) with presets and width/height/size spins (`:143-263`).
- Per-type icon sizes via `createIconSizeRow` (`:265-289`): `icon-size-apps`, `icon-size-shortcuts`, `icon-size-categories` (with Hide Icon switch), `icon-size-buttons`, `icon-size-misc`. Presets Small/Medium/Large/XL; spin 10-64; `0` = hidden, `-1` = layout default (`settings/constants` IconSizes at `src/constants.js:143-150`).

### Fine Tune (`settings/menuSettings/fineTunePage.js`)
- Misc: `show-category-sub-menus`, `apps-show-extra-details`, `apps-show-generic-names`, `show-hidden-recent-files`, `multi-lined-labels`, `show-tooltips`, `group-apps-alphabetically-list-layouts`, `group-apps-alphabetically-grid-layouts`, `activate-on-launch`, `keep-open-on-ctrl-click` (`:29-62`).
- Scrollview: `scrollview-fade-effect`, `scrollbars-visible` (expander enable), `scrollbars-overlay` (`:69-82`).
- Icon Style combos: `icon-style-categories`, `icon-style-shortcuts`, `icon-style-buttons` (`:89-135`).
- New Apps Tracker: `show-recently-installed-apps`, Clear All resets `recently-installed-apps` (`:142-154`).
- `restoreDefaults` via `SettingsUtils.resetSetting` (`:156-160`).

### Search Options (`settings/menuSettings/searchOptionsPage.js`)
- `search-hidden`, `show-search-result-details`, `highlight-search-result-terms`, `max-search-results` (2-10), `search-entry-border-radius` (`bi`, 0-25) (`:19-131`).
- Extra Search Providers: `search-provider-open-windows`, `search-provider-recent-files` (`:137-163`).

### Menu Layout (`settings/menuSettings/layoutsPage.js`)
- Tiles grouped by `LayoutCategoriesInfo` (Traditional, Modern, Touch, Launcher, Alternative), built from `MenuLayoutsInfo` (`src/constants.js:250-282`). Selection writes `menu-layout` (`:61-77`). Icons `menu-<id>-symbolic` (`:29, 243`).

### Layout Tweaks (`settings/menuSettings/layoutTweaksPage.js`)
Method per layout, `_<id>Tweaks`, with placeholder "Nothing Yet!" otherwise (`:37-50, 807-814`). Settings per layout:
- arcmenu (`:839-964`): `default-menu-view` (5 options; `arcmenu-layout-max-frequent-apps` shown for views 2 and 4), `all-apps-button-action`, avatar (`show-user-avatar`, `avatar-style`), searchbar bottom default, `enable-horizontal-flip`, `vert-separator`, External Devices, Bookmarks, Category Quick Links (`arcmenu-extra-categories-links`), `arcmenu-extra-categories-links-location`.
- brisk (`:394-406`), budgie (`:420-442`), mint (`:669-681`), whisker (`:683-691`), enterprise (`:179-187`), gnome-menu (`:798-805`), insider (`:786-796`), zest (`:966-1001`), sleek (`:693-726`), redmond (`:728-784`), tognee (`:816-837`), windows (`:334-371`), az (`:252-314`), plasma (`:373-392`, `plasma-enable-hover`), pop (`:189-227`), 11 (`:229-250`), unity (`:593-618`), raven (`:620-667`), gnome-overview (`:316-332`, `gnome-dash-show-applications`), chromebook/elementary (`:408-418`).
- runner (`:444-591`): position, search display style, searchbar, `runner-menu-width` 300-5000, `runner-menu-height` 300-1000, `runner-menu-height-static`, `runner-font-size` 0-30, default view, `runner-show-settings-button`.
- Weather and clock widgets for unity and raven: `_createWidgetsRows` (`:1003-1038`), keys `enable-weather-widget-<id>`, `enable-clock-widget-<id>`.
- Extra Shortcuts: `_createExtraShortcutsRow(setting)` opens ListPinnedPage (`:52-68`).

### Lists (`settings/menuSettings/listPinnedPage.js`, `listOtherPage.js`)
- ListPinnedPage (`:60-324`): used for pinned-apps, directory-shortcuts, application-shortcuts, context-menu-items, `<layout>-layout-extra-shortcuts`, and folder pinned apps (`pinned-apps-folders/<id>/`, `:88-95`). Rows are drag-reorderable with switch and edit (`prefsWidgets.js:137-309`). Add-app dialog from `Gio.app_info_get_all()` (`:483-515`) plus extra items (`:347-406`). Custom shortcut dialog with title, icon, and command (`:561-696`).
- ListOtherPage (`:13-123`): power options (8 entries, `src/constants.js:239-248`) with `power-display-style` (labels Off/Power Buttons/Power Menu, `:37-55`; "Off" maps to enum `Default`, a naming mismatch); extra categories (5 entries, `src/constants.js:84-90`).

### About (`settings/aboutPage.js`)
- Version, commit, GNOME version, OS, session type (`:157-186`); `update-notifier-enabled` (`:131-144`); GitLab and issue links (`:191-195`).
- Release notes from `RELEASENOTES.md` (`:96-106`).
- **Whole-settings Save/Load** via `dconf dump` and `dconf load` on `/org/gnome/shell/extensions/arcmenu/` (`:206-254`). Load uses `GLib.spawn_async_with_pipes` with `dconf load` (`:218-231`); Save uses `GLib.spawn_command_line_sync` (`:250`). This depends on the `dconf` binary being present.
- Credits, Legal (`:264-331`).

### Other pages
- DonatePage (`settings/donatePage.js:8-75`): PayPal and Buy Me a Coffee links via `Gtk.show_uri`.
- MenuButtonPage (`settings/menuButtonPage.js:12-416`):
  - Appearance: `menu-button-appearance`, `menu-button-text`, `menu-button-padding` (-1-25), `menu-button-position-offset` (0-10).
  - Icon: "Choose a New Icon" writes `menu-button-icon`; `menu-button-icon-size` 14-64.
  - Click options: `menu-button-left-click-action`, `menu-button-right-click-action`, `menu-button-middle-click-action` (ArcMenu / Context Menu / None).
  - Styling (subtitle "Results may vary with third party themes"): `menu-button-fg-color`, `menu-button-bg-color`, `menu-button-hover-bg-color`, `menu-button-hover-fg-color`, `menu-button-active-bg-color`, `menu-button-active-fg-color`, `menu-button-border-color` (each `(bs)` switch + colour), `menu-button-border-radius` (`bi`, 0-25), `menu-button-border-width` (`bi`, 0-5).

## 4. Build pipeline
- `Makefile:3-7`: GETTEXT_DOMAIN `arcmenu`, schema `org.gnome.shell.extensions.arcmenu`, resource path `/org/gnome/shell/extensions/arcmenu`, UUID `arcmenu@arcmenu.com`.
- `Makefile:11-16` PACKAGE_FILES (LICENSE, metadata.json, README, RELEASENOTES, `src/*` flattened).
- Schemas: `_compile-schemas` runs `glib-compile-schemas --strict ./schemas/` (`Makefile:72-76`). Schema source is `schemas/org.gnome.shell.extensions.arcmenu.gschema.xml`.
- Resources: `_compile-resources` (`Makefile:54-70`) regenerates `data/resources.gresource.xml` from `find data/ -mindepth 2 -name '*.svg'` and runs `glib-compile-resources`.
- Translations: `potfile` (`Makefile:100-111`) runs xgettext over `src/` `.js`/`.ui`; `_buildpo` msgmerge (`:80-89`); `_compile-translations` msgfmt (`:91-98`). `po/` has about 70 locale files plus `arcmenu.pot`.
- Packaging: `_build` (`:147-167`) copies files, schemas, compiled schema, resources, locale `.mo` files; sets `commit` in `metadata.json` from git HEAD when no VERSION (`:24, 164-166`). `zip-file` (`:139-145`) zips `_build` excluding `schemas/gschemas.compiled`.
- Install: local to `~/.local/share/gnome-shell/extensions`, or system with `DESTDIR` (`Makefile:27-34, 122-134`).
- `CLEAN_UP` (`:36-45`) deletes build artifacts after install, updatepo, and zip-file.
- Metadata: `metadata.json:7-9`: `version` 74, `version-name` "70.0", `shell-version` ["45" … "51"].
- Lint: `package.json:5-6` (`lint` with `--fix`, `lint:ci` without). ESLint flat config `eslint.config.js:1-7` imports `lint/eslintrc-gjs.config.js` (`:1-312`, based on GNOME shell rules, ecmaVersion 2022, jsdoc plugin, 4-space indent, single quotes) and `lint/eslintrc-shell.config.js:1-43`.
- CI `.gitlab-ci.yml`: review stage runs `npm ci`, `npm run lint:ci`, `make install` on merge requests (`:21-37`); build stage on tags runs `make install VERSION=…`, `make zip-file`, and `gnome-extensions upload` (`:39-55`); release stage builds notes from RELEASENOTES.md (`:57-68`).
- Shell versions: metadata 45-51. Version-gated code exists for 46-51 (`src/menuButton.js:26, 724, 741, 760, 801`; `src/extension.js:40` gates on 50; `src/menuWidgets.js:246, 277, 297, 368, 375, 448, 1549, 1667, 3735, 3749`; `src/keybinder.js:90, 107`; `src/menulayouts/baseMenuLayout.js:1065`).

## 5. Legacy or deprecated, worth modernising

Verified in code (line refs given):
- Mixed class style: `_init` plus `GObject.registerClass` in most settings files (e.g. `prefsWidgets.js:117-135, 137-309, 317-434`, `themePage.js:14-16`, `menuButtonPage.js:12-13`) versus `constructor` + `super` (`prefsWidgets.js:11-36` SwitchRow, `iconChooserDialog.js:37-134`). Also `Properties`/`Signals` object literals vs `static [GObject.properties]` (`prefsWidgets.js:12-16`).
- Dead code: `DragRow` signal `change-button-clicked` is declared (`prefsWidgets.js:174`) but never emitted; its only handler (`listPinnedPage.js:261-271`) passes the wrong arguments to `AddAppsToPinnedListWindow` (`:262`, missing parent, shifted args).
- Restore defaults bugs:
  - `visualSettings.js:303-307` sets `.selected = 0` on `Adw.ExpanderRow` rows (no-op), so the `icon-size-*` settings are not reset.
  - `menuButtonPage.js:285` hard-codes `'Apps'`, `20`, and `-1` instead of reading defaults; does not reset appearance or click actions.
- Copy-paste bug: `layoutTweaksPage.js:170` uses `scrollbars-visible` as the expanded state for the avatar row (should be `show-user-avatar`).
- Typo: `generalPage.js:640` "Standlone Runner"; `themingDialog.js:109, 136` `selecetedThemesArray`.
- `settingsUtils.js:251` `e instanceof Gio.IOErrorEnum` will not match a `GLib.Error`; the fallback never runs (likely bug, not runtime-tested).
- `settingsUtils.js:110-112, 194-198`: `rgbToHex` ignores alpha (unused `a_`); `createThemePreviewPixbuf` `hasAlpha` is constant true (`:129-142` dead branch).
- Listener leak: `layoutTweaksPage.js:217` connects to `changed::pop-folders-data` and never disconnects.
- Schema doc issues: `schemas/...xml:206-212` `menu-button-border-width` summary says "border radius"; `:210-212` `menu-button-border-color` says "hover bg color"; enum nicks with spaces `'Frequent Apps'` (`:61, 66`) are inconsistent with the underscore style; `:622-628` says the resource XML is a source of truth, but it is generated.

Deprecated APIs (GTK/libadwaita; **unverified against the target shell**, based on general knowledge of GTK 4.10+):
- `Gtk.MessageDialog` (`menuButtonPage.js:34`, `settings/menuSettings/subPage.js:49`).
- `Gtk.FileChooserDialog` (`themingDialog.js:263`, `iconChooserDialog.js:259`, `aboutPage.js:398`), replaceable by `Gtk.FileDialog`.
- `Gtk.ColorButton` (`themePage.js:278`, `menuButtonPage.js:383`), replaceable by `Gtk.ColorDialogButton`.
- `Gtk.show_uri` (`aboutPage.js:390`, `donatePage.js:68`), replaceable by `Gtk.UriLauncher`.
- `Gtk.accelerator_get_default_mod_mask` (`generalPage.js:445`).
- `St.ButtonMask.ONE` (`src/menuWidgets.js:2099`).

Other legacy patterns:
- Shell-version branching for 46-51 (see §4).
- Clutter/Cogl colour fallback and its likely-broken call form (`theming.js:254-273`).
- `GLib.spawn_async_with_pipes` / `spawn_command_line_sync` for dconf (`aboutPage.js:218-250`). Could be replaced by `Gio.Subprocess` or a GVariant-based export with `Gio.Settings`.
- `GLib.file_get_contents` (`aboutPage.js:98`) could be `Gio.File.load_contents`.
- Hand-written `Gio._promisify` (`theming.js:9-10`).
- Hard-coded `resource:///…` paths in several places.
- Build: `Makefile:56-70` rewrites a tracked file (`data/resources.gresource.xml`) on every build, so it should be generated, not committed.

## Verification status
- Verified by reading: all the file:line references above.
- Not verified: stylesheet.css auto-loading by GNOME Shell; whether each `.arcmenu-*` class is used by layouts; GTK/libadwaita deprecation status on the target versions; `St.ButtonMask` status; the Cogl fallback; the themePage string-match risk; the import-theme failure on missing keys; no runtime testing was done.
- Not read in full: `src/utils.js` (`connectSettings`, `Debouncer`), `src/menuWidgets.js` beyond the lines cited, the `po/` contents, and the layout files beyond grep hits.
