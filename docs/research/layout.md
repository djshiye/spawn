# ArcMenu "arcmenu" layout: reimplementation reference

Source root: /tmp/claude-1000/-home-dino-Coding/d2878a56-801c-42b2-bf19-83145b8a82f0/scratchpad/src/ArcMenu/src/
Settings: /tmp/claude-1000/-home-dino-Coding/d2878a56-801c-42b2-bf19-83145b8a82f0/scratchpad/arcmenu-settings.ini
Schema: /tmp/claude-1000/-home-dino-Coding/d2878a56-801c-42b2-bf19-83145b8a82f0/scratchpad/src/ArcMenu/schemas/org.gnome.shell.extensions.arcmenu.gschema.xml

Abbreviations: `L/` = `menulayouts/`. Paths below are relative to the source root unless absolute. Everything marked **[unverified]** was not read in full.

---

## 0. Class hierarchy and construction

- `L/layoutHandler.js:30-69` `createMenuLayout()` maps layout ids to classes; unknown id falls back to ArcMenu (`:61`). `gnome-overview` returns null (`:31-32`).
- `L/arcmenu.js:15` `Layout extends BaseMenuLayout`; `L/baseMenuLayout.js:29` `BaseMenuLayout extends St.BoxLayout`.
- `L/arcmenu.js:20-28` passes `is_dual_panel: true`, `display_type: LIST`, `search_display_type: LIST`, spacing 0.
- `L/arcmenu.js:30-32` icon sizes for apps/shortcuts/buttons set to `SMALL` (16). Base defaults are MEDIUM (`baseMenuLayout.js:94-99`).

Base constructor (`baseMenuLayout.js:75-133`) creates shared state:
- `iconTheme`, `appSys`, `_tree = GMenu.Tree('applications.menu')` (`:104-106`).
- `searchResults = new SearchResults(this)` (`:108`) and `searchEntry = new MW.SearchEntry` (`:109`).
- `applicationsGrid` IconGrid, halign FILL in LIST (`:113-118`).
- `_pinnedAppsGrid` IconGrid, 4 columns, `accept_drop: true` (`:120-127`). Only this grid accepts drops.
- Key handling: `connect('key-press-event', _onMainBoxKeyPress)` (`:129`).
- Settings subscriptions: `search-hidden` (`:132`).

## 1. Visual structure of the arcmenu layout

Root: `mainBox` (`arcmenu.js:40-46`), horizontal. Children in order:
1. `leftBox` (applications pane) (`:48`, `:107-109`).
2. `verticalSeparator` (`:103-108`).
3. `rightBox` (shortcuts/places/power pane) (`:55`).
`enable-horizontal-flip` swaps left and right (`:106-109`).

### 1a. Left pane (`leftBox`, width `left-panel-width`, default 290 per schema)
Top to bottom:
- **Search entry**, only if `searchbar-default-bottom-location` = TOP (`:94-97`), inserted at root index 0 (`:95-97`). Top placement adds style class `arcmenu-search-top`. BOTTOM placement adds it to the bottom of `leftBox` (`:98-100`) with `arcmenu-search-bottom`.
- **Extra category links, TOP location**: inserted below the scroll box (`_createExtraCategoriesLinks` `:198-245`, `:208`).
- **applicationsScrollBox** (`:58-64`): vertical scroll, `y_align START`, fade style `small-vfade` unless `scrollview-fade-effect` is off (`baseMenuLayout.js:103`). Contains `applicationsBox` (`:67-74`) which holds whatever view is active (pinned grid, app grid, categories, search results, or the frequent-apps box inserted at index 1 by `_displayPinnedAndFrequentApps`, `:357`).
- **navigateBox** (`:76-82`), bottom-aligned (`y_align END`), contains:
  - a separator (`:84-86`),
  - **BackButton** (`:88-89`, "Back" with go-previous icon),
  - **ViewAllAppsButton** (`:91-92`, "All Apps" with view-app-grid icon).
  - Extra category links with BOTTOM location are inserted above `navigateBox`'s first child (`:210`).
- **Search entry, BOTTOM location** (`:98-100`), placed after navigateBox's container in `leftBox`.

### 1b. Right pane (`rightBox`)
Top to bottom:
1. **User avatar**: `AvatarMenuItem` plus a SHORT separator, only if `show-user-avatar` (`:111-118`, default true per schema `gschema.xml:406-409`).
2. **shortcutsScrollBox** (`:120-126`) containing `shortcutsBox`:
   - a SHORT separator (`:131-142`) drawn only if directory shortcuts exist AND (`show-external-devices` OR application shortcuts exist OR `show-bookmarks`).
   - **directory-shortcuts** (`_displayPlaces` `baseMenuLayout.js:555-564`, called at `arcmenu.js:129`).
   - **external devices/network/bookmarks** (`:144-161`). Three sections `devices`, `network`, `bookmarks` (`constants.js:167-171`), each a `PlaceMenuItem` list built by `_createPlaces` (`baseMenuLayout.js:816-841`), gated by `show-bookmarks` and `show-external-devices`.
   - **application-shortcuts** (`:163-170`). Each entry goes through `createMenuItem` (`baseMenuLayout.js:566-630`) and is shown only if `shouldShow`.
