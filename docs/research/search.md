# ArcMenu search system: analysis

Source root: `/tmp/claude-1000/-home-dino-Coding/d2878a56-801c-42b2-bf19-83145b8a82f0/scratchpad/src/ArcMenu/src/`
Abbreviated below as `src/`. GNOME Shell source is NOT present locally (`/usr/share/gnome-shell` has no JS), so all GNOME-internal claims are inferred from ArcMenu's usage, not checked against GNOME.

## 1. Architecture

- **Owner / construction (eager):** `src/menulayouts/baseMenuLayout.js:108` does `this.searchResults = new SearchResults(this)` in the layout constructor, and `:109` builds `MW.SearchEntry`. So the whole search subsystem is built at menu construction time, not on first search.
- **Entry → terms:** `SearchEntry` emits `search-changed` (`src/menuWidgets.js:3830-3831`) → `BaseMenuLayout._onSearchEntryChanged` (`src/menulayouts/baseMenuLayout.js:994-1036`) → trims, splits on whitespace (`:1033`) → `SearchResults.setTerms(terms)`. Empty text removes the results actor (`:996-997`) and calls `setTerms([])`.
- **`SearchResults`** (`src/search.js:430`): a `St.BoxLayout` that holds:
  - `_providers[]` (`:504`): all registered providers, in registration order. Order is what decides which provider's top hit is default (`_maybeSetInitialSelection`, `:744-768`). There is no cross-provider relevance ranking.
  - `_content` (one child per provider display) and `_statusContainer` (spinner / "Searching" / "No Results Found", `:463-494`).
  - `_results{}` (`:502`): last full result-ID list per provider, used for subsearch.
  - `_highlighter` (`:506`, rebuilt in `setTerms`, `:719`).
  - `recentFilesManager` (`:508`).
- **Per-provider display** (`src/search.js:114-428`):
  - `SearchResultsBase` (`:114`): owns `_resultDisplays{}` (cache of result-ID → actor), a per-batch `Gio.Cancellable`, and `updateSearch()` (`:212`).
  - `ListSearchResults` (`:245`): used when `provider.appInfo` is set. Shows a provider header row (`ArcSearchProviderInfo`, `:848`, "N more" label) and a vertical list. Max count = `max-search-results` (`:292-294`).
  - `AppSearchResults` (`:318`): used for providers with no `appInfo`. Shows a grid or list in a `Clutter.GridLayout`. In grid mode the max count is computed from icon width and menu width (`:375-384`, via `baseMenuLayout.js:204-223`), so `max-search-results` is ignored in grid mode.
  - Result actors: `ListSearchResult` (`:34`) and `AppSearchResult` (`:74`), both extending `ApplicationMenuItem` from `src/menuWidgets.js`. Activation goes through `activateSearchResult` (`src/menuWidgets.js:2748-2770`), which calls `provider.activateResult(id, terms)` if present, otherwise handles `.desktop` IDs or GNOME system actions.
- **Registration:**
  - `_registerGnomeShellProviders` (`src/search.js:574-583`): copies GNOME's own non-remote providers from `Main.overview.searchController._searchResults._providers` (`:575-576`). Then adds ArcMenu's `OpenWindowSearchProvider` if `search-provider-open-windows` (`:579-580`) and `RecentFilesSearchProvider` if `search-provider-recent-files` (`:581-582`).
  - `_reloadRemoteProviders` (`:585-602`): cancels any search, unregisters all remote providers, reloads them via `RemoteSearch.loadRemoteSearchProviders(this._searchSettings)` (`:596`), re-registers them, and restarts the search if terms were set.
  - Dynamic providers: `SearchProviderEmitter` (`src/searchProviders/searchProviderEmitter.js:10-40`) monkey-patches `SearchController.prototype.addProvider/removeProvider` to emit `search-provider-added/removed`. `SearchResults` listens at `src/search.js:516-519`.
  - `_ensureProviderDisplay` (`:724-736`) creates the display and attaches it to `_content`, storing it on the provider as `provider['display_<menuButton.searchProviderDisplayId>']` (`:452`, `:735`). The `_displayId` suffix means the provider object is mutated with a per-menu-instance key.
