# Changelog

All notable changes to Spawn are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] - 2026-11-28

### Added

- **High contrast outlines:** with GNOME's High Contrast turned on, the menu now draws clear outlines around tiles,
  buttons and fields. Turning High Contrast on or off while the menu is open takes effect straight away, including
  the dimmed look of apps that are no longer installed.
- **Right-to-left languages:** in Arabic, Hebrew and other right-to-left languages, the arrow keys, Ctrl+arrow
  reordering and drag and drop now move apps the way the mirrored menu looks. The pinned grid has an even margin on
  both sides.
- **Settings backup check:** restoring a backup now lists any commands it would add to the menu, so a file from
  someone else cannot quietly add an entry that runs a command when clicked.

### Changed

- **Bare addresses in search:** typing an address such as `224.0.0.0` or `240.0.0.0` now describes the address
  instead of treating it as a subnet mask. Type `mask 240.0.0.0` for the mask answer.
- **`%` in front of a minus sign:** `10 % -3` is now read as a percentage and gives -2.9, in line with `200 + 10% + 5`
  below. Type `10 mod -3` for the remainder.
- **Settings backups:** a restore now tells you more clearly what it left out. It names the folders (for example
  "Games") instead of showing internal ids, and a damaged backup no longer leaves an empty folder behind.
- **Install command:** the one in the README no longer answers dnf's questions for you, so you can check the signing
  key's fingerprint before accepting it.
- **Fedora upgrades:** Spawn no longer blocks them. If the Spawn repository is unreachable, or has no packages yet
  for a newer Fedora release, dnf now skips it with a warning instead of refusing to run. To get this, run the
  install line from the README once more.
- **ArcMenu import:** panel button and icon sizes outside Spawn's range are now brought into range, instead of being
  dropped.
- For developers: a release now stops if CI has not passed, if the local copy has changes that are not on GitHub,
  or if the packages do not hold exactly the files that were built.
- For developers: more checks run in CI, and the shell scenarios and Settings tests are stricter and more reliable.

### Fixed

- **Search answers:**
  - Large whole numbers are exact: `2^40` gives 1 099 511 627 776 and `1 GiB in B` gives 1 073 741 824 B, instead of
    a rounded number ending in made-up zeros.
  - Percentages work in the middle of a sum: `200 + 10% + 5` gives 225 and `10% * 50` gives 5. Before, you got 200 or
    no answer.
  - A date such as `2026-12-25` or `25/12/2026` shows the date first, instead of a meaningless sum that Return would
    copy.
  - A function written without brackets takes the whole of a value like `2pi`, so `sin 2pi` gives 0.
  - `kN` now means the kilonewton in unit conversions (`5 kN in lbf`). Lower-case `kn` still means knots.
  - `days since 31 jan` near a month end now includes the days, for example "1 month 2 days" instead of "1 month".
  - Colours given as percentages, such as `rgb(100%, 50%, 0%)`, now give `#FF8000`, as browsers do.
  - Colour answers show the name the way you typed it, and use "grey" rather than "gray".
  - IPv4-mapped IPv6 addresses such as `::ffff:192.0.2.1` show the IPv4 part in its usual dotted form.
  - `~` works in every word of a command typed in the runner, so `mkdir ~/Projects` makes the folder in your home
    folder instead of a stray folder called `~`.
- **Keyboard in the menu:**
  - Tab and Shift+Tab into the All Apps category column return to the category you had chosen, instead of jumping
    back to All Apps.
  - Pressing Down on the last row of the pinned grid goes to the first Frequent app or quick link below it, and in
    the Grid layout to the footer button under the focus, instead of skipping ahead.
  - Tab in a folder opened with the mouse goes to its first app, not to Rename.
  - Going back to the top of a long pinned list shows the "Pinned" title again, instead of leaving the first row
    half faded.
  - After undoing an Unpin, the keyboard goes back to the restored entry for pinned commands, apps that are not
    installed and apps marked New (and to the folder after undoing Remove from Folder), instead of the first tile.