3. **Power area** (`:172-188`):
   - `power-display-style` == MENU (2): a single `LeaveButton` with label "Power Off" (`:174-175`, `menuWidgets.js:885` with showLabel true).
   - otherwise: `PowerOptionsBox` (`:177`), a horizontal ScrollView of `PowerButton`s (`menuWidgets.js:845-877`). Each button is shown per `power-options`.
   - Pinned to the bottom (`y_align END`, `:184-187`).

### 1c. Sizes
- `updateWidth` (`baseMenuLayout.js:185-190`) sets `leftBox` width to `left-panel-width` and `rightBox` width to `right-panel-width` (schema default 290 for left; right default **[unverified]**).
- Grid column math uses `menu_width` (`baseMenuLayout.js:204-233`) but the arcmenu layout uses LIST, so the grid column code is not exercised for the main grid.
- LIST mode: `halign FILL`, `_setGridColumns` gives 1 column (`baseMenuLayout.js:225-234`).

### 1d. Default view (`default-menu-view`)
- Enum values: `constants.js:47-53` PINNED_APPS 0, CATEGORIES_LIST 1, FREQUENT_APPS 2, ALL_PROGRAMS 3, PINNED_AND_FREQUENT_APPS 4.
- Schema default is `Pinned_Apps` (`gschema.xml:378-380`). The user's ini does **not** set this key (verified via grep of the ini), so the user runs the default: pinned apps view.
- `arcmenu.js:328-342` `setDefaultMenuView()` dispatches:
  - PINNED_APPS → `displayPinnedApps()` (`:281-295`). Shows ViewAll, hides Back, shows `_pinnedAppsGrid`.
  - CATEGORIES_LIST → `displayCategories()` (`:310-326`).
  - FREQUENT_APPS → `displayFrequentApps()` (`:385-414`).
  - ALL_PROGRAMS → `displayAllApps(false)` (`:297-308`).
  - PINNED_AND_FREQUENT_APPS → `_displayPinnedAndFrequentApps()` (`:351-383`). Pinned grid, then a separator and up to `arcmenu-layout-max-frequent-apps` frequent apps (default 8, `gschema.xml:650-652`; 0 means unlimited).

### 1e. Categories, all-apps, frequent, pinned, recent: where each appears
- **Categories list** (`baseMenuLayout.js:449-477`): iterates `categoryDirectories` in insertion order. Adds an ArcMenuSeparator before the first non-extra category when extra categories came first (`:465-471`). Extra categories are the `Constants.Categories` entries (`constants.js:84-90`): Favorites, Frequent Apps, All Apps, Pinned Apps, Recent Files.
- **Categories are built from GMenu**: `loadCategories` (`baseMenuLayout.js:301-356`) walks `applications.menu` root directories (skipping NoDisplay, `:312`), then `_loadCategory` (`:358-429`) adds each `.desktop` entry. Subdirectories become `SubCategoryMenuItem` when `show-category-sub-menus` is on (`:401-412`), otherwise they are flattened (`:414-416`).
- **Extra categories** (`arcmenu.js:247-279` and `:198-245`): `extra-categories` (list of (enum, bool)) creates `CategoryMenuItem`s. Items matching the current default view are skipped (`:265-270`). Shown as "quick links" in a `extraCategoriesLinksBox` (`:199-210`, location from `arcmenu-extra-categories-links-location`). Not created when default view is CATEGORIES_LIST (`:216-219`). Per-link visibility uses `arcmenu-extra-categories-links` (`:213`).
- **All Apps view**: `displayAllApps` (`baseMenuLayout.js:973-976`) displays `_sortedAppsList` (all apps sorted by display name, `:288-299`). Alphabetical grouping with a jump-list bucket dialog happens in `_displayAppList` (`:947-967`) when `group-apps-alphabetically-list-layouts` is on (default true, `gschema.xml:366-369`).
- **Frequent apps**: `Shell.AppUsage.get_most_used()` (`arcmenu.js:359`, `:392`; `baseMenuLayout.js:340`, `:873`). Filtered by `should_show()` and capped by `arcmenu-layout-max-frequent-apps`.
- **Pinned apps**: `_pinnedAppsGrid`, 4 columns, shown in `displayPinnedApps` (`baseMenuLayout.js:801-809`). Items are `PinnedAppsMenuItem` or `PinnedAppsFolderMenuItem` (`:702-738`).
- **Recent files**: `displayRecentFiles` (`baseMenuLayout.js:494-553`). Max 25 (`:25`). Adds a "More Recent Files..." item when more exist (`:505-515`). Each file's info is queried async (`:518`).

