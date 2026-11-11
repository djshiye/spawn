// SearchController: the search results view and the glue between the search entry and it.
//
// Responsibility: the "results" view (a ResultList in a scroll view, built the first time a query is typed),
// the reaction to the entry's text (switch to the results, begin the query, back to the start view when it
// is emptied, `search-hidden`), Return / Ctrl+Return (activate the highlighted result, or wait for the first
// row), the keys inside the entry while results show (Up / Down / Page Up / Down move the highlight, Tab
// leaves the entry), and a result row taking the highlight from the pointer. Running the query is the
// shared SearchSession (ui/searchSession.ts).
//
// Public API:
//   new SearchController(scope, services, state, deps)   deps: {search, highlight, scrolls, session, resultHost, host}
//   search.ensure(): St.ScrollView         build the results view the first time; returns its scroll view
//   search.results / search.scroll         the list and its scroll view (null before the first query)
//   search.onText(text)                    the entry's text changed
//   search.onActivate(ctrl?)               Return in the entry (`ctrl`: Ctrl+Return)
//   search.onKey(key, shift, ctrl?)        a key in the entry; true when handled
//   search.onHover(item): boolean          the pointer is on `item`: a result row takes the search highlight
//   SearchControllerHost                   what the controller asks of the layout (views, focus, Tab)

import Clutter from 'gi://Clutter';
import type St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {searchStep} from '../../model/listNav.js';
import type {SearchSession} from '../searchSession.js';
import {scrollIntoView} from '../util.js';
import type {PointerHighlight} from '../widgets/highlight.js';
import {ResultList, type ResultHost} from '../widgets/resultList.js';
import type {SearchBox} from '../widgets/searchBox.js';
import {pageTo} from './geometry.js';
import type {ScrollFactory} from './scrolls.js';
import type {LayoutState, ViewId} from './types.js';

export interface SearchControllerHost {
    setView(view: ViewId): void;
    defaultView(): ViewId;
    focusMain(last?: boolean): void;
    /** Tab in the entry: move to the next / previous pane. */
    cyclePane(delta: number): void;
}

export interface SearchControllerDeps {
    search: SearchBox;
    highlight: PointerHighlight;
    scrolls: ScrollFactory;
    session: SearchSession;
    resultHost: ResultHost;
    host: SearchControllerHost;
}

export class SearchController {
    results: ResultList | null = null;
    scroll: St.ScrollView | null = null;
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _search: SearchBox;
    private readonly _highlight: PointerHighlight;
    private readonly _scrolls: ScrollFactory;
    private readonly _session: SearchSession;
    private readonly _resultHost: ResultHost;
    private readonly _host: SearchControllerHost;

