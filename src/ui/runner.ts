// SpawnRunner: the standalone runner, a search-only popup opened by its own hotkey (setting
// `runner-hotkey`) or the D-Bus method ToggleRunner, independent of the panel button. Port of
// ArcMenu's "Runner" (menulayouts/runner.js, standaloneRunner.js).
//
// Responsibility: a compact popup (search box on top, results below) that opens on the monitor
// under the pointer, Top or Centered (`runner-position`), `runner-menu-width` wide and at most
// `runner-menu-height` tall. It reuses the menu's search pipeline and widgets unchanged:
// `Services.search` (SearchEngine), `SearchBox`, `ResultList`, `AppRow`. The glue between them (debounced
// query, stale-batch guard, "Return before the first row arrived", flush on Return / Down) follows
// SpawnLayout._onSearchText / _onSearchActivate / _onSearchKey; it is repeated here in a few lines
// instead of being extracted, so the main layout stays untouched.
//
// `runner-font-size` (pt; 0 = the menu font) sets the font of the whole popup content and of the entry.
//
// Hosting: a PopupMenu anchored at Main.layoutManager.dummyCursor (as ArcMenu does), so the shell's
// grab handling gives modal focus, Escape and click-outside for free. The dummy cursor is moved to
// the wanted spot before every open. Nothing is built before the first open(): the PopupMenu, the
// widgets and the tooltip manager live in one child scope that is created then.
//
// Empty query (`runner-default-view`): ArcMenu shows nothing until you type (`Default`), or its pinned
// / frequent apps. Spawn keeps ArcMenu's default (a bare search box is what a runner is for) and
// offers the same two lists: `Pinned_Apps` (top-level pinned apps, folders left out) and
// `Frequent_Apps` (`max-frequent-apps`, at most 10). Return on the empty box launches the first app.
//
// Keyboard: as in the menu, the typing focus stays in the entry while results show: Up / Down move the
// highlight one result (wrapping; Down goes to the second, the first is highlighted already), Page Up /
// Down one page, Return / Ctrl+Return activate the highlighted one (Ctrl: an app as with a Ctrl+click).
// With the default list (no query) Down enters it. Tab / Shift+Tab cycle between the entry and the rows
// (into the results at the highlighted one), Return on a row activates it, typing from a row goes back to
// the entry, Escape closes. One highlight: the pointer moves it (widgets/highlight.ts). Activating a result
// closes the runner. Context menus (right click) are not part of the runner.
//
// Public API:
//   new SpawnRunner(scope, services, host: RunnerHost)
//   runner.isOpen: boolean
//   runner.open() / runner.close() / runner.toggle()     never throw
//   runner.onOpenStateChanged(scope, cb(open: boolean))
//   runner.search(query)            dev hook: type `query` into the box (opens the runner first)
//   runner.debugState(): object     open, query, view, rows, focus, geometry (dev hook)
//   RunnerHost: {beforeOpen(): void}  called right before the popup opens (the extension closes the main menu)

import Clutter from 'gi://Clutter';
import type Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {error} from '../core/log.js';
import {pageTarget} from '../model/listNav.js';
import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {SearchHandle} from '../search/engine.js';
import {closeMenu, openMenu, silenceSourceKeys} from './menuParams.js';
import {
    applyScrollSettings, applyTone, displayName, iconSizeFor, launchApp, lookupApp, scrollIntoView, showDescriptions,
} from './util.js';
import {bindReducedMotion, markDialog, markList} from './widgets/a11y.js';
import {AppRow, DEFAULT_ROW_ICON_SIZE} from './widgets/appRow.js';
import {PointerHighlight} from './widgets/highlight.js';
import {ResultList} from './widgets/resultList.js';
import {SearchBox} from './widgets/searchBox.js';
import {TooltipManager} from './widgets/tooltip.js';

export interface RunnerHost {
    /** Called right before the runner opens; the extension closes the main menu here. */
    beforeOpen(): void;
}

type OpenListener = (open: boolean) => void;