### 1f. Back and All Apps buttons (visibility by view)
- `arcmenu.js:281-289` displayPinnedApps: ViewAll shown only if default view is PINNED_APPS or PINNED_AND_FREQUENT; Back shown otherwise.
- `arcmenu.js:297-308` displayAllApps: if `showBackButton`, extra links hidden and Back shown; otherwise links per setting and Back hidden.
- `arcmenu.js:310-326` displayCategories: ViewAll hidden and Back shown when default is PINNED/FREQUENT/PINNED_AND_FREQUENT, otherwise the reverse. Extra links hidden.
- `arcmenu.js:344-349` displayCategoryAppList and `:416-421` displayRecentFiles: Back shown, ViewAll hidden.
- `:429-437` search typed: links hidden, Back shown, ViewAll hidden.
- `menuWidgets.js:1248-1264` BackButton.activate (arcmenu branch): if previous view was CATEGORIES_LIST and the current view is a category, go to `displayCategories()`; otherwise `setDefaultMenuView()`. Category type check is `<= 4 || instanceof GMenu.TreeDirectory` (`:1255-1256`). Also mouse button 8 triggers Back (`arcmenu.js:34-37`, `menuWidgets.js:278-285`).
- `menuWidgets.js:1308-1324` ViewAllAppsButton.activate: `all-apps-button-action` ALL_PROGRAMS → `displayAllApps()`. Otherwise, if default view is pinned/frequent → `displayCategories()`, else `displayAllApps()`.

### 1g. Navigation between views
- Click a CategoryMenuItem → `displayAppList()` (`menuWidgets.js:3357-3382`) → `displayCategoryAppList` or pinned/recent/home screen.
- Hover activation is only used when `activate-on-hover` is on and the layout sets `supports_category_hover_activation` (mint/brisk/budgie/whisker/zest/enterprise/gnome-menu/raven set true; arcmenu does NOT, `arcmenu.js:20-28`). So arcmenu does not use hover-to-switch categories.
- `activeCategoryType` tracks the current view (`CategoryType` enum, `constants.js:36-45`).

---

## 2. Keyboard navigation and focus

- Every `BaseMenuItem` is focusable (`menuWidgets.js:159-227`, `can_focus` default true). Focusing one sets it active and scrolls it into view (`:408-418`, `Utils.ensureActorVisibleInScrollView`). Losing focus clears active unless the item's context menu is open (`:420-427`).
- `BaseMenuItem.vfunc_key_press_event` (`:433-476`):
  - Menu key or Shift+F10 opens the context menu if `hasContextMenu` (`:440-445`).
  - Return/KP_Enter activates the item (`:466-473`). Ctrl with `keep-open-on-ctrl-click` keeps the menu open (`:453-469`).
  - Modifier keys other than Ctrl/Caps/Num propagate (`:457-464`).
- Layout key handling `_onMainBoxKeyPress` (`baseMenuLayout.js:1038-1083`):
  - Arrow keys, Tab, Shift+Tab, and the Left/Right variants: if an active menu item exists and does not have focus, it grabs focus (`:1053-1061`).
  - BackSpace: if the search entry is not focused and not empty, focuses it and deletes the last character (`:1046-1051`).
  - **Type-to-search**: on Shell >= 51 the event propagates (`:1064-1066`), and the search entry is reached through `set_input_interceptor(menuLayout)` (`menuWidgets.js:3749-3750`). On Shell < 51, unicode keys are forwarded to the search entry's clutter_text (`baseMenuLayout.js:1068-1079`).
- `SearchEntry` keys (`menuWidgets.js:3834-3871`):
  - Tab/Shift+Tab, Up, Down navigate from the top search result or active item.
  - Right (LTR) with cursor at end moves into results.
  - Return activates top result if non-empty (`:3863-3867`).
  - Context menu popup on the top result (`:3752-3760`).
- Focus on search entry highlights the top result (`:3792-3796`). Clearing text (secondary icon) resets the view (`:3725-3729`, `:3812-3816`, `setDefaultMenuView`).
- Typing into search: `_onSearchEntryChanged` (`baseMenuLayout.js:994-1036`) swaps applicationsBox to `searchResults`, sets terms, blocks hover (`:1028`), disables category hover activation (`:1031`). Empty text restores the default view (`:1004`).
- Hover is blocked until the next motion event (`vfunc_motion_event` `menuWidgets.js:399-406`; `blockHoverState` set throughout).
- **[unverified]** `search.js` (SearchResults, top result highlight) was not read.

---

## 3. Pinned apps