    constructor(scope: Scope, services: Services, state: LayoutState, deps: SearchControllerDeps) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._search = deps.search;
        this._highlight = deps.highlight;
        this._scrolls = deps.scrolls;
        this._session = deps.session;
        this._resultHost = deps.resultHost;
        this._host = deps.host;
    }

    ensure(): St.ScrollView {
        if (!this.scroll) {
            const results = new ResultList(this._scope, this._services.settings, this._resultHost);
            results.setReversed(!this._state.searchTop);
            const scroll = this._scrolls.make(results.actor, 'spawn-results');
            // New rows (a batch, the reversed list growing upwards): keep the highlighted one in view.
            scroll.vadjustment.connect('notify::upper', () => {
                const row = this._state.view === 'results' ? results.selected() : null;
                if (row)
                    scrollIntoView(scroll, row);
            });
            this.results = results;
            this.scroll = scroll;
        }
        return this.scroll;
    }

    onText(text: string): void {
        if (this._state.destroyed)
            return;
        const query = text.trim();
        this._session.cancel();
        this._session.arm(false);
        // Typing: new rows appearing under a resting pointer must not take the highlight from the best match.
        this._highlight.keyMoved(null);
        if (query.length === 0) {
            // Drop the old rows now: the next query must not flash them (dimmed) or let Down focus them.
            this.results?.reset();
            if (this._state.view === 'results')
                this._host.setView(this._host.defaultView());
            if (this._services.settings.get('search-hidden') && this._search.actor.visible) {
                this._search.actor.visible = false;
                this._host.focusMain();
            }
            return;
        }
        this._host.setView('results');
        const results = this.results as ResultList;
        this.scroll?.vadjustment.set_value(0);
        // Keep the previous rows (dimmed) until the first batch of this query arrives: no blank
        // flash between keystrokes.
        results.beginQuery(query);
        results.setSelectionVisible(true);
        this._session.start(query, results);
    }

    /**
     * Return in the search entry: activate the highlighted result of the CURRENT query (the first
     * one until Up / Down / the pointer moved the highlight). Typing and pressing Return inside the
     * debounce window must not do nothing: flush the pending query (synchronous providers deliver
     * before flush() returns); if slower providers still owe the first row, activate it as soon as
     * it arrives. `ctrl` (Ctrl+Return): as a Ctrl+click on the row.
     */
    onActivate(ctrl = false): void {
        if (this._state.view !== 'results' || this._search.text.trim().length === 0)
            return;
        const results = this.results;
        if (!results)
            return;
        this._session.activate(results, ctrl);
    }

    /**
     * Keys in the search entry. While results show, the typing focus stays in the entry: Up / Down move
     * the highlight one result (wrapping; the first is highlighted already, so the key pointing away from
     * the entry goes to the second; with the entry below the list, whose order is mirrored, that is Up),
     * Page Up / Down one page of results, Return / Ctrl+Return activate the highlighted one, Tab goes to
     * the results. Without a query, Down (and Up when the entry is below) enter the list.
     */
    onKey(key: number, shift: boolean, ctrl = false): boolean {
        const results = this._state.view === 'results' ? this.results : null;
        switch (key) {
        case Clutter.KEY_Down:
        case Clutter.KEY_Up: {
            const down = key === Clutter.KEY_Down;
            if (results) {
                // Deliver the synchronous batches of the pending query first: the highlight must move
                // over what the entry says now, not over the rows of the previous keystroke.
                this._session.flush();
                this._showSelection(results.moveSelection(searchStep(down ? 'down' : 'up', this._state.searchTop), false));
            } else if (down || !this._state.searchTop) {
                this._host.focusMain(!down);
                this._highlight.keyMoved();
            }
            return true;
        }
        case Clutter.KEY_Page_Up:
        case Clutter.KEY_Page_Down:
            if (!results)
                return false;
            this._session.flush();
            this._showSelection(pageTo(results.visualRows(), results.selected(), key === Clutter.KEY_Page_Down ? 1 : -1));
            return true;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            // Plain Return reaches the entry's `activate`; Ctrl+Return does not.
            if (!ctrl)
                return false;
            this.onActivate(true);
            return true;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._session.flush();
            this._host.cyclePane(key === Clutter.KEY_ISO_Left_Tab || shift ? -1 : 1);
            this._highlight.keyMoved();
            return true;
        }
        return false;
    }

    /** The search highlight moved to `row` by a key: the hover tint elsewhere goes, the row scrolls into view. */
    private _showSelection(row: Clutter.Actor | null): void {
        if (!row)
            return;
        this.results?.select(row, true);
        this._highlight.keyMoved(row);
        scrollIntoView(this.scroll, row);
    }

    /** The pointer is on `item` (widgets/highlight.ts): a search result takes the search highlight. */
    onHover(item: St.Widget): boolean {
        const results = this._state.view === 'results' ? this.results : null;
        if (!results || !results.rows().includes(item))
            return false;
        results.select(item);
        // Typing focus in the entry stays; a focus ring on another row goes (the generic rule).
        return this._search.hasFocus;
    }
}
