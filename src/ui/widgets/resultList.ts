// ResultList: streaming search results. One section per SearchBatch (provider title + rows),
// ordered apps > windows > recent files > shell providers regardless of arrival order. The
// first row carries the :selected pseudo class (Return in the search entry activates it) until
// a row takes keyboard focus. Optional term highlighting (highlight-search-result-terms) and
// descriptions (show-search-result-details).
//
// Public API:
//   new ResultList(scope: Scope, settings: SpawnSettings, host: ResultHost)
//   list.actor: St.Widget
//   list.reset(): void
//   list.addBatch(batch: SearchBatch): void
//   list.rows(): St.Widget[]            visible rows in display order (keyboard nav)
//   list.first(): St.Widget | null
//   list.activateFirst(): boolean       activate the selected (first) result
//   list.setSelectionVisible(v)          show/hide the :selected marker on the first row
//   list.hasResults: boolean
//   list.destroy()
//   ResultHost: ShortcutHost & {openResultContext?(row: St.Widget, result: SearchResult): void}

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {SearchBatch, SearchResult} from '../../search/engine.js';
import {error} from '../../core/log.js';
import {iconSizeFor} from '../util.js';
import {makeItemButton, wireItem} from './interact.js';
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

const PROVIDER_ORDER = ['apps', 'windows', 'recentFiles'];
const EMPTY_DELAY_MS = 700;

function orderOf(providerId: string): number {
    const i = PROVIDER_ORDER.indexOf(providerId);
    return i >= 0 ? i : PROVIDER_ORDER.length;
}

export function highlightMarkup(text: string, query: string): string {
    const terms = query.trim().split(/\s+/).filter(t => t.length > 0).sort((a, b) => b.length - a.length);
    if (terms.length === 0)
        return GLib.markup_escape_text(text, -1);
    const lower = text.toLowerCase();
    const marks: boolean[] = new Array(text.length).fill(false);
    for (const term of terms) {
        const t = term.toLowerCase();
        let from = 0;
        for (;;) {
            const at = lower.indexOf(t, from);
            if (at < 0)
                break;
            for (let i = at; i < at + t.length && i < marks.length; i++)
                marks[i] = true;
            from = at + t.length;
        }
    }
    let out = '';
    let open = false;
    for (let i = 0; i < text.length; i++) {
        if (marks[i] && !open) {
            out += '<b>';
            open = true;
        } else if (!marks[i] && open) {
            out += '</b>';
            open = false;
        }
        out += GLib.markup_escape_text(text[i], -1);
    }
    return open ? `${out}</b>` : out;
}

export class ResultList {
    readonly actor: St.BoxLayout;
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _host: ResultHost;
    private readonly _sections: Section[] = [];
    private readonly _empty: St.Label;
    private readonly _results = new Map<St.Button, SearchResult>();
    private _cancelEmpty: (() => void) | null = null;
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
        });
        this._empty = new St.Label({text: 'No results', style_class: 'spawn-empty-label', x_align: Clutter.ActorAlign.CENTER, visible: false});
        this.actor.add_child(this._empty);
        scope.add(() => {
            this._cancelEmpty?.();
            this.actor.destroy();
        }, 'ResultList');
    }

    get hasResults(): boolean {
        return this._sections.some(s => s.rows.length > 0);
    }

    reset(): void {
        this._host.tooltips?.hide();
        this._cancelEmpty?.();
        this._cancelEmpty = null;
        for (const s of this._sections)
            s.box.destroy();
        this._sections.length = 0;
        this._results.clear();
        this._selected = null;
        this._selectionVisible = true;
        this._empty.hide();
        this._cancelEmpty = this._scope.timeout(EMPTY_DELAY_MS, () => {
            this._cancelEmpty = null;
            this._empty.visible = !this.hasResults;
        });
    }

    addBatch(batch: SearchBatch): void {
        const max = Math.max(1, this._settings.get('max-search-results'));
        const results = batch.results.slice(0, max);
        if (results.length === 0)
            return;
        this._empty.hide();

        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-result-section'});
        box.add_child(new St.Label({text: batch.providerTitle, style_class: 'spawn-section-title'}));
        const section: Section = {providerId: batch.providerId, order: orderOf(batch.providerId), box, rows: []};
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
        this._updateSelection();
    }

    rows(): St.Widget[] {
        return this._sections.flatMap(s => s.rows);
    }

    first(): St.Widget | null {
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
        this._host.close();
        try {
            result.activate();
        } catch (e) {
            error('search result activation failed', e);
        }
    }

    private _makeRow(result: SearchResult, query: string): St.Button {
        const button = makeItemButton('spawn-row spawn-result-row');
        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const icon = new St.Icon({
            style_class: 'spawn-row-icon',
            icon_size: iconSizeFor(this._settings, 'icon-size-apps', 28),
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (result.icon)
            icon.gicon = result.icon;
        else
            icon.icon_name = 'application-x-executable';
        box.add_child(icon);

        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        const title = new St.Label({style_class: 'spawn-row-label'});
        if (this._settings.get('highlight-search-result-terms'))
            title.clutter_text.set_markup(highlightMarkup(result.title, query));
        else
            title.text = result.title;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        if (result.description && this._settings.get('show-search-result-details')) {
            const d = new St.Label({text: result.description, style_class: 'spawn-row-description'});
            d.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(d);
        }
        box.add_child(text);
        button.set_child(box);

        this._host.tooltips?.attach(button, title, result.description ? () => `${result.title}\n${result.description}` : undefined);
        wireItem(button, {
            activate: () => this._activate(result),
            context: this._host.openResultContext ? () => this._host.openResultContext?.(button, result) : undefined,
        });
        return button;
    }
}