### 3a. Data model
- Setting `pinned-apps` (type `aa{ss}`) in the main schema. Each entry: `{id, name?, isFolder?}`. Folder entries have `isFolder: 'true'` (string) and `id` = a random UUID (`menuWidgets.js:2523-2559`).
- Folder contents: separate relocatable schema `org.gnome.shell.extensions.arcmenu.pinned-apps-folders`, path `<settings path>pinned-apps-folders/<uuid>/` (`baseMenuLayout.js:702-720`, `:709-710`). Key: `pinned-apps` (`gschema.xml:94-98`). Folder name is the `name` field of the parent entry.
- Load: `_loadPinnedApps` (`baseMenuLayout.js:740-760`) reuses existing items via `updateData`, otherwise creates them. Items with `shouldShow` false (app not installed) are skipped (`:753-756`).
- Diff-based update: `loadPinnedApps` (`:767-799`) removes missing items, adds new ones, and moves existing ones to their new index.
- Writes go back through `pinnedAppsMenuItem.connectObject('pinned-apps-changed', ...)` → `settings.set_value('pinned-apps', ...)` (`baseMenuLayout.js:726-733`).
- Item types:
  - `PinnedAppsMenuItem` (`menuWidgets.js:2378-2584`): single app, `_app = appSys.lookup_app(id)`. Non-app ids are commands (`ArcMenu_ShowAllApplications`, or raw shell commands via `Util.spawnCommandLine`, `:2566-2576`).
  - `PinnedAppsFolderMenuItem` (`:1984-2376`): folder with a 2x2 mini icon preview (`:2255-2288`) and its own FolderDialog.

### 3b. Drag and drop
- `DraggableMenuItem` (`menuWidgets.js:1642-1982`) uses `DND.makeDraggable` with a 400 ms timeout threshold (`:1665`).
- Reordering inside the pinned grid: `_onDragMotion` (`:1707-1752`). After 200 ms over a new slot, `parent.moveItem(this, index)` runs (`:1741-1747`). Edge handling in `_getDropTarget` (`:1769-1822`).
- On drag end, the grid emits `pinned-apps-changed` with the new order (`PinnedAppsMenuItem._onDragEnd` `:2503-2516`).
- Dropping an app onto another app (`PinnedAppsMenuItem.acceptDrop` `:2518-2564`): creates a new folder with a UUID, puts both apps in it, names it with `Utils.findBestFolderName(apps)` (fallback "Unnamed Folder", `:2552-2556`), and replaces the target entry with the folder entry (`:2558-2563`).
- Hover-over-folder drop: after 500 ms hover on another item, the item shrinks and shows a folder preview (`:1865-1874`, `:1893-1907`). Folder items accept drops (`PinnedAppsFolderMenuItem.acceptDrop` `:2318-2339`).
- Dragging an app out of a folder into the main grid: `IconGrid._canAccept` requires `source.folderId` and not already present (`iconGrid.js:488-505`). `acceptDrop` removes it from folder settings and appends it to `pinned-apps` (`:514-544`).
- Dragging a folder member onto its own folder is rejected (`PinnedAppsFolderMenuItem._canAccept` `:2341-2350`).

### 3c. Folders: create, rename, open, empty-removal
- Create: drop-onto-app (above).
- Open: `PinnedAppsFolderMenuItem.activate` → `FolderDialog.toggle()` (`:2362-2365`). FolderDialog is a popup anchored to the source actor (`menuWidgets.js:2878-2958`), 3-column IconGrid, sized for 3x3 (`:2945-2957`).
- Rename: inline entry + edit toggle button (`:2045-2126`). Committed on `activate` or focus out (`:2085-2092`), written via `_maybeUpdateFolderName` (`:2161-2173`) to the parent `pinned-apps` entry name.
- Empty folder: when `_folderAppList` is empty, all folder keys are reset and the parent entry is removed from `pinned-apps` (`:2190-2204`).
- Unpin folder: context menu "Unpin from Folder"/unpin path resets folder keys and removes from the main list (`appMenu.js:188-214`).

### 3d. Pin/unpin
- Pin from the app context menu: `_pinAppsAction` (`appMenu.js:216-238`) appends `{id: app_id}` to `pinned-apps`.
- Unpin: `_unpinAction` (`appMenu.js:188-214`) removes by id from `folderSettings` if the item is in a folder, else from the main list.
- Pinned status check: `_updateArcMenuPinnedItem` (`appMenu.js:355-377`). Item is hidden when `!this._menuLayout.hasPinnedApps` (`:374`). `hasPinnedApps` is set in `loadCategories` (`arcmenu.js:255-256`, `baseMenuLayout.js:349`).
- Settings changes to `pinned-apps` update the menu item live (`appMenu.js:178`).

---

## 4. App context menu (`appMenu.js`)

`AppContextMenu` (`appMenu.js:143-494`) extends GNOME Shell's `AppMenu` (`:8`). Items, top to bottom:

