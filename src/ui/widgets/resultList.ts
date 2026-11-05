// ResultList: streaming search results. One section per SearchBatch (provider title + rows),
// ordered by SearchBatch.order (the engine's provider registration order: apps > windows >
// recent files > GNOME shell providers in their sort-order) regardless of arrival order. The
// first row carries the :selected pseudo class (Return in the search entry activates it) until
// a row takes keyboard focus. Optional term highlighting (highlight-search-result-terms) and
// descriptions (show-search-result-details; results with alwaysShowDescription, e.g. the
// folder of a recent file, always show theirs). Row icons come from result.createIcon(size)
// when present (GNOME remote providers: Characters glyphs, Files icons), else result.icon.
//
// Flicker-free queries: instead of reset() on every keystroke, call beginQuery(). The rows of
// the previous query stay on screen, dimmed ("stale"), until the first batch of the new query
// arrives (they are then replaced at once) or STALE_MS (150 ms) elapse (they are then dropped
// and the pending / "No results" state follows). While stale, first() returns null and
// activateFirst() does nothing, so Return can never activate a row of an OLD query: call
// SearchHandle.flush() (engine) first, which delivers the synchronous batches before it
// returns, then activateFirst().
//
// Public API:
//   new ResultList(scope: Scope, settings: SpawnSettings, host: ResultHost)
//   list.actor: St.Widget
//   list.beginQuery(): void             a new query starts: keep old rows dimmed, see above
//   list.reset(): void                  hard clear (menu closed / view left): rows gone now
//   list.addBatch(batch: SearchBatch): void   empty batches are ignored
//   list.rows(): St.Widget[]            rows of the CURRENT query in display order (keyboard
//                                       nav); [] while stale. Stale rows are also made
//                                       non-reactive / non-focusable, so neither the keyboard
//                                       nor the mouse can activate a result of an old query
//   list.first(): St.Widget | null      first row of the CURRENT query; null while stale
//   list.activateFirst(): boolean       activate the selected (first) result
//   list.setSelectionVisible(v)          show/hide the :selected marker on the first row
//   list.hasResults: boolean            current (non-stale) rows exist
//   list.hasPending: boolean            beginQuery() was called and no batch with rows has
//                                       arrived yet (stays true for a query without matches;
//                                       use SearchHandle.pending to know about the debounce)
//   list.destroy()
//   highlightMarkup(text, query)        re-export of search/highlight.ts
//   ResultHost: ShortcutHost & {openResultContext?(row: St.Widget, result: SearchResult): void}

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {SearchBatch, SearchResult} from '../../search/engine.js';
import {error} from '../../core/log.js';
import {highlightMarkup} from '../../search/highlight.js';
import {iconSizeFor} from '../util.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import type {ShortcutHost} from './shortcutRow.js';

export type ResultHost = ShortcutHost & {
    openResultContext?(row: St.Widget, result: SearchResult): void;
};

interface Section {
    providerId: string;
    order: number;
    box: St.BoxLayout;
    rows: St.Button[];
}

const EMPTY_DELAY_MS = 700;
const STALE_MS = 150;
const STALE_OPACITY = 110;

export {highlightMarkup};

export class ResultList {
    readonly actor: St.BoxLayout;
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _host: ResultHost;
    private readonly _sections: Section[] = [];
    private readonly _empty: St.Label;
    private readonly _results = new Map<St.Button, SearchResult>();
    private _cancelEmpty: (() => void) | null = null;
    private _cancelStale: (() => void) | null = null;
    private _stale = false;
    private _pending = false;
    private _selected: St.Button | null = null;
    private _selectionVisible = true;

    constructor(scope: Scope, settings: SpawnSettings, host: ResultHost) {
        this._scope = scope;
        this._settings = settings;
        this._host = host;
        this.actor = new St.BoxLayout({
            style_class: 'spawn-result-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this._empty = new St.Label({
            text: 'No results',
            style_class: 'spawn-empty-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            visible: false,
        });
        this.actor.add_child(this._empty);
        scope.add(() => {
            this._cancelEmpty?.();
            this._cancelStale?.();
            this.actor.destroy();
        }, 'ResultList');
    }

    get hasResults(): boolean {
        return !this._stale && this._sections.some(s => s.rows.length > 0);
    }

    get hasPending(): boolean {
        return this._pending;
    }

    beginQuery(): void {
        this._host.tooltips?.hide();
        this._pending = true;
        this._empty.hide();
        this._cancelEmpty?.();
        this._cancelEmpty = null;
        if (!this._sections.some(s => s.rows.length > 0)) {
            this._clearSections();
            this._armEmpty();
            return;
        }
        if (this._stale)
            return; // already waiting; the drop timer keeps its original deadline
        this._stale = true;
        for (const s of this._sections) {
            s.box.opacity = STALE_OPACITY;
            for (const row of s.rows) {
                row.reactive = false;
                row.can_focus = false;
            }
        }
        this._updateSelection();
        this._cancelStale = this._scope.timeout(STALE_MS, () => {
            this._cancelStale = null;
            this._clearSections();
            this._armEmpty();
        });
    }

    reset(): void {
        this._host.tooltips?.hide();
        this._pending = false;
        this._clearSections();
        this._selectionVisible = true;
        this._empty.hide();
        this._armEmpty();
    }

