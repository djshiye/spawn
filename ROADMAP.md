# Spawn roadmap

Written November 2026, against `main` at 1.0.0 (GNOME Shell 49, 50 and 51; Fedora DNF repository only).
This is a plan, not a promise. It is reviewed after each release.

## Where Spawn stands

Spawn 1.0 does what it set out to do: it replaces ArcMenu's two-pane "arcmenu" layout for one user, without
ArcMenu's crashes, and imports ArcMenu's settings in one click. The foundations are strong: every resource is
owned by a `Scope`, the panel is re-resolved on every Dash to Panel restart, the menu is built lazily, and a
headless GNOME Shell harness tests the real UI.

The gaps are mostly outside the core menu:

- **Nothing checks a change automatically.** There is no CI. Typecheck, lint, unit tests and the headless
  shell are run by hand.
- **Packages are unsigned.** The DNF repository uses `gpgcheck=0`.
- **Fedora only,** by choice: Spawn is distributed through its own DNF repository (decided November 2026).
- **English only,** although `gettext` is already wired in.
- **Little accessibility work.** Only a handful of widgets set an accessible name, so a screen reader hears
  very little.
- **One layout.** ArcMenu offers 20+; Spawn offers one, plus the runner.
- **`src/ui/layout.ts` is 1,863 lines** and almost every UI change touches it.

## How Spawn compares

| Area | ArcMenu | Spawn 1.0 | What people expect from a modern menu in 2026 |
|---|---|---|---|
| Stability across Dash to Panel restarts | Fragile (cached panels, prototype patches) | Solid, tested 10× in a row | Never breaks |
| Open speed | Builds everything at enable | ~20 ms open to painted, lazy build | Instant, under one frame budget feels "native" |
| App search | Provider order, no ranking | Ranked (prefix > word > substring > fuzzy), ~1.3 ms per query with PR #3 | Typo-tolerant, learns from use |
| Layouts | 20+ | 1 (two-pane) + runner | 2–4 good ones beats 20 average ones |
| Quick answers in search | Through GNOME providers only | Same | Calculator, unit conversion, "search the web for…", Settings panels |
| Recently installed apps | Highlighted | Not migrated | "New" badge, then fades |
| Hide an app from the menu | No (needs a menu editor) | No | Right-click → Hide |
| Unread badges on apps | No | No | Count badges, like Dash to Panel |
| Accessibility | Partial | Minimal | Full screen reader labels, visible focus, reduced motion |
| Touch | Basic | Basic | Long-press for the context menu, larger targets on touch screens |
| Translations | Many languages | English only | At least the top 10 languages |
| Distribution | extensions.gnome.org | Fedora DNF repository, unsigned | One-click install, signed packages |
| ArcMenu import | n/a | Yes, with preview and undo | n/a |

## Effort scale

- **S**: up to a day.
- **M**: a few days.
- **L**: one to two weeks.
- **XL**: more than two weeks, or needs design work first.

## Near term: Spawn 1.1 (next 4–6 weeks)

Make what exists safer to change and safer to install. Ship small, visible wins. Items are in the order they
should be done.