| Item | Where | Condition | Action |
|---|---|---|---|
| Open windows section | `_windowSection`, `_openWindowsHeader` | app has windows not `skip_taskbar` | `_updateWindowsSection` (`:379-409`). One entry per window, title, activates the window. Min count 1 (`:392`). |
| New window | base AppMenu `_newWindowItem` | base-class behavior | Connected to `closeMenus` (`:166`). **[unverified]** visibility rules in base AppMenu. |
| GPU / "Run with dGPU" | base `_onGpuMenuItem` | base-class | Connected to `closeMenus` (`:167`). **[unverified]** |
| App details | base `_detailsItem` | base-class | Connected to `closeMenus` (`:168`). **[unverified]** |
| App actions | `_actionSection` | `.desktop` `list_actions()` | `_actionSection.addAction` per action (`:311-324`). `new-window` triggers `_animateLaunch`. Then `launch_action`. |
| Quit | base | base-class `_updateQuitItem` (`:326`) | **[unverified]** |
| Favorites toggle | base `_updateFavoriteItem` (`:328`) | base-class | **[unverified]** |
| Pin to ArcMenu / Unpin from ArcMenu / Unpin from Folder | `_arcMenuPinnedItem` (`:170-171`, `:351-352`) | hidden if `!hasPinnedApps` (`:374`) | `_pinAppsAction` / `_unpinAction` |
| Create / Delete Desktop Shortcut | `_desktopShortcutItem` (`:173-174`) | visible only if a desktop-icons extension is active (`:343`) | copies `.desktop` file into XDG Desktop dir and marks trusted (`:87-99`, `:114-136`), or deletes it (`:101-112`) |
| Separator | `:176` | — | — |
| Open Folder Location | `setFolderPath` (`:411-430`) | folder/recent-file context | `launch_default_for_uri_async` on the folder |
| Additional action (e.g. "Remove from Recent") | `addAdditionalAction` (`:432-446`) | PlaceMenuItem recent file | calls action then closes |
| Unpin (for shortcut/command/folder items) | `addUnpinItem` (`:347-353`) | — | — |

Positioning: `centerBoxPointerPosition` (`:461-465`), `rightBoxPointerPosition` (`:467-474`), selected by `context-menu-location` (`menuWidgets.js:1472-1476`).

`DesktopTarget` (`appMenu.js:36-141`) watches `DESKTOP_ICONS_UUIDS` (`:19-22`: ding, gtk4-ding, zorin) and emits `desktop-changed`. Create/delete logic is at `:66-112`.

**[unverified]** `context-menu-items` (ini line 3, omitted from the view because the line was long) — its exact content and whether it drives this menu was not confirmed. Only `hasContextMenu` and `context-menu-location` are verified as read by the layout code.

---

## 5. Widgets inventory (`menuWidgets.js`)

Line numbers from `menuWidgets.js`.