    addBatch(batch: SearchBatch): void {
        const max = Math.max(1, this._settings.get('max-search-results'));
        const results = batch.results.slice(0, max);
        if (results.length === 0)
            return;
        if (this._stale)
            this._clearSections();
        this._pending = false;
        this._cancelEmpty?.();
        this._cancelEmpty = null;
        this._empty.hide();

        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-result-section'});
        box.add_child(new St.Label({text: batch.providerTitle, style_class: 'spawn-section-title'}));
        const section: Section = {providerId: batch.providerId, order: batch.order, box, rows: []};
        for (const result of results) {
            const row = this._makeRow(result, batch.query);
            box.add_child(row);
            section.rows.push(row);
            this._results.set(row, result);
        }

        // Insert keeping provider order (the label for "No results" stays last).
        let at = 0;
        while (at < this._sections.length && this._sections[at].order <= section.order)
            at++;
        this._sections.splice(at, 0, section);
        this.actor.insert_child_at_index(box, at);
        this._trimTail();
        this._updateSelection();
    }

    rows(): St.Widget[] {
        if (this._stale)
            return [];
        return this._sections.flatMap(s => s.rows);
    }

    first(): St.Widget | null {
        if (this._stale)
            return null;
        return this._sections.find(s => s.rows.length > 0)?.rows[0] ?? null;
    }

    activateFirst(): boolean {
        const row = this.first() as St.Button | null;
        const result = row ? this._results.get(row) : null;
        if (!result)
            return false;
        this._activate(result);
        return true;
    }

    /** Re-evaluate which row shows as selected: the first, unless a row has keyboard focus. */
    updateSelection(): void {
        this._updateSelection();
    }

    destroy(): void {
        this.actor.destroy();
    }

    /** Show or hide the :selected marker on the first row (hidden while a row has focus). */
    setSelectionVisible(visible: boolean): void {
        this._selectionVisible = visible;
        this._updateSelection();
    }

    /**
     * Every row carries 1 px of the pitch below it; the very last one has nothing to separate from,
     * and a popup that sizes itself to its content (the runner) must not grow by it.
     */
    private _trimTail(): void {
        const rows = this._sections.flatMap(s => s.rows);
        for (const row of rows)
            row.set_style(null);
        rows[rows.length - 1]?.set_style('padding-bottom: 0;');
    }

    private _clearSections(): void {
        this._cancelStale?.();
        this._cancelStale = null;
        this._stale = false;
        for (const s of this._sections)
            s.box.destroy();
        this._sections.length = 0;
        this._results.clear();
        this._selected = null;
    }

    private _armEmpty(): void {
        this._cancelEmpty?.();
        this._cancelEmpty = this._scope.timeout(EMPTY_DELAY_MS, () => {
            this._cancelEmpty = null;
            this._empty.visible = !this.hasResults;
        });
    }

    private _makeIcon(result: SearchResult): St.Widget {
        const size = iconSizeFor(this._settings, 'icon-size-apps', 28);
        if (typeof result.createIcon === 'function') {
            try {
                const made = result.createIcon(size);
                if (made instanceof St.Widget) {
                    made.add_style_class_name('spawn-row-icon');
                    made.y_align = Clutter.ActorAlign.CENTER;
                    return made;
                }
            } catch (e) {
                error('creating a result icon failed', e);
            }
        }
        const icon = new St.Icon({style_class: 'spawn-row-icon', icon_size: size, y_align: Clutter.ActorAlign.CENTER});
        if (result.icon)
            icon.gicon = result.icon;
        else
            icon.icon_name = 'application-x-executable';
        return icon;
    }

    private _updateSelection(): void {
        const first = this.first() as St.Button | null;
        if (this._selected && (this._selected !== first || !this._selectionVisible)) {
            this._selected.remove_style_pseudo_class('selected');
            this._selected = null;
        }
        if (!this._selected && first && this._selectionVisible) {
            this._selected = first;
            first.add_style_pseudo_class('selected');
        }
    }

    private _activate(result: SearchResult): void {
        if (this._stale)
            return; // a row of the previous query (cannot normally be reached: see beginQuery)
        this._host.close();
        try {
            result.activate();
        } catch (e) {
            error('search result activation failed', e);
        }
    }

    private _makeRow(result: SearchResult, query: string): St.Button {
        const button = makeItemButton('spawn-result-row');
        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const icon = this._makeIcon(result);
        box.add_child(icon);

        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        const title = new St.Label({style_class: 'spawn-row-label'});
        if (this._settings.get('highlight-search-result-terms'))
            title.clutter_text.set_markup(highlightMarkup(result.title, query));
        else
            title.text = result.title;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        if (result.description && (result.alwaysShowDescription || this._settings.get('show-search-result-details'))) {
            const d = new St.Label({text: result.description, style_class: 'spawn-row-description'});
            d.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(d);
        }
        box.add_child(text);
        button.set_child(makeFace('spawn-row-surface', box));

        this._host.tooltips?.attach(button, title, result.description ? () => `${result.title}\n${result.description}` : undefined);
        wireItem(button, {
            activate: () => this._activate(result),
            context: this._host.openResultContext ? () => {
                if (!this._stale)
                    this._host.openResultContext?.(button, result);
            } : undefined,
        });
        return button;
    }
}
