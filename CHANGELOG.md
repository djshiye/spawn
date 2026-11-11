# Changelog

All notable changes to Spawn are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Right click on a Dash to Panel app icon while the menu is open:** one right click now closes Spawn and opens that
  icon's own context menu, instead of only closing the menu. Over a fullscreen game the panel stays until that menu
  is closed.
- **Touchscreen taps on panel icons while the menu is open:** a tap on a tray icon, the clock, quick settings or an
  app icon now closes Spawn and does what a tap on it does, in one tap, like a left click.
- **Hover look after Escape:** closing the menu with Escape (or a click elsewhere) while the pointer rests on a panel
  icon no longer takes the icon's hover highlight away until the mouse moves.

## [1.2.2] - 2026-11-10

### Fixed

- **Calendar no longer pops up in the corner over games:** over a fullscreen game, moving from one tray icon's menu
  to the clock (or another icon) opened that menu without its panel, so the calendar floated at the top-left
  corner. The panel now stays for as long as any of its menus is open.
- **Switching between tray icons over games:** with one tray icon's menu open, a click or right click on another
  icon now opens that icon's menu straight away instead of closing everything.
- **Hover effects while the menu is open:** panel and tray icons now light up under the pointer while Spawn is open,
  including the hover animations from your theme.

## [1.2.1] - 2026-11-10

### Fixed

- **Tray icons work while the menu is open:** one left, middle or right click on a tray icon (Steam, Slack,
  Discord and other app indicators, including older-style tray icons) closes the menu and does what that click
  normally does: opens the icon's menu or brings up the app. A right click on the clock or the system status icons
  opens their menu too. Over a fullscreen game the panel now stays visible while that icon's menu is open, and
  hides again when it closes.

## [1.2.0] - 2026-11-10

Fixes from four reviews of 1.1.5: logic, user experience, visuals and performance.

### Security

- **Test hooks are no longer shipped:** the developer test hooks (which can type keys, click and take screenshots)
  are now left out of the released package entirely, and the setting that switched them on is gone from it. A
  release check fails the build if any of them ever comes back.

### Added

- **Undo for more actions:** Pin, Unpin, Remove from Folder and removing a shortcut now show the same Undo banner as
  deleting a folder or hiding an app, and Ctrl+Z works for them too. Undo puts the app back in its exact place.
- **New folders ask for a name:** Add to Folder, New Folder opens the folder with its name ready to type.
- **Empty pinned view:** with nothing pinned, the menu explains how to pin an app and offers a button to All Apps.
- **Shortcut and user card menus:** right-click (or the Menu key) on a right-pane shortcut offers Open, New Window,
  Remove from Menu and Edit Shortcuts…; the user card offers Menu Settings.
- **More keys:** Home, End, Page Up and Page Down in every list and grid, F2 renames a folder, Delete unpins an app.
- **Keyboard shortcuts list** on the About page of the settings window.
- **Update notice:** after a package update, Spawn says once that you need to log out and back in to finish it, in a
  notification and in the settings window. (This starts with the next update after 1.2.0.)

### Changed

- **Search keys:** typing stays in the search box and the arrow keys move one highlight through the results. With the
  search bar at the bottom, the best match now sits right above it. Ctrl+Return opens the highlighted app in a new
  window, as Ctrl+click does.
- **One highlight at a time:** the mouse and the keyboard share a single highlight in every list.
- **Left and Right between panes** land on the item at the same height, and Tab follows reading order.
- **All Apps is much faster and lighter:** it opens in about 75 ms instead of 300 ms and uses about a seventh of the
  memory, because rows are built as they scroll into view.
- **Instant app results:** app search results appear on every key press instead of after a short pause.
- **Visual polish:** right-click menus use the theme's shadow, tooltips appear only for cut-off names and no longer
  cover the next row, the folder dimming reaches the menu edge, the folder card takes the menu's own colour, the
  search box has a visible edge and the default avatar is visible in light themes, grid tiles have even gaps, and
  Restart and Power Off show a red focus ring.