| Class | Lines | Purpose and notable behavior |
|---|---|---|
| `bindPowerItemVisibility` / `activatePowerOption` | 46-118 | Maps power types to SystemActions; hides items whose `can-*` is false. Hibernate/Hybrid use `Utils.canHibernateOrSleep`. |
| `launchApp` | 125-139 | Opens new window when `activate-on-launch` is off, or Ctrl/middle-click, and app is RUNNING with `can_open_new_window`. |
| `BaseMenuItem` | 141-485 | Base for all items. Pan-scroll (`:237-260`), click (`:262-286`), long-press (`:295-309`), hover tooltip (`:387-397`), active/selected style (`:329-378`), keyboard (`:433-476`). |
| `ArcMenuSeparator` | 487-585 | Horizontal (lengths SHORT/MEDIUM/LONG/MAX/HEADER_LABEL/EMPTY) or vertical. Vertical visibility from `vert-separator`. |
| `ActivitiesMenuItem` | 587-625 | "Activities Overview" shortcut. Calls `Main.overview.show()`. |
| `Tooltip` | 627-781 | Shared stage tooltip, positioned with 5px gap and screen clamp. Gated by `show-tooltips`. |
| `ArcMenuButtonItem` | 783-843 | Button-style item (`arcmenu-button` class). Base for PowerButton and others. |
| `PowerOptionsBox` | 845-877 | Horizontal scroll of `PowerButton`s per `power-options`. |
| `LeaveButton` | 880-1037 | "Power Off" with popup (`PopupMenu`) listing Session and System groups (`:977-1002`). Either labeled (MENU style) or icon-only button. |
| `PowerButton` | 1039-1074 | Icon-only power button; activates immediately via `activatePowerOption`. |
| `PowerMenuItem` | 1076-1136 | Row item used inside the LeaveButton popup. Activating closes the ArcMenu then runs the power action (`:1131-1135`). |
| `NavigationButton`, `GoNextButton`, `GoPreviousButton` | 1138-1208 | Label + arrow used by pop-ups/other layouts. Not used by arcmenu directly except via `createLabelRow` (`baseMenuLayout.js:1206-1224`) for "Session"/"System" headers. |
| `BackButton` | 1211-1265 | See section 1f. |
| `ViewAllAppsButton` | 1268-1325 | See section 1f. |
| `ShortcutMenuItem` | 1327-1519 | Generic shortcut: app, command, or built-in (`ArcMenu_*` ids). Context menu via `popupContextMenu` (`:1470-1485`). Activation switch (`:1487-1518`): power ids → `activatePowerOption`, Overview, Run Command (`Main.openRunDialog`), Show Apps (`Main.overview._overview._controls._toggleAppsPage`), otherwise `launchApp` or `spawnCommandLine`. `plasma` only: shows description (`:1375-1391`). |
| `AvatarMenuItem` / `AvatarMenuIcon` | 1521-1640 | User avatar + real name. Click runs `gnome-control-center system users`/`user-accounts` (`:1548-1552`). Uses AccountsService `UserManager`; reads icon file, else default symbolic avatar (`:1616-1639`). |
| `DraggableMenuItem` | 1642-1982 | Drag base: reorder logic, folder preview, drop-accept logic. |
| `PinnedAppsFolderMenuItem` | 1984-2376 | Folder item: 4-app preview icon, FolderDialog, rename entry, empty-folder cleanup. |
| `PinnedAppsMenuItem` | 2378-2584 | Pinned app or command item. Icon from `pinned-apps` `icon` field, `ARCMENU_ICON` logo handled (`:2433-2434`). |
| `ApplicationMenuItem` | 2586-2783 | App row/tile. Shows "New" indicator for `recently-installed-apps` (`:2602-2607`, `:2653-2662`); removing it on hover/focus (`:2666-2667`, `:2714-2727`). Description shown when `apps-show-extra-details` (`:2628-2651`). Search result variant via `metaInfo` / `activateSearchResult` (`:2748-2770`). |
| `BaseDialog` | 2785-2876 | PopupMenu-based dialog anchored to arcmenu; dims the menu (`:2813`, `:2826`); scale-in animation 150 ms (`:2846-2872`). |
| `FolderDialog` | 2878-2958 | 3-col IconGrid with `populateMenu`. |
| `BucketJumpListDialog` | 2960-3068 | Alphabet bucket grid for All Apps (`:2960-3038`); clicking a letter scrolls to that group (`:3040-3067`). |
| `SubCategoryMenuItem` | 3070-3235 | Submenu category (only when `show-category-sub-menus`). Icon composed from four app icons. `isExtraCategory` compares `entry.CATEGORY` (`:3202-3208`), which does not exist on `Constants.Categories` entries (they use `id`, `constants.js:84-90`). **Likely bug** **[unverified at runtime]**. |
| `CategoryMenuItem` | 3237-3495 | Category row. Hover activation (`:3399-3443`) uses a triangle "intent" test (`:3445-3486`). Recently-installed indicator (`:3264-3272`, `:3346-3355`). `displayAppList` (`:3357-3382`). |
| `PlaceMenuItem` | 3498-3679 | Directory/device/network/recent item. Eject/unmount button for removable (`:3539-3554`). Recent-file variant with folder path and "Remove from Recent" (`:3604-3615`). |
| `SearchEntry` | 3681-3887 | St.Entry with search icon, clear icon, key navigation (see section 2). |
| `WorldClocksWidget`, `WeatherWidget` | 3889-3978 | GNOME date-menu widgets reused via subclassing (`GDateMenu` at `:31-33`). Clicking closes the ArcMenu and opens the Clocks or Weather app. |

Also in `iconGrid.js`:
- `IconGridLayout` (`:43-456`): custom Clutter LayoutManager. Columns, spacing, centered grid (`_calculateSpacing` `:105-127`), animated reflow (`animateIconPosition` `:26-41`), drop target computation (`getDropTarget` `:356-439`).
- `IconGrid` (`:458-621`): St.Widget wrapper. Only the pinned grid has `accept_drop` (`:481-485`).

---

## 6. Performance notes

- **Eager build on menu construction.** `arcmenu.js:190-195` runs `updateWidth`, `loadCategories`, `loadPinnedApps`, `setDefaultMenuView`, `_connectAppChangedEvents` during construction. `loadCategories` walks the entire GMenu tree and creates an `ApplicationMenuItem` for every visible app (`baseMenuLayout.js:386-391`), plus `CategoryMenuItem`s and possibly `SubCategoryMenuItem`s. Cost scales with installed apps.
- **Shell.AppUsage** is queried twice per load: once in `loadCategories` for FREQUENT_APPS (`baseMenuLayout.js:340`) and again in `populateFrequentAppsList` on each category open (`:873`). `displayFrequentApps` also queries (`arcmenu.js:392`).
- **Sorting.** `_createSortedAppsList` sorts all apps each load (`baseMenuLayout.js:288-299`). Category lists are sorted again in `_loadCategory` (`:422-426`) using `getAppDisplayName`, which may be expensive **[unverified]** (`utils.js` not read).
- **Re-render triggers** (all call `_reloadApplications`, `baseMenuLayout.js:252-286`, which destroys and rebuilds everything):
  - GMenu tree `changed` (`:136`).
  - `changed::recently-installed-apps` (`:137`).
  - Shell AppFavorites `changed` only refreshes the Favorites category (`:138-144`).
  - `arcmenu-layout-max-frequent-apps` changes call only `setDefaultMenuView` (`arcmenu.js:195`).
  - While the menu is open, reloads are queued until `menu-closed` (`:254-267`).