| # | Item | Why | Effort |
|---|---|---|---|
| 1 | **Land the open work.** Merge PRs #1–#5 (UI/UX audit, full-row All Apps hover, faster search, power-bar fit, folder popup grid) and the findings of the bug, performance, indexing and UI/UX reviews running now. | They fix real problems Dino has seen, including the power-button overflow. Shipping them first avoids conflicts with everything below. | S each |
| 2 | **CI on GitHub Actions, with supply-chain hygiene.** Typecheck, lint and unit tests on every pull request (`npm ci`, Actions pinned by commit SHA, `npm audit`, Dependabot). The headless GNOME Shell 51 smoke and lifecycle scenarios run on pull requests to `main` only. Add `SECURITY.md` and a `CHANGELOG.md`. | Today a regression is caught only if someone remembers to run the harness. Keeping the expensive shell job off ordinary pushes holds CI minutes down. | M |
| 3 | **Distribution: decided, own DNF repository** (Dino, 2026-11-06). Spawn stays on its own repository on GitHub Pages and is signed by us (item 4). Not on extensions.gnome.org, not on COPR. | Nothing changes for users, and the ArcMenu import keeps working after ArcMenu is removed (extensions.gnome.org would reject the bundled ArcMenu schema). | Done |
| 4 | **Signed packages** (`gpgcheck=1` and `repo_gpgcheck=1`, so `repomd.xml` is signed too). `tools/publish.sh` signs locally with a key that never leaves Dino's machine (ideally a hardware key), or in a GitHub Actions environment that needs Dino's approval and runs on tags only. The public key is published next to `spawn.repo` and its fingerprint in the README. | Unsigned packages on a system path are the largest security gap. A key kept as a plain Actions secret would fall with the same GitHub account that controls Pages, so it must live outside that account. A key on the same Pages site is still trust on first use, which the README should say. | M |
| 5 | **Split `layout.ts`** into one module per view (pinned, all apps, frequent, search results, right pane) behind a small view interface. No behaviour change, guarded by the existing ui scenarios. | Every item below touches the widgets. Splitting first avoids months of merge conflicts, and is the groundwork for a second layout (item 15). | M |
| 6 | **Accessibility pass.** Accessible names and roles on every button, row and tile in the menu and Preferences; the search box announces the result count; visible focus in every theme; respect GNOME's "Reduce animation". Tested with Orca. | Screen reader users currently hear almost nothing. It is also needed for an EGO listing to be credible. | L |
| 7 | **Hide apps from the menu.** Context menu → "Hide from Menu", with a "Hidden apps" list in Preferences to restore them. Search can optionally still find them. | The most common request for any app menu. No more editing `.desktop` files. | S–M |
| 8 | **Recently installed apps.** A small "New" badge on apps installed in the last few days, cleared after the first launch. | ArcMenu users had this and lose it on import. Helps people find what they just installed. | S |
| 9 | **GNOME Shell 52 readiness.** Add 52 to the compatibility matrix as soon as beta images exist (52 is due in March 2027, Fedora 46). Test on Fedora Rawhide, not only on Ubuntu devel. | Being ready on release day is the main reason people trust a shell extension. | S–M |

## Mid term: Spawn 1.2 and 1.3 (about 2–4 months)

Make search the best part of the menu, close the remaining ArcMenu import gaps, and reach more people.