- **Settings window:** a small revert icon replaces the "Reset" buttons and only appears when a group has changed,
  list icons have consistent sizes, the Add Application dialog fits cleanly and the icon picker shows friendly names.

### Fixed

- **Keys stopped working on a row after its right-click menu** was used (GNOME 51).
- **The clock, quick settings and other panel buttons** needed two clicks while the menu was open; one click now
  works, on every panel and monitor.
- **Super over the calendar or quick settings** opened the menu on top of it; the other menu now closes first.
- **One damaged pinned entry or shortcut** no longer breaks the whole list, and extreme icon or button sizes set by
  hand are clamped.
- **Removing the last app from a folder** keeps it in the folder's place instead of moving it to the end.
- **"Hidden" banner on a pinned app** now says it is hidden from All Apps and still pinned.
- **Bookmarks and recent files** are checked in the background, so a hung network share can no longer freeze the
  desktop, and recent files are not re-read every time the menu opens.

## [1.1.5] - 2026-11-09

### Fixed

- **A closed folder no longer stays selected:** closing a folder popup with a click (the close button, or anywhere
  outside the card) used to leave a focus ring on the folder and take the focus away from the search box. The
  search box now has the focus again, as it does when the menu opens. Closing with Escape still puts the keyboard
  back on the folder, so keyboard users carry on where they were.

## [1.1.4] - 2026-11-09

### Fixed

- **Panel apps work in one click while the menu is open:** clicking a pinned app in Dash to Panel (or any other app
  button in the menu's panel) while the menu is open now closes the menu and launches the app in the same click.
  Before, the first click only closed the menu, and over a fullscreen game the panel hid again straight away, so the
  app could not be clicked at all. Right clicks and clicks on the Spawn button itself still just close the menu.

## [1.1.3] - 2026-11-09

### Fixed

- **Menu over fullscreen games:** pressing Super (or the menu shortcut) while a game or other app is fullscreen now
  brings back the panel the menu belongs to, the top bar or Dash to Panel, and opens the menu attached to it, the way
  GNOME's own Overview shows the panel over a fullscreen window. The panel hides again as soon as the menu closes.
  Before, the menu floated on its own at the top-left corner over the game, with no panel.

### Changed

- **Folder popup stays connected to its folder:** while a folder is open, the folder you clicked stays lit above the
  dimmed menu, like the item of an open submenu, so it is always clear which folder the card belongs to.

## [1.1.2] - 2026-11-09

### Fixed

- **Folder popup highlight:** only the app you point at, or the one you reach with the arrow keys, is highlighted,
  never both. Opening a folder with a click no longer puts a ring on the first app; pointing at an app takes the ring
  off the others, and the arrow keys carry on from the app under the pointer. Opening a folder with the keyboard
  still starts on the first app.

### Changed

- **Compact folder popup:** smaller, fixed-size tiles and icons (40 px, 48 px with Large items), a slimmer header with
  a body-size title and a smaller close button, tighter padding and rounder 16 px corners, in line with GNOME's own
  popovers.
- **Folder popup in the list view** now opens beside its folder row, like a submenu, with its title level with the
  row, instead of below the row reaching down towards the search bar. In the grid view it still opens below the folder.

- **Shorter package name:** the RPM is now called `spawn` instead of `gnome-shell-extension-spawn`, so it is
  `sudo dnf install spawn` and `sudo dnf remove spawn`. Existing installs switch over by themselves on the next
  `sudo dnf upgrade`, with settings and pinned apps kept, and the old name still works for `dnf install`.

## [1.1.1] - 2026-11-08

### Fixed

- **Folder popup:** an open pinned folder now opens right next to the folder you clicked (below it, or above it when
  there is no room) instead of in the middle of the menu, and it grows out of that folder. The card is always solid,
  so the rows behind it no longer show through when custom menu colours are see-through, and it has a clear edge. It
  is roomier: more padding on an 8 px spacing scale, wider tiles so names like "Zoom Workplace" fit, a round close
  button and a quieter rename pencil that brightens on hover.
- **Wrap long app names** ("multi-lined-labels") now really wraps a long name onto a second line in grid tiles and the
  folder popup; before, some names got an ellipsis after one line.

## [1.1.0] - 2026-11-08

### Added

- **Hide from Menu** in an app's right-click menu. Hidden apps leave All Apps, the categories and Frequent (pinned
  apps stay pinned), an Undo banner appears, and Preferences → Menu → Hidden apps lists them to restore. Search still
  finds hidden apps unless "Find hidden apps in search" is turned off.