- **Per-item settings signals.** Every ApplicationMenuItem, ShortcutMenuItem, PlaceMenuItem, etc. connects `ArcMenuManager.settings.connectObject('changed::icon-size-...')` in its constructor (e.g. `menuWidgets.js:2671`, `:1416`, `:3568`). Hundreds of handlers exist on a large app list; each is cleaned up in destroy via `connectObject(..., this)`.
- **Icons.** `ApplicationMenuItem.createIcon` calls `create_icon_texture` every time `_updateIcon` runs (`menuWidgets.js:2683-2712`). ShortcutMenuItem recreates icons on each size change.
- **Per-activation work.** `removeIndicator` calls `setNewAppIndicator`, which loops all categories and all their items (`menuWidgets.js:2714-2727`; `baseMenuLayout.js:431-447`). Runs on hover/focus of any new-app item.
- **Recent files.** Up to 25 async `query_info_async` calls per open (`baseMenuLayout.js:517-552`). Cancelled on clear (`recentFilesManager.js:83-94`). Bookmark file is re-read on each `getRecentFiles` call (`recentFilesManager.js:17-30`).
- **Places.** `PlacesManager` (`placeDisplay.js:262+`) creates a `Gio.VolumeMonitor` listener set and watches `bookmarks.xbel`. It re-creates all device/network items on any mount/volume event (`:372-` `_updateMounts`). Places sections are destroyed and rebuilt per event (`baseMenuLayout.js:811-814`).
- **Monkey-patch.** `WorldClocksWidget` temporarily overrides `appSystem.connect` to capture a handler id (`menuWidgets.js:3896-3908`). Fragile across GNOME versions.
- **Global tooltip.** One `Tooltip` per menu button (`menuWidgets.js:627-781`), reused.
- **Grid reflow.** `IconGridLayout.vfunc_allocate` animates children when `_shouldEaseItems` (`iconGrid.js:219-286`). `_getChildrenMaxSize` is cached and reset on child `queue-relayout` (`:87-103`, `:192-198`).

---

## 7. Settings keys read, by part

**arcmenu.js (layout)**
- `searchbar-default-bottom-location` (`:94`)
- `enable-horizontal-flip` (`:106`, also `menuWidgets.js:3470`)
- `show-user-avatar` (`:111`)
- `directory-shortcuts` (`:131`)
- `application-shortcuts` (`:132`, `:163`)
- `show-external-devices` (`:136`, `:831`)
- `show-bookmarks` (`:137`, `baseMenuLayout.js:825`)
- `power-display-style` (`:173`)
- `arcmenu-layout-max-frequent-apps` (`:195`, `:366`, `:395`)
- `arcmenu-extra-categories-links-location` (`:206`)
- `arcmenu-extra-categories-links` (`:213`)
- `default-menu-view` (`:214`, `:254`, `:282`, `:311`, `:331`)
- `extra-categories` (`:253`)
- `left-panel-width`, `right-panel-width` (`baseMenuLayout.js:187-188`)
- `scrollview-fade-effect` (`baseMenuLayout.js:103`)

**baseMenuLayout.js**
- `show-recently-installed-apps` (`:359`, `:432`, `:602`)
- `show-category-sub-menus` (`:401`)
- `group-apps-alphabetically-list-layouts` / `-grid-layouts` (`:914-915`)
- `search-hidden` (`:132`, `:990`)
- `activate-on-hover` (`:1182`)
- `enable-horizontal-flip` (n/a here)
- `pinned-apps` (`:743`, `:732`)
- `recently-installed-apps` (`menuWidgets.js:2604`)
- `directory-shortcuts`, `application-shortcuts` (`:556`, `:819`)
- `show-bookmarks`, `show-external-devices` (`:825`, `:831`)
- `icon-size-*` (`:215` icon-size-grid and others)