| # | Item | Why | Effort |
|---|---|---|---|
| 10 | **Calculator in search.** A small hand-written parser (no `eval` or `Function`), unit tested; Return copies the answer. | The most used "search" feature in Windows and KDE menus. Faster than GNOME Calculator's provider and works without it. | S–M |
| 11 | **Unit conversion in search** ("5 km in miles", "30 c to f"). | Same reason, built on the calculator's parser. | M |
| 12 | **Settings panels and app actions as results.** "Bluetooth" opens the Bluetooth panel; "firefox private" offers Firefox's "New Private Window" action. | People search for what they want to do, not which app does it. The data is already in the app index. | M |
| 13 | **Usage-aware ranking.** Apps you launch often rank higher for the same query. Builds on the existing `usageScore()` in the app index. Honours GNOME's "Remember app usage" privacy switch and adds a "Clear usage history" button. | Makes search feel like it learns, with no cloud and no telemetry. | S |
| 14 | **"Search the web for…" as the last result.** Off by default. The search URL is a setting; no search engine is shipped as a default. The browser opens only when the user picks the row, and Spawn itself makes no network requests. | A natural fallback when nothing local matches, while respecting privacy. | S |
| 15 | **A second layout: grid start.** A centred pinned grid with a "Recommended" row (recent files and new apps), in the style people know from Windows 11 and ChromeOS. Starts with a design note and screenshots for Dino; built on the view interface from item 5. | The single biggest thing ArcMenu users ask about when they see one layout. Proves the layout system before adding more. | XL |
| 16 | **Translations.** Turn on the gettext pipeline, add a `po/` directory and a translation guide. The English source text stays in UK spelling. Check right-to-left layouts once a first RTL language lands. | Opens Spawn to most non-English users. The code is small; the lasting cost is keeping translations up to date. | S–M |
| 17 | **Back up and restore settings.** Export all of Spawn's settings and folders to one file and import them, with the same preview and undo as the ArcMenu import. | Moving to a new machine or reinstalling should not mean rebuilding pinned folders. | S–M |
| 18 | **Open on hover and hot corner.** ArcMenu's `activate-on-hover`, plus an optional hot corner. | ArcMenu users who relied on them cannot import them today. | S |
| 19 | **Multi-monitor polish.** Open the main menu on the monitor with the pointer (the runner already does), and remember the last monitor. | Removes the "menu opened on the other screen" annoyance. | S–M |
| 20 | **Run a typed command from the runner.** Typing `!` or a command that is not an app runs it, like Alt+F2. | Lets the runner fully replace GNOME's Alt+F2 dialog. | S |
| 21 | **Screen size checks.** Clamp the menu height on 720p screens, and check fractional scaling (125 %, 150 %) and HiDPI in the harness. | Small laptops and scaled displays are common, and clipped menus look broken. | S–M |
| 22 | **Touch and tablet.** Long-press opens the context menu; larger targets when a touch screen is used; drag to reorder pinned apps by touch. | 2-in-1 laptops are common, and today the context menu needs a right click or a keyboard. | M |

## Later (6 months and beyond)

Bigger bets. Each one starts with a short design note before any code.

| # | Item | Why | Effort |
|---|---|---|---|
| 23 | **More layouts, picked by demand.** Candidates: a full-screen GNOME-style app grid, a compact Whisker-style list, a launcher-only layout. Not all 22 ArcMenu layouts. | A few well-made layouts beat many average ones and keep the code small enough to stay stable. | L each |
| 24 | **File search beyond recent files.** First, make sure the Files (Nautilus) search provider, which already uses GNOME's LocalSearch index, works well through Spawn's existing shell-provider support. Query LocalSearch directly only if ranking or streaming needs it. | People expect a menu to find documents, not only apps. The first step is cheap. | S, then L |
| 25 | **Unread badges.** Count badges on app rows and tiles from the `com.canonical.Unity.LauncherEntry` D-Bus signal. Spawn only listens; it never claims the `com.canonical.Unity` name, which belongs to Dash to Panel or Dash to Dock. | Shows mail and chat counts without opening the app. Many apps only send counts when a dock owns that name, so it works best alongside Dash to Panel. | M |
| 26 | **Free menu placement.** Centre of the screen or a fixed corner, independent of the panel button (ArcMenu's `force-menu-location`). | Useful with a centred taskbar or no panel button at all. | M |

## Not planned

- **Telemetry or crash reporting that leaves the machine.** Spawn stays offline.
- **Prototype patching of GNOME Shell.** It is the root cause of most ArcMenu breakage (`docs/research/lifecycle.md`).
- **Copying all of ArcMenu's layouts and options.** Spawn's value is that it is smaller and stricter.

## How each release is judged

- `npm run typecheck`, `npm run lint`, `npm test` and `tools/dev-shell.sh all` pass, with no new `JS ERROR` lines.
- Performance stays within today's budget: menu open to painted around 20 ms, app search under 2 ms per query
  (`tools/dev-shell.sh bench`, 300+ apps). A change that is slower needs a stated reason.
- Leak check: 30 open and close cycles leave no extra actors.
- Every new feature is off by default when it changes how the menu looks or behaves for existing users.
- Every user-facing string uses UK spelling.