- **"New" badges** on apps installed since Spawn last looked: a small pill on rows, tiles and search results, and a dot
  on the categories that contain one. It clears after the first launch or three days. "Mark new apps" turns it off;
  the ArcMenu import carries ArcMenu's setting over.
- **Accessibility:** every button, row and tile in the menu and runner has a screen reader name and role; the result
  count is announced ("5 results", "No results"); keyboard focus shows a clear accent ring in every theme; and GNOME's
  "Reduce animation" setting turns off Spawn's animations.
- Continuous integration on GitHub Actions: typecheck, lint, unit tests, `npm audit` and the GNOME Shell 49 / 50
  compatibility typechecks on every pull request; the headless GNOME Shell 51 `smoke` and `lifecycle` scenarios on
  pull requests to `main`. Actions are pinned by commit SHA and Dependabot keeps them and the npm dependencies current.
- `SECURITY.md` (private vulnerability reporting) and this changelog.
- Package signing in `tools/publish.sh`: every RPM and `repomd.xml` is signed with a key kept on the maintainer's
  machine and verified before publishing; `tools/make-signing-key.sh` creates the key. Packages are signed from 1.1.0 on
  (key fingerprint `D49A308168257FDBF9D5AE14BD1AC1C6F56A7252`).

### Changed

- `npm test` skips the preferences test with a visible notice when the GTK 4 / libadwaita typelibs are missing, and
  fails instead when `SPAWN_REQUIRE_ALL_TESTS=1` is set.

## [1.0.0] - 2026-11-06

First release: a fast, resilient application menu for GNOME Shell and a ground-up replacement for ArcMenu.

### Added

- The menu: pinned apps (list or grid) with folders, All Apps, Frequent, Recent Files, category quick links, places,
  devices and bookmarks, and a power bar; keyboard navigation, drag and drop, and Ctrl+arrow reordering.
- Search with typo tolerance, initials matching and usage-aware ranking, plus a standalone runner with its own hotkey
  and a `ToggleRunner` D-Bus method.
- Dash to Panel support that survives panel restarts, including holding an intellihide panel revealed while the menu
  is open.
- A panel-button context menu, theme presets, menu placement and icon-size settings, and an icon picker.
- Preferences, with one-click import of ArcMenu settings.
- Support for GNOME Shell 49, 50 and 51.
- Fedora RPM and a DNF repository on GitHub Pages, with a one-line install.
- A headless GNOME Shell test harness, a benchmark, unit tests, and container runs against GNOME Shell 49, 50 and 51.

### Changed

- Rebranded from Spawn Menu to Spawn.
- Faster search (about eight times) and a faster first open and shell start-up.
- UK spelling throughout the interface.

### Fixed

- Many menu and preferences layout and hit-area issues found in UI/UX audits, including the power buttons overflowing
  the right pane and rows that did not highlight across their full width.
- Correctness bugs found in code reviews, such as stale search results, settings that stuck after Reset or Undo, and
  critical messages in the shell log.

[Unreleased]: https://github.com/djshiye/spawn/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/djshiye/spawn/releases/tag/v1.0.0