- **Classic All Apps list:**
  - Launching a new app with Ctrl held (menu kept open) no longer sends the list back to the top or moves the
    keyboard focus to the search box.
  - The category column grows to fit its longest name.
  - Screen readers say "contains new apps" for a category with a new app, as they already did in the Grid layout's
    category menu.
- **Pinned apps and folders:**
  - Pinned apps and commands show a new name or icon straight away after an app update or an edit in Settings.
    Before, they kept the old one until the next login. Pinning the same command twice no longer breaks its tile.
  - Undoing a drop that made a new folder no longer leaves that folder's settings behind, and an app added to the
    new folder while Undo is still offered is now kept.
  - Restoring a backup whose pinned apps list an app or a folder more than once no longer leaves duplicates behind,
    so moving an app out of a folder, unpinning it or deleting the folder works as expected.
  - The runner lists a pinned app as soon as it is installed. Before, the app could stay missing until the menu had
    been opened.
- **Look of the menu:**
  - Long app names wrap onto two lines at normal screen scale.
  - The Grid footer's power buttons resize straight away when you turn buttons on or off or change the style.
  - The stand-in user picture, shown when you have not chosen one, is no longer tiny in the Grid footer.
  - The "Jump to letter" tip in the Grid layout no longer covers the first app under the letter.
  - "More Recent Files" uses the proper ellipsis character.
  - The button beside a removable drive now says what a click does: "Eject" when the drive will be ejected, "Unmount"
    otherwise. Before, it could say "Unmount" and then eject the drive.
- **Settings:**
  - In the Set Shortcut dialog, the keyboard can now confirm a shortcut.
  - Undo in lists puts back only the item you removed.
  - The number boxes for results per source, panel button icon size and padding, and icon sizes allow the full range
    the menu supports, so a value brought over from ArcMenu or a backup is shown correctly. Restoring a backup while
    Settings is open no longer cuts corner radius, border width or tile sizes down to the box's limit.
- **Update notice:** if Spawn is updated while the screen is locked (or while Spawn is switched off), the "log out
  and back in" notice now appears when you unlock, instead of not at all.
- **Panel button:**
  - When Dash to Panel or App Icons Taskbar is running but gives Spawn no panel to use, the menu button still moves
    to the top bar after ten seconds, but Spawn no longer writes a warning to the system log every two seconds.
  - With Dash to Panel's intellihide, closing the menu while the mouse is still on the panel no longer keeps the
    shell waking up ten times a second until the mouse moves away.
  - No more error lines in the system log when the panel is rebuilt or the session ends while the menu is open.
  - A panel button icon on a network share that stops answering can no longer freeze the desktop. The icon file is
    checked in the background, and the button shows the standard icon if the check fails or takes too long.

## [1.6.0] - 2026-11-25

### Added

All of this works offline: nothing you type leaves the computer. Return or a click copies the result. The full list
is in [docs/SEARCH.md](docs/SEARCH.md), and each group has a switch under Settings > Menu > Search sources.

- **Harder maths in search:** trigonometry in radians or degrees (`sin(30°)`), logarithms, roots (`√16`,
  `root(27, 3)`), factorials (`5!`), combinations, `min` / `max` / `avg`, hex and binary numbers (`0xFF + 1`), bit
  operations (`1 << 10`), multiplication without the sign (`2pi`) and plain words (`what is 15% of 80?`,
  `20% off 80`). Long answers are easier to read, with spaces between the thousands.
- **Many more unit conversions:** area, pressure, energy, power, force, torque, angle, frequency, data rate
  (`100 mbps in mb/s`) and fuel economy (`30 mpg in l/100km`), plus more units of length, mass, volume and time.
  Mixed amounts work (`5 ft 10 in in cm`), as does `how many feet in a mile`.
