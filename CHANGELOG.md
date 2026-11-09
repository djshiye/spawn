# Changelog

All notable changes to Spawn are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