/** How long a Return pressed before the first row arrived stays armed (as in SpawnLayout). */
const ACTIVATE_WAIT_MS = 1500;
/** Distance from the top of the work area for the `Top` position. */
const TOP_MARGIN = 16;
/** Keeps the runner off the screen edges on narrow monitors. */
const SCREEN_MARGIN = 16;
/** Height of the search row (entry, margins and the popup padding); the results get the rest. */
const CHROME_HEIGHT = 72;
const DEFAULT_LIST_ROWS = 10;
const SCROLL_KEYS = ['scrollbars-visible', 'scrollbars-overlay', 'scrollview-fade-effect'] as const;

interface Ui {
    scope: Scope;
    menu: PopupMenu.PopupMenu;
    content: St.BoxLayout;
    search: SearchBox;
    results: ResultList;
    scroll: St.ScrollView;
    defaultBox: St.BoxLayout;
    tooltips: TooltipManager;
    highlight: PointerHighlight;
}

export class SpawnRunner {
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _host: RunnerHost;
    private readonly _listeners = new Set<OpenListener>();

    private _ui: Ui | null = null;
    private _open = false;
    private _disposed = false;
    private _searchHandle: SearchHandle | null = null;
    private _searchToken = 0;
    private _activateWhenReady = false;
    private _activateCtrl = false;
    private _cancelActivateWait: (() => void) | null = null;
    private _defaultRows: St.Button[] = [];

    constructor(scope: Scope, services: Services, host: RunnerHost) {
        this._scope = scope;
        this._services = services;
        this._host = host;
        scope.add(() => this._teardown(), 'SpawnRunner');
    }

    get isOpen(): boolean {
        return this._open;
    }