- **Time zones:** `time in tokyo`, `3pm london in tokyo`, `9am pst in cet`.
- **Dates:** `days until 25 dec`, `today + 90 days`, `week number`, `what day is 1 jan 2030`, `unix time`.
- **Number bases and colours:** `0xFF`, `255 in binary`; `#3584e4` shows the colour with its RGB and HSL values.
- **Network helpers:** `192.168.1.130/26` shows the network, host range, mask, broadcast and host count;
  `192.168.1.0/24 into /26` lists the subnets; IPv6 and MAC addresses work too. `my ip`, `gateway`, `dns` and
  `mac address` show this computer's own details, with no internet lookup.
- **Emoji and characters:** `emoji smile`, `char arrow right`, `symbol pi`, then Return to copy.
- **Quick text tools:** `password 24`, `uuid`, `sha256 text`, `base64 text`, `random 1-100`, `roll 2d6`.
- **Quick settings:** `dark mode`, `night light`, `do not disturb`, `wifi off`, `bluetooth on`, `aeroplane mode`.

### Fixed

- **Stopping a screen recording over a game:** with the menu open (also over a fullscreen game, after Super), one
  click on GNOME's screen recording stop button in the panel now stops the recording, instead of only closing the
  menu and sending you back to the game. The same goes for the screen sharing stop button and any other panel
  indicator without a menu.

### Changed

- **New README:** a Spawn logo, one picture of both layouts that follows GitHub's light or dark style, and a
  "Search that answers" section that lists what you can type, from sums and conversions to time zones and
  quick settings.

## [1.5.2] - 2026-11-17

### Changed

- **Faster everywhere.** A full optimisation pass, measured in a GNOME Shell 51 test session with about 330 apps:
  - **Typing in search:** results appear about 40% sooner (18.6 ms to 11.2 ms per key). Rows that stay in the
    results are now updated instead of rebuilt.
  - **Recent files in search:** their rows show up about three times sooner (115 ms to 35 ms per key). They no longer
    wait for you to pause typing, and the file list is read in the background instead of on a keystroke.
  - **Matching itself** is 10 to 45% quicker, with exactly the same results.
  - **Categories in All apps** switch faster, going back to All apps is close to instant, and the list updates
    sooner after you install an app.
  - **Opening the menu** skips rebuilding the Frequent list, the runner list and folders when nothing in them changed.
  - **Less work in the background:** plugging in drives no longer rebuilds the side bar unless something you can
    see changed, and settings are read once instead of on every row.
  - **Settings window:** "Add Application" opens straight away, even with hundreds of apps, and backups are read and
    written without freezing the window.

### Fixed

- **A slow network folder can no longer freeze the desktop** while you type its path into the runner (with
  "Run commands" on): the check now runs in the background with a time limit.

## [1.5.1] - 2026-11-16

### Fixed

- **Right click over a fullscreen game:** with the menu open over a game, a right click on the Spawn button now opens
  its own menu (Settings, Power Options and so on) instead of dropping you back into the game. Right-click menus on
  the taskbar (Dash to Panel app icons) and inside Spawn also stay open now when the game grabs the focus back for a
  moment, which closed them along with the panel before.

## [1.5.0] - 2026-11-12

### Added

- **All apps in the Grid layout is now a grid of icons**, A to Z, with a small letter above each group. Click a
  letter to jump straight to another one. The "All apps" title opens a list of categories (Games, Graphics,
  Internet and so on) to see just those apps.
- **Power actions in search:** type `lock`, `log out`, `suspend`, `restart` or `power off` and press Return. You get
  the same confirmation as the power buttons. Off by default: turn it on under Settings > Search sources.
- **Run a command from the runner:** with "Run commands" on (runner settings, off by default), type a command such as
  `gnome-text-editor notes.txt` and the last row runs it, like the Alt+F2 dialog. Nothing is passed through a shell.

### Changed

- **One best match in search:** the strongest result now goes to the top, whatever kind it is. `display` finds the
  Displays settings panel first, not an app that only mentions "display" somewhere.