- **Lifecycle:** `setTerms` (`:686-722`) → `recentFilesManager.cancelCurrentQueries()` (`:698`) → new `Gio.Cancellable` replaces the old one and cancels it (`:700-701`) → if empty, `_reset()` (`:703-706`). Otherwise it marks `_startingSearch`, sets `_isSubSearch` (`:708-713`), and arms a 150 ms `GLib.timeout_add` if none is pending (`:716-717`). When the timer fires, `_doSearch` (`:662-678`) fans out `_doProviderSearch` (`:627-649`) to every provider in parallel.
- **Ranking:** none in ArcMenu. Order is provider order, then whatever order each provider returns. The provider's own ordering is used, and `filterResults` truncates it (`slice(0, n)` in both custom providers: `src/searchProviders/openWindows.js:55-57`, `src/searchProviders/recentFiles.js:51-53`). The GNOME remote providers are not visible from this code, so their ranking is whatever GNOME returns.
- **Max results:** `max-search-results`, default 5 (`src/../schemas/org.gnome.shell.extensions.arcmenu.gschema.xml:322-325`). Applied in `SearchResultsBase.updateSearch` (`src/search.js:218-223`) via `provider.filterResults`. Grid mode uses columns instead (see above).
- **Debounce / timers:** a single fixed 150 ms `GLib.timeout_add` (`src/search.js:717`), not reset on each keystroke. It is a fixed window that starts on the first keystroke. Each keystroke still updates `this._terms`, so the window fires with the latest text. No other timers in the search path.
- **Cancellation:**
  - Batch level: `SearchResults._cancellable` (`:522`, replaced in `setTerms` `:700-701`). `_doProviderSearch` checks it after `await` and drops stale results (`:644-645`).
  - Metas level: `SearchResultsBase._cancellable` (`:141`, replaced in `_ensureResultActors` `:188-190`). Cancels the previous in-flight `getResultMetas`.
  - Caveat: `RecentFilesSearchProvider.getInitialResultSet` ignores the cancellable it is given (`src/searchProviders/recentFiles.js:55`) and calls `recentFilesManager.cancelCurrentQueries()` itself (`:56`), which cancels queries globally.
  - Caveat: `OpenWindowSearchProvider.getInitialResultSet` is synchronous and ignores its cancellable (`src/searchProviders/openWindows.js:59-71`).
- **Hover, selection, keyboard:** `SearchEntry` handles Enter and arrow keys (`src/menuWidgets.js:3753-3865`). It activates `getTopResult()` (`src/search.js:822-824`). `blockHoverState` is set on every keystroke (`src/menulayouts/baseMenuLayout.js:1028`) to stop mouse hover from changing the top hit.

## 2. Providers

| Provider | Source | Type | `appInfo`? | Display class | Search | Async model |
|---|---|---|---|---|---|---|
| GNOME built-in, non-remote (from `Main.overview.searchController._searchResults._providers`) | GNOME Shell (in-process objects, e.g. the app search provider) | in-process | varies | `ListSearchResults` if `appInfo`, else `AppSearchResults` (`src/search.js:729-732`) | GNOME's own `getInitialResultSet` / `getSubsearchResultSet` / `getResultMetas` | Promise from GNOME; cancellable passed through (`:636-638`) |
| GNOME remote (`RemoteSearch.loadRemoteSearchProviders`) | D-Bus `org.gnome.Shell.SearchProvider2` apps from `org.gnome.desktop.search-providers` | D-Bus | yes (`appInfo` = desktop app) | `ListSearchResults` | GNOME's `RemoteSearchProvider2` (D-Bus `GetInitialResultSetAsync`, etc.; inferred) | async; cancellable passed to D-Bus |
| Open Windows (`src/searchProviders/openWindows.js`) | `global.display.get_tab_list(NORMAL_ALL)` via `getWindows` (`:110-120`) | in-process | yes, synthetic (`:30-36`) | `ListSearchResults` | Lowercased substring match on window title, app name, app description (`:87-98`), OR across terms (`:93`) | Sync enumeration; returns a resolved Promise |
| Recent Files (`src/searchProviders/recentFiles.js`) | `recentFilesManager` reads `~/.local/share/recently-used.xbel` (`src/recentFilesManager.js:17-30`), sorted by modified time desc | file I/O plus per-file `query_info_async` | yes, synthetic (`:28-33`) | `ListSearchResults` | Substring match on file basename, OR across terms (`:111-119`) | `Promise.all` over every recent file, each doing `query_info_async` (`:60-70`); hidden files filtered by `show-hidden-recent-files` (`src/recentFilesManager.js:61-65`) |