    onOpenStateChanged(scope: Scope, cb: OpenListener): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'SpawnRunner listener');
    }

    toggle(): void {
        if (this._open)
            this.close();
        else
            this.open();
    }

    open(): void {
        if (this._disposed || this._open)
            return;
        try {
            this._host.beforeOpen();
            const ui = this._ui ?? this._build();
            this._applyGeometry(ui);
            applyTone(ui.menu.actor, ui.menu.box);
            this._services.warmUp();
            openMenu(ui.menu);
        } catch (e) {
            error('runner open failed', e);
        }
    }

    close(): void {
        try {
            if (this._ui && this._open)
                closeMenu(this._ui.menu);
        } catch (e) {
            error('runner close failed', e);
        }
    }

    /** Dev hook: type `query` into the box, opening the runner first. */
    search(query: string): void {
        this.open();
        const ui = this._ui;
        if (!ui)
            return;
        ui.search.focus();
        ui.search.text = query;
    }

    debugState(): Record<string, unknown> {
        const ui = this._ui;
        const actor = ui?.menu.actor;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        let where: string | null = null;
        if (ui && this._open) {
            if (ui.search.hasFocus)
                where = 'entry';
            else if (focus && ui.content.contains(focus))
                where = 'row';
        }
        return {
            open: this._open,
            built: ui !== null,
            query: ui?.search.text ?? '',
            view: ui ? (ui.search.text.trim() === '' ? 'default' : 'results') : null,
            results: ui?.results.rows().length ?? 0,
            defaultRows: this._defaultRows.length,
            focus: where,
            // the search highlight (Return target)
            selectedIndex: ui ? ui.results.rows().indexOf(ui.results.selected() as St.Widget) : -1,
            selected: ui?.results.selected()?.accessible_name ?? null,
            rect: actor && actor.visible ? [actor.x, actor.y, actor.width, actor.height] : null,
        };
    }

    // ---- construction (first open) ----

    private _build(): Ui {
        const scope = this._scope.child('runner ui');
        const settings = this._services.settings;
        try {
            const cursor = Main.layoutManager.dummyCursor;
            const menu = new PopupMenu.PopupMenu(cursor, 0.5, St.Side.TOP);
            const manager = new PopupMenu.PopupMenuManager(cursor);
            // The shell's PopupMenu handles keys on its source actor (Return / Space opens it);
            // the dummy cursor is shared, so keep it quiet.
            silenceSourceKeys(menu);

            Main.uiGroup.add_child(menu.actor);
            menu.actor.hide();
            menu.actor.add_style_class_name('spawn-popup');
            menu.actor.add_style_class_name('spawn-runner');
            manager.addMenu(menu);

            // Registered first = torn down last (LIFO): the widgets below are destroyed while their
            // parents are still alive, then the menu shell goes (as in SpawnPopup).
            scope.add(() => {
                manager.removeMenu(menu);
                closeMenu(menu, false);
                menu.destroy();
            }, 'runner menu');

            const tooltips = new TooltipManager(scope, settings);
            const search = new SearchBox(scope, settings);
            const results = new ResultList(scope, settings, {close: () => this.close(), tooltips, compactEmpty: true});
            const defaultBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-list'});
            markList(defaultBox, _('Suggested apps'));
            const body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});
            body.add_child(defaultBox);
            body.add_child(results.actor);
            const scroll = new St.ScrollView({
                style_class: 'spawn-runner-scroll',
                hscrollbar_policy: St.PolicyType.NEVER,
                x_expand: true,
                y_expand: true,
                visible: false,
            });
            scroll.add_child(body);
            applyScrollSettings(scroll, settings);
            settings.onChanged(scope, SCROLL_KEYS, () => applyScrollSettings(scroll, settings));

            const content = new St.BoxLayout({style_class: 'spawn-runner-content', orientation: Clutter.Orientation.VERTICAL, reactive: true});
            markDialog(content, _('Spawn runner'));
            bindReducedMotion(scope, content);
            search.actor.add_style_class_name('spawn-runner-search');
            content.add_child(search.actor);
            content.add_child(scroll);
            menu.box.add_child(content);

            const highlight = new PointerHighlight(scope, content, {
                // A result row under the pointer takes the search highlight; the typing focus stays in the entry.
                onHover: item => {
                    if (!results.rows().includes(item))
                        return false;
                    results.select(item);
                    return search.hasFocus;
                },
            });
            const ui: Ui = {scope, menu, content, search, results, scroll, defaultBox, tooltips, highlight};
            this._ui = ui;

            search.onTextChanged(scope, text => this._onText(ui, text));
            search.onActivate(scope, () => this._onActivate(ui));
            search.onNavigate(scope, (key, shift, ctrl) => this._onSearchKey(ui, key, shift, ctrl));
            scope.connect(content, 'key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => this._onKeyPress(ui, event));
            scope.connect(menu, 'open-state-changed', (_m: unknown, open: boolean) => this._onOpenState(ui, open));
            scope.connect(global.stage, 'notify::key-focus', () => this._onFocusChanged(ui));
            scope.add(() => {
                this._cancelSearch();
                this._setActivateWhenReady(false);
                this._defaultRows = [];
            }, 'runner search state');
            return ui;
        } catch (e) {
            scope.dispose();
            this._ui = null;
            throw e;
        }
    }

    /** Size from the settings; position on the monitor under the pointer. */
    private _applyGeometry(ui: Ui): void {
        const s = this._services.settings;
        let monitor = -1;
        try {
            monitor = global.display.get_current_monitor();
        } catch {
            monitor = -1;
        }
        if (monitor < 0 || monitor >= Main.layoutManager.monitors.length)
            monitor = Main.layoutManager.primaryIndex;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);

        const width = Math.max(200, Math.min(s.get('runner-menu-width'), area.width - 2 * SCREEN_MARGIN));
        const height = Math.min(s.get('runner-menu-height'), area.height - 2 * SCREEN_MARGIN);
        // `runner-font-size` (pt, 0 = the menu font): on the content so the results and the entry inherit it
        const font = s.get('runner-font-size');
        ui.content.style = `width: ${width}px;${font > 0 ? ` font-size: ${font}pt;` : ''}`;
        ui.search.actor.style = font > 0 ? `font-size: ${font}pt;` : '';
        ui.scroll.style = `max-height: ${Math.max(120, height - CHROME_HEIGHT)}px;`;

        const x = Math.round(area.x + area.width / 2);
        const y = s.get('runner-position') === 'Centered'
            ? Math.round(area.y + area.height / 2 - height / 2)
            : area.y + TOP_MARGIN;
        Main.layoutManager.setDummyCursorGeometry(x, y, 0, 0);
    }

    // ---- open / close ----

    private _onOpenState(ui: Ui, open: boolean): void {
        if (this._disposed)
            return;
        this._open = open;
        try {
            this._reset(ui);
            ui.highlight.reset();
            if (open) {
                this._fillDefault(ui);
                ui.search.focus();
            } else {
                ui.tooltips.hide();
                this._services.search.cancel();
                this._services.search.clear();
            }
        } catch (e) {
            error('runner open-state handler failed', e);
        }
        for (const cb of [...this._listeners]) {
            try {
                cb(open);
            } catch (e) {
                error('runner listener threw', e);
            }
        }
    }

    private _reset(ui: Ui): void {
        this._cancelSearch();
        this._setActivateWhenReady(false);
        ui.search.setSilently('');
        ui.results.reset();
        this._showView(ui, false);
    }

    /** Results (a query) or the default list; the scroll area hides when there is nothing to show. */
    private _showView(ui: Ui, results: boolean): void {
        ui.results.actor.visible = results;
        ui.defaultBox.visible = !results;
        ui.scroll.visible = results || this._defaultRows.length > 0;
    }

    private _fillDefault(ui: Ui): void {
        ui.tooltips.hide();
        for (const c of ui.defaultBox.get_children())
            c.destroy();
        this._defaultRows = [];
        const s = this._services.settings;
        const view = s.get('runner-default-view');
        const apps: Shell.App[] = [];
        if (view === 'Frequent_Apps') {
            const limit = s.get('max-frequent-apps');
            apps.push(...this._services.appIndex.frequent(limit > 0 ? Math.min(limit, DEFAULT_LIST_ROWS) : DEFAULT_LIST_ROWS));
        } else if (view === 'Pinned_Apps') {
            for (const item of this._services.pinned.items()) {
                const app = item.kind === 'app' ? lookupApp(this._services, item.id) : null;
                if (app)
                    apps.push(app);
                if (apps.length >= DEFAULT_LIST_ROWS)
                    break;
            }
        }
        if (apps.length > 0) {
            ui.defaultBox.add_child(new St.Label({
                text: view === 'Pinned_Apps' ? _('Pinned Apps') : _('Frequent Apps'),
                style_class: 'spawn-section-title',
            }));
            const host = {
                launch: (app: Shell.App, ctrl: boolean) => this._launch(app, ctrl),
                openContext: () => {},
                tooltips: ui.tooltips,
            };
            const opts = {iconSize: iconSizeFor(s, 'icon-size-apps', DEFAULT_ROW_ICON_SIZE), description: showDescriptions(s)};
            for (const app of apps) {
                const row = new AppRow(app, host, {...opts, name: displayName(app, s)});
                ui.defaultBox.add_child(row.actor);
                this._defaultRows.push(row.actor);
            }
            // each row carries 1 px of the pitch below it: the last one has nothing to separate from
            this._defaultRows[this._defaultRows.length - 1]?.set_style('padding-bottom: 0;');
        }
        this._showView(ui, false);
    }

    private _launch(app: Shell.App, ctrl: boolean): void {
        try {
            launchApp(app, this._services.settings, ctrl);
        } catch (e) {
            error(`could not launch ${app.get_id()}`, e);
        }
        if (!(ctrl && this._services.settings.get('keep-open-on-ctrl-click')))
            this.close();
    }

    // ---- search (same flow as SpawnLayout) ----

    private _cancelSearch(): void {
        this._searchToken++;
        this._searchHandle?.cancel();
        this._searchHandle = null;
    }

    private _onText(ui: Ui, text: string): void {
        if (this._disposed)
            return;
        const query = text.trim();
        this._cancelSearch();
        this._setActivateWhenReady(false);
        // New rows under a resting pointer must not take the highlight from the best match.
        ui.highlight.keyMoved(null);
        if (query.length === 0) {
            ui.results.reset();
            this._showView(ui, false);
            return;
        }
        this._showView(ui, true);
        ui.results.beginQuery(query);
        ui.results.setSelectionVisible(true);
        const token = this._searchToken;
        try {
            this._searchHandle = this._services.search.search(query, batch => {
                if (token !== this._searchToken || this._disposed)
                    return;
                ui.results.addBatch(batch);
                if (this._activateWhenReady && ui.results.first()) {
                    const ctrl = this._activateCtrl;
                    this._setActivateWhenReady(false);
                    ui.results.activateSelected(ctrl);
                }
            });
        } catch (e) {
            error('runner search failed', e);
        }
    }

    /**
     * Return in the entry: activate the highlighted result of the CURRENT query (or the first default app).
     * `ctrl`: Ctrl+Return, as a Ctrl+click on the row.
     */
    private _onActivate(ui: Ui, ctrl = false): void {
        if (ui.search.text.trim().length === 0) {
            this._defaultRows[0]?.emit('clicked', ctrl ? 2 : 1);
            return;
        }
        this._flush();
        if (!ui.results.activateSelected(ctrl))
            this._setActivateWhenReady(true, ctrl);
    }

    private _flush(): void {
        try {
            this._searchHandle?.flush();
        } catch (e) {
            error('runner search flush failed', e);
        }
    }

    /** "Return was pressed before the first row arrived"; expires so a late provider cannot launch unseen. */
    private _setActivateWhenReady(on: boolean, ctrl = false): void {
        this._cancelActivateWait?.();
        this._cancelActivateWait = null;
        this._activateWhenReady = on;
        this._activateCtrl = on && ctrl;
        if (on) {
            this._cancelActivateWait = this._scope.timeout(ACTIVATE_WAIT_MS, () => {
                this._cancelActivateWait = null;
                this._activateWhenReady = false;
            });
        }
    }

    // ---- keyboard ----

    private _rows(ui: Ui): St.Widget[] {
        return ui.search.text.trim() === '' ? this._defaultRows : ui.results.rows();
    }

    /** Move focus along [entry, ...rows]. `wrap` (Tab) wraps around; the arrows stop at the ends. */
    private _navigate(ui: Ui, dir: 1 | -1, wrap: boolean): void {
        const rows = this._rows(ui);
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const at = focus ? rows.findIndex(r => r === focus || r.contains(focus)) : -1;
        if (at < 0) {
            // On the entry: Down / Tab goes to the highlighted result (or the first default row), Shift+Tab
            // wraps to the last.
            const selected = ui.search.text.trim() === '' ? null : ui.results.selected();
            if (dir === 1)
                (selected ?? rows[0])?.grab_key_focus();
            else if (wrap)
                rows[rows.length - 1]?.grab_key_focus();
            return;
        }
        const next = at + dir;
        if (next < 0)
            ui.search.focus();
        else if (next >= rows.length) {
            if (wrap)
                ui.search.focus();
        } else {
            rows[next]?.grab_key_focus();
        }
    }

    private _onSearchKey(ui: Ui, key: number, shift: boolean, ctrl = false): boolean {
        const searching = ui.search.text.trim() !== '';
        switch (key) {
        case Clutter.KEY_Down:
        case Clutter.KEY_Up:
            this._flush();
            if (searching)
                this._showSelection(ui, ui.results.moveSelection(key === Clutter.KEY_Down ? 1 : -1, false));
            else if (key === Clutter.KEY_Down)
                this._navigate(ui, 1, false);
            return true;
        case Clutter.KEY_Page_Up:
        case Clutter.KEY_Page_Down: {
            if (!searching)
                return false;
            this._flush();
            const rows = ui.results.rows();
            const from = ui.results.selected();
            const index = from ? rows.indexOf(from) : -1;
            if (index < 0)
                return true;
            const page = Math.max(ui.scroll.height - (from as St.Widget).height, (from as St.Widget).height);
            const centres = rows.map(r => {
                const [x, y] = r.get_transformed_position();
                return {x: x + r.width / 2, y: y + r.height / 2};
            });
            this._showSelection(ui, rows[pageTarget(centres, index, key === Clutter.KEY_Page_Down ? 1 : -1, page)] ?? null);
            return true;
        }
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            // Plain Return reaches the entry's `activate`; Ctrl+Return does not.
            if (!ctrl)
                return false;
            this._onActivate(ui, true);
            return true;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._flush();
            this._navigate(ui, key === Clutter.KEY_ISO_Left_Tab || shift ? -1 : 1, true);
            ui.highlight.keyMoved();
            return true;
        }
        return false;
    }

    /** The search highlight moved to `row` by a key: announced, the only highlight, scrolled into view. */
    private _showSelection(ui: Ui, row: St.Widget | null): void {
        if (!row)
            return;
        ui.results.select(row, true);
        ui.highlight.keyMoved(row);
        scrollIntoView(ui.scroll, row);
    }

    /** Keys that reach the content from a focused row (the entry's own keys go through _onSearchKey). */
    private _onKeyPress(ui: Ui, event: Clutter.Event): boolean {
        if (this._disposed)
            return Clutter.EVENT_PROPAGATE;
        // Only pointed at (the content holds the focus): the key acts on the pointed-at row.
        if (ui.highlight.takeKey(event) === 'redeliver')
            return Clutter.EVENT_STOP;
        const sym = event.get_key_symbol();
        const state = event.get_state();
        switch (sym) {
        case Clutter.KEY_Down:
            this._navigate(ui, 1, false);
            ui.highlight.keyMoved();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._navigate(ui, -1, false);
            ui.highlight.keyMoved();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._navigate(ui, sym === Clutter.KEY_ISO_Left_Tab || (state & Clutter.ModifierType.SHIFT_MASK) ? -1 : 1, true);
            ui.highlight.keyMoved();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
        case Clutter.KEY_End: {
            // A focused row: the first / last one (the entry keeps Home / End for its text).
            const rows = this._rows(ui);
            (sym === Clutter.KEY_Home ? rows[0] : rows[rows.length - 1])?.grab_key_focus();
            ui.highlight.keyMoved();
            return Clutter.EVENT_STOP;
        }
        case Clutter.KEY_Escape:
            // like the main menu: the first Escape clears the query, Escape on an empty one closes
            if (ui.search.text.length > 0) {
                ui.search.clear();
                ui.search.focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_BackSpace:
            if (!ui.search.hasFocus && ui.search.text.length > 0) {
                ui.search.deleteBackward();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (state & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK))
            return Clutter.EVENT_PROPAGATE;
        const unicode = Clutter.keysym_to_unicode(sym);
        if (unicode >= 32 && unicode !== 127 && !ui.search.hasFocus) {
            ui.search.insert(String.fromCodePoint(unicode));
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    private _onFocusChanged(ui: Ui): void {
        if (!this._open || this._disposed)
            return;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus) {
            // The focused row went away (results replaced): keep the keyboard alive.
            ui.scope.idle(() => {
                if (this._open && !this._disposed && !global.stage.key_focus)
                    ui.search.focus();
            });
            return;
        }
        if (!ui.content.contains(focus))
            return;
        scrollIntoView(ui.scroll, focus);
        // The search highlight follows a result row that takes the focus and shows only while no row has it.
        const inResults = ui.results.actor.contains(focus);
        if (inResults)
            ui.results.select(focus);
        ui.results.setSelectionVisible(!inResults);
    }

    // ---- teardown ----

    private _teardown(): void {
        this._disposed = true;
        this._open = false;
        this._ui?.scope.dispose();
        this._ui = null;
        this._listeners.clear();
    }
}