- The README is shorter, with screenshots. Build and test notes moved to `docs/DEVELOPING.md`.

### Fixed

- **Grid layout, drag to pin:** drag an app from All apps onto the "Pinned" button to pin it, or hold it there for
  half a second to jump into your pinned apps and drop it exactly where you want.
- **Grid layout, folders on another page:** opening a folder that is not on the page you are looking at (for
  example right after "New Folder") turns to its page first, instead of drawing it outside the menu.
- **Grid layout, Page Up and Page Down** now turn pages straight away, while the cursor is still in the search box.
- **Grid layout, dragging between pages:** hold a dragged app at the top or bottom edge of the grid, or over a page
  dot, to turn a whole page. The dots stay visible, and the app always lands on a page, not between two.

## [1.4.0] - 2026-11-11

### Added

- **Grid layout:** a new choice under Settings > Menu > Menu layout. **Classic** stays the default and is unchanged.
  **Grid** is one tidy column: the search bar on top, your pinned apps as large icons shown a page at a time with
  page dots, an "All apps" button to see everything, and a bottom row with your user card, your folder shortcuts and
  the power buttons. No recent files, no suggestions.
- Turn pages with the mouse wheel, Page Up and Page Down, Home and End, or the dots.
- In Grid, settings that only Classic uses are hidden. Their values are kept for when you switch back.

## [1.3.1] - 2026-11-11

### Changed

- **Simpler settings window:** five pages instead of seven (General, Menu, Pinned, Appearance, About). Each page
  shows the everyday settings; fine-tuning sits one click away in a sub-page, such as "More button options",
  "Search sources", "Icons" and "Advanced". The Menu page went from 47 settings to 16 rows.
- The panel button settings moved to General; Back Up, Restore and Import from ArcMenu are under About > Your settings.
- Settings that do not apply are hidden instead of greyed out, and custom colours, presets and shape appear only
  while "Use custom colours" is on.
- No setting was removed and saved values are kept. The page-wide "Reset General Settings" button is gone; each
  group still has its own reset icon.

## [1.3.0] - 2026-11-11

### Added

- **Calculator in the search box:** type `2+2`, `(3.5*4)/2`, `2^10`, `15% of 80`, `sqrt(16)` or `-3 + 4e2` (also × ÷ −)
  and Return copies the answer. A plain number such as `2048` still finds apps. Decimal point is `.`.
- **Unit conversion:** `5 km in miles`, `100 f in c`, `2 gb in mb`, `60 mph in km/h` (length, mass, temperature,
  volume, data size, speed, time); Return copies the result.
- **Settings panels:** `bluetooth`, `wifi`, `display`, `sound` and the other GNOME Settings panels open straight away.
- **App actions:** `firefox private` runs New Private Window, `chrome incognito` and so on.
- Each has a switch under Search sources in the preferences (all on by default).
- **Drag from All Apps to Pinned:** drag an app from All Apps, a category, Frequent or search results onto the
  Back button ("Drop to pin") to pin it at the end, or rest on it for half a second to jump into Pinned and drop it
  exactly where you want it, or onto a folder. Undo works as usual.
- **Back up and restore settings:** General > Back Up and Restore writes your settings, pinned apps and folders to
  one JSON file (mode 0600) and restores them from one. A restore validates every value against the schema, ignores
  and reports unknown keys, asks for confirmation and offers Undo.
- **Restart to Firmware Setup (UEFI):** an opt-in power button (Pinned > Power buttons, off by default), shown only
  when logind reports support. It asks for confirmation, then sets logind's firmware flag and restarts; the flag is
  cleared again if anything fails.

### Changed

- The menu layout code is split into smaller per-view modules (no visible change).
- Developer tools: ESLint 10; the panel click, hover and fullscreen scenarios now run in CI.
- Fuzzy search no longer matches a word cut off in the middle ("display" no longer finds Disk Player).

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