Notes on each provider:
- **Open Windows:** `getResultMetas` (`openWindows.js:39-53`) drops windows whose metas are missing. Then `SearchResultsBase._ensureResultActors` throws on count mismatch (`src/search.js:199-200`). That is a real hazard if a window closes between search and display. Result IDs are window IDs as strings, parsed back with `parseInt` (`:101`).
- **Recent Files:** `getResultMetas` calls `rf.get_uri()` at line 39 *before* the `rf ?` check at line 40, so a missing entry throws a TypeError instead of being filtered (`src/searchProviders/recentFiles.js:38-40`). Also, `_recentFiles` is reset at line 57 while earlier `Promise.all` callbacks from a previous search can still push into the new array at line 66. That is a cross-search race. `activateResult` launches via `Gio.AppInfo.launch_default_for_uri_async` (`:84-94`), and that promise is never returned.
- **GNOME in-process providers without `appInfo`:** these go through `AppSearchResults`, which is where the startup error comes from (section 5).

## 3. Settings keys that affect search

All in `schemas/org.gnome.shell.extensions.arcmenu.gschema.xml` (under `src/../schemas/`, i.e. `/tmp/.../scratchpad/src/ArcMenu/schemas/`):

| Key | Default | Effect | Where read |
|---|---|---|---|
| `max-search-results` | 5 (`:322-325`) | List-mode result cap per provider | `src/search.js:293`, `:381` |
| `highlight-search-result-terms` | false (`:326-329`) | Adds `terms-changed` connection and markup highlighting | `src/search.js:53`, `:95` |
| `show-search-result-details` | false (`:330-333`) | Shows description label in list rows and highlights it | `src/search.js:64`, `:103` |
| `search-provider-open-windows` | false (`:334-337`) | Registers OpenWindowSearchProvider | `src/search.js:579` |
| `search-provider-recent-files` | false (`:338-341`) | Registers RecentFilesSearchProvider | `src/search.js:581` |
| `show-hidden-recent-files` | false (`:346-`) | Keeps hidden files in recent results | `src/recentFilesManager.js:62` |
| `search-hidden` | false (`:318-321`) | Hides the search entry when empty | `src/menulayouts/baseMenuLayout.js:990` |
| `search-entry-border-radius` | (true, 25) (`:342-345`) | Visual only | (not searched) |
| `menu-layout` | — | Picks `ListSearchResult`/`AppSearchResults` styling; read once at construction | `src/search.js:48`, `:254`, `:328`, `:454` |
| `icon-size-grid` | — | Grid column math | `src/menulayouts/baseMenuLayout.js:215` |
| `recently-installed-apps` (not search, but triggers reload) | — | `src/menulayouts/baseMenuLayout.js:137` |
| `org.gnome.desktop.search-providers` (GNOME schema, not ArcMenu's): `disabled`, `enabled`, `disable-external`, `sort-order` | GNOME | Each change triggers `_reloadRemoteProviders` (`src/search.js:511-514`) | `src/search.js:510-514` |

Also used: `Shell.AppSystem` `installed-changed` triggers a full remote reload (`src/search.js:525`). Layout-related `display-type` values feed grid vs list (`src/search.js:337`, `:350`).

## 4. Reuse of GNOME Shell internals

Imports (all under `resource:///org/gnome/shell/...`):
- `misc/config.js` (`Config.PACKAGE_VERSION`): version gating. `HAS_SPINNER = ShellVersion >= 48` (`src/search.js:28-29`).
- `ui/animation.js` `Spinner` (`src/search.js:15`), used only when `HAS_SPINNER`.
- `misc/util.js` `Highlighter` (`src/search.js:16`). Used for term highlighting; constructed with `new Highlighter(terms)` (`:719`).
- `ui/main.js` (`src/search.js:17`, `src/searchProviders/openWindows.js:9`, `recentFiles.js:6`). Uses `Main.overview.searchController._searchResults._providers` (`src/search.js:575`). That is a *private* underscore field on a private GNOME object. Also `Main.activateWindow`, `Main.notifyError`.
- `ui/remoteSearch.js` `loadRemoteSearchProviders` (`src/search.js:18`, `:596`). Returns provider objects with `isRemoteProvider`, `appInfo`, and the search methods.
- `ui/searchController.js` `SearchController` (`src/searchProviders/searchProviderEmitter.js:3`). Monkey-patches `addProvider` / `removeProvider` on the prototype (`:16`, `:25`).
- `misc/signals.js` `EventEmitter` (`searchProviderEmitter.js:1`).
- `extensions/extension.js` `gettext`, `InjectionManager` (`src/search.js:12`, `searchProviderEmitter.js:2`).

Contract ArcMenu relies on, from the provider objects (`src/search.js` and `src/searchProviders/*`):
- `id`, `isRemoteProvider`, `canLaunchSearch`, `appInfo` (`get_name`, `get_description`, optional `get_id`/`get_icon`), `searchInProgress` (written by ArcMenu, `:605`, `:628`).
- `getInitialResultSet(terms, cancellable)`, `getSubsearchResultSet(prev, terms, cancellable)`, `getResultMetas(ids, cancellable)` returning `{id, name, description, createIcon(size), clipboardText?}`, `filterResults(results, max)`, `activateResult(id, terms)`, `launchSearch(terms)`.

Fragility:
- **High.** `Main.overview.searchController._searchResults._providers` and the monkey-patched `addProvider`/`removeProvider` are private. `isRemoteProvider` and `appInfo` are duck-typed guesses about GNOME's provider shape. `RemoteSearch` and `Highlighter` are internal APIs.
- The `metadata.json` declares shell versions 45 through 51 (`src/../metadata.json:9`). The code has a single version gate (`HAS_SPINNER >= 48`, `:29`), so behaviour across 45 to 47 is not gated for other differences.
- `SearchController` could rename or change signatures across shell releases. The patching is applied at enable, so a mismatch fails at enable time.

## 5. Root cause of "No object to track signals"

**Location:** `src/search.js:350`:

```js
this._menuLayout.connectObject('notify::search-display-type', () => this._setResutlsDisplayType());
```

This is the only `connectObject` call in `search.js` with two arguments. Every other call in the file passes the owner as the third argument, for example `:55`, `:97`, `:268-273`, `:511-514`, `:516-519`, `:525`. The GNOME signal tracker needs that owner to attach the handler, so the call without it throws. The owner argument is missing, which matches the message.

**Why it runs at enable:** the call is in `AppSearchResults`'s constructor (`src/search.js:323-352`). That class is picked by `_ensureProviderDisplay` (`:724-732`) for any provider with no `appInfo`. `_registerProvider` (`:604-608`) calls it, and `_registerGnomeShellProviders` (`:574-577`) calls `_registerProvider` for every non-remote GNOME provider. `_registerGnomeShellProviders` runs from the `SearchResults` constructor at `:527`, which runs from `BaseMenuLayout` at `baseMenuLayout.js:108`. So the failing constructor runs during menu construction, at enable.

**What the error does, per the code (not yet observed at runtime):**
- The throw happens inside the `AppSearchResults` constructor, before `_ensureProviderDisplay` stores the display (`:732-735`).
- `_registerProvider` has already pushed the provider onto `_providers` (`:606`), so the provider is left with no display.
- Later calls that assume a display then throw a TypeError. Example: `_updateSearchProgress` at `:778-781` calls `display.getFirstResult()` with no guard. `_updateResults` (`:805-815`) and `_maybeSetInitialSelection` (`:750-753`) also dereference the missing display. `_clearDisplay` uses `?.` (`:740`) so it is safe.
- The exception also propagates out of `_registerGnomeShellProviders`. That skips the remaining GNOME providers and the ArcMenu Open Windows / Recent Files registration at `:579-582`. The code, as read, does not show a catch around `:527`. Yet the reported behaviour is "log and continue", so something above `BaseMenuLayout` construction must be catching it. **I did not verify the caller** (`src/menuButton.js` / `src/menulayouts/layoutHandler.js`). That needs checking before the fix is designed.

**Likely trigger:** a GNOME built-in provider with no `appInfo`. That is inferred from the code path; GNOME's provider list was not available to check.

**Fix:** pass `this` as the third argument: `this._menuLayout.connectObject('notify::search-display-type', () => this._setResutlsDisplayType(), this);`. The same owner pattern applies on `:350` since the handler closes over `this`. Also make `_registerProvider` / `_ensureProviderDisplay` atomic (create the display before pushing to `_providers`), and guard the `display` dereferences.

Related bug found while reading `_unregisterProvider` (`src/search.js:610-612`): `indexOf` can return `-1`, and `splice(-1, 1)` then removes the **last** provider. It should check `index !== -1`.

## 6. Performance problems and ideas for a faster design

Problems:
1. **Eager construction.** All providers, their display actors, and the GNOME provider list are built at menu construction (`baseMenuLayout.js:108`, `search.js:527-528`), even when the user never searches. Each `AppSearchResults` / `ListSearchResults` builds its own `St` tree (`search.js:131-136`, `:258-285`, `:342-348`).
2. **Every keystroke re-runs every provider.** `_doSearch` (`search.js:668-673`) calls `getInitialResultSet` or `getSubsearchResultSet` for every provider. Only subsearch (`:635`) is incremental, and it only applies when the new query starts with the old one (`:708-710`). Backspacing always does a full run.
3. **Recent Files does a file `query_info_async` for every recent file, on every keystroke** (`recentFiles.js:60-70`, `recentFilesManager.js:45-75`). The default `recently-used.xbel` can hold hundreds of entries. This is the most expensive path and it runs before filtering by name. Filtering by basename should happen first, and the stat should only run on the matches.
4. **Recent Files re-reads the XBEL file on every call** (`recentFilesManager.js:17-30`, `load_from_file`), and `getRecentFiles` sorts every time. Cache, and invalidate on file change (`Gio.FileMonitor`).
5. **Open Windows enumerates all windows and rebuilds `_appWindows` on every call** (`openWindows.js:59-65`). It is cheap but synchronous and not cancellable.
6. **`_updateSearchProgress` runs after every provider completes** (`search.js:813`, `:777-803`). It walks all providers and emits `have-results` / `no-results` each time. Coalesce it, e.g. once per frame or once per batch.
7. **Grid column math runs per item** (`search.js:400-401`, `getBestFitColumnsForGrid` at `baseMenuLayout.js:204-210`). Compute it once per layout change.
8. **Fixed 150 ms debounce, not trailing.** The timer starts on the first keystroke and is not reset (`search.js:716-717`). A trailing debounce of ~80 to 120 ms, reset on each keystroke, plus an immediate run for the first character, would be more responsive and fewer runs. Pick values by measuring; the current 150 ms is not tuned to anything in the code.
9. **Cache keys.** `_resultDisplays` is cached per session (`search.js:138`, `:181-183`), but `clear()` (`:164-175`) destroys it on every reset. Results are not cached across sessions, so reopening the menu rebuilds every row.
10. **Result IDs as the cache key.** For open windows, title changes are not picked up until the display is rebuilt (`openWindows.js:44`), because `getResultMetas` results are cached by ID (`search.js:181-209`).
11. **Full result cloning.** `_results` keeps the full result list for subsearch (`search.js:647`), even when only `maxResults` are shown. That is fine for memory, but the subsearch path re-runs the full provider query anyway, so the stored list is not used for filtering unless the provider implements it.

Concrete design ideas:
- **Lazy init:** create `SearchResults` and its providers on first `setTerms`, not at layout construction. Register GNOME providers on first use, and attach to the overview's provider list lazily.
- **Single owner for signals:** always use the `connectObject(..., this)` form, and guard provider display creation with an atomic create-then-register step (section 5).
- **Provider contract that does not depend on GNOME internals:** implement a small `SearchProvider` interface (`search(terms, cancellable) -> ids`, `metas(ids) -> metas`, `activate(id)`) and adapt GNOME's providers behind one adapter. That isolates the private-field reliance to one file.
- **Recent Files:** cache the parsed `recently-used.xbel` with a `Gio.FileMonitor`. Filter by basename first, then `query_info_async` only the matches, and only if needed for hidden-file checks.
- **Open Windows:** keep a window index updated from `window-created` / `window-removed` / `notify::title` signals, rather than re-enumerating per keystroke. Search the index synchronously; it is cheap.
- **Ranking:** if a stable order is wanted, score matches (prefix > word-start > substring) instead of relying on provider order. Current matching is OR across terms (`openWindows.js:93`, `recentFiles.js:115`), so `foo bar` matches anything that matches either word. Consider AND across terms to narrow results.
- **Cancellation everywhere:** every provider should honour its cancellable, including the synchronous ones, and no provider should call a global cancel (`recentFiles.js:56`).
- **Debounce:** trailing debounce of 80 to 120 ms, reset per keystroke; run immediately when the query becomes empty or a result set is cached.
- **Grid mode:** compute `maxDisplayedResults` once per resize, not per `_addItem`.

## Top issues (summary)

1. `search.js:350` missing owner argument to `connectObject` → "No object to track signals" at enable. Verify caller error handling (`menuButton.js` / `layoutHandler.js`) and whether it is swallowed.
2. `search.js:604-608` + `:724-736` non-atomic registration: a failed display leaves a provider in `_providers` with no display, and `_updateSearchProgress` (`:778-781`) then dereferences `undefined`.
3. `search.js:610-612` `_unregisterProvider` splices index `-1`, removing the last provider.
4. `recentFiles.js:38-40` `rf.get_uri()` before the null check.
5. `recentFiles.js:55-66` race between `_recentFiles` reset and in-flight stat callbacks, and global `cancelCurrentQueries` (`:56`).
6. `search.js:199-200` count mismatch throws when `getResultMetas` filters entries (Open Windows / Recent Files).
7. Eager construction and per-keystroke full provider fan-out (perf).
8. Reliance on private GNOME internals (`Main.overview.searchController._searchResults._providers`, `SearchController.prototype` monkey-patch, `RemoteSearch`) across shell 45–51 with a single version gate (`search.js:28-29`).