**menuWidgets.js**
- `activate-on-launch` (`:126`)
- `keep-open-on-ctrl-click` (`:159`, `:268`, `:454`)
- `show-tooltips` (`:649`)
- `vert-separator` (`:583`)
- `icon-size-shortcuts`, `icon-size-buttons`, `icon-size-misc`, `icon-size-apps`, `icon-size-categories`, `icon-size-grid`, `icon-style-*` (widgets, see per-class)
- `power-options` (`:865`, `:985`)
- `avatar-style` (`:1562`)
- `apps-show-extra-details` (`:1373`, `:2394`, `:2628`)
- `show-search-result-details` (`:2626`)
- `all-apps-button-action` (`:1309`)
- `default-menu-view` (`:1316`)
- `menu-layout` (`:1249`, `:1374`)
- `context-menu-location` is a layout property, not a setting key, set by the menu button (`menuWidgets.js:1473`)

**appMenu.js**: `pinned-apps` (`:178`, `:220`, `:231`, `:362`). No other settings.

**placeDisplay.js**: `org.gnome.desktop.background` `show-desktop-icons` (`:273-275`, `:345`).

**recentFilesManager.js**: `show-hidden-recent-files` (`:62`).

**Schema defaults used**: `default-menu-view` `Pinned_Apps` (`gschema.xml:378-380`); `arcmenu-layout-max-frequent-apps` 8 (`:650-652`); `search-hidden` false (`:318-321`); `group-apps-alphabetically-list-layouts` true (`:366-369`); `show-user-avatar` true (`:406-409`); `left-panel-width` 290 (`:490-493`); `all-apps-button-action` `Categories_List` (`:426-429`); `power-options` default (`:506-508`).

**User ini values relevant to the arcmenu layout** (`arcmenu-settings.ini`)
- `menu-layout='arcmenu'` (line 31).
- `application-shortcuts` (line 2): Software (`ArcMenu_Software`), a Separator, `org.gnome.Ptyxis.desktop`, `org.gnome.Nautilus.desktop`, `org.gnome.Settings.desktop`.
- `directory-shortcuts` (line 4): Home only.
- `pinned-apps` (line 34): steam, Claude, husk, plus three folders (Internet, Games, Tarky). Folder contents on lines 41-48 (Internet: slack, Zoom, code, obsidian; Games: eden, heroic, bottles, prismlauncher, Discord; Tarky: SPT Server, SPT Launcher).
- `power-options` (line 35): LOGOUT hidden, LOCK, RESTART, POWER_OFF shown; SUSPEND, HYBRID_SLEEP, HIBERNATE, SWITCH_USER hidden.
- `default-menu-view`: not set, so schema default Pinned_Apps applies.
- `context-menu-items`: appears at line 3 but the line was omitted from output. **[unverified]**.
- `recently-installed-apps` (line 37): 12 desktop ids, which drive "New" indicators.

---

## 8. Other layouts (one-line, skimmed from display type and panel flags)

Based on `grep` of each file's `super(menuButton, {...})` block, not full reads.
- `az.js`: grid, modern, single panel, default view A-Z style; uses `MenuView` enum. Settings: `default-menu-view-az`.
- `brisk.js`: dual-panel list with category hover activation (traditional).
- `budgie.js`: dual-panel list with hover activation (traditional).
- `chromebook.js`: touch-style grid.
- `elementary.js`: touch-style single-panel grid.
- `eleven.js` ("11"): grid, modern.
- `enterprise.js`: dual-panel grid with hover activation (modern).
- `gnomemenu.js` ("gnome-menu"): dual-panel list (traditional GNOME menu).
- `insider.js`: grid with pinned-apps button (modern).
- `mint.js`: dual-panel list with hover activation, pinned icons on left (traditional).
- `plasma.js`: single-panel list with custom PlasmaMenuItem and category headers (modern).
- `pop.js`: grid with folder items; uses its own folder model rather than GMenu (modern).
- `raven.js`: grid with hover activation (alternative).
- `redmond.js`: grid, uses `default-menu-view-redmond`, modern.
- `runner.js`: list, launcher-style standalone runner; `MenuView` enum; `default-menu-view-runner`.
- `sleek.js`: grid list hybrid (modern).
- `tognee.js`: single-panel list, categories vs all-programs toggle; `default-menu-view-tognee`.
- `unity.js`: grid with categories button (modern).
- `whisker.js`: dual-panel list with hover activation (traditional).
- `windows.js`: list with extras button; `windows-show-pinned-apps` setting.
- `zest.js`: dual-panel list with hover activation (modern).
- `gnome-overview`: no menu (returns null, `layoutHandler.js:31-32`).

---

## 9. Not read / open items

- `menuController.js`, `menuButton.js`, `arcmenuManager.js`, `utils.js` (getAppDisplayName, getIconSize, ensureActorVisibleInScrollView, createPanActionScrollView, findBestFolderName, findSoftwareManager) were not read. Behavior described from call sites only.
- `search.js`, `searchProviders/*` not read. Search result activation is only partially described.
- GNOME `AppMenu` base class behavior (items Quit, favorites toggle, GPU, details) is not in the scratchpad. Items are described only as wired in `appMenu.js`.
- `context-menu-items` in the ini: not verified.
- `right-panel-width` default: not verified.
