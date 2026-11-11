// ResultList: streaming search results. One section per SearchBatch (provider title + rows),
// ordered by SearchBatch.order (the engine's provider registration order: apps > windows >
// recent files > GNOME shell providers in their sort-order) regardless of arrival order.
// The highlight: one row carries the :selected pseudo class (and the accessible SELECTED state) and is
// what Return in the search entry activates: the first (best) row of a new query, moved with
// moveSelection() / select() (the typing focus stays in the entry), hidden while a row has keyboard focus.
// Reversed (search entry below the list): the order is mirrored, best match at the bottom next to the entry,
// sections in reverse with their title still above their rows, and the rows pushed to the bottom of the view;
// rows() stays best-first, visualRows() is the order on screen. Optional term highlighting (highlight-search-result-terms) and
// descriptions (show-search-result-details; results with alwaysShowDescription, e.g. the
// folder of a recent file, always show theirs). Row icons come from result.createIcon(size)
// when present (GNOME remote providers: Characters glyphs, Files icons), else result.icon.
//
// Flicker-free queries: instead of reset() on every keystroke, call beginQuery(). The rows of
// the previous query stay on screen, dimmed ("stale"), section by section: a provider's section is
// replaced at once when that provider's batch of the new query arrives (the apps run on every key,
// slower providers after the engine's debounce, so their old rows stay in place meanwhile), and
// whatever is still stale STALE_MS (150 ms) after beginQuery() is dropped (then the pending /
// "No results" state follows). Stale rows are never first() and cannot be activated, so Return can
// never activate a row of an OLD query: call SearchHandle.flush() (engine) first, which delivers
// the synchronous batches before it returns, then activateFirst().
//
// Public API:
//   new ResultList(scope: Scope, settings: SpawnSettings, host: ResultHost)
//   list.actor: St.Widget
//   list.beginQuery(): void             a new query starts: keep old rows dimmed, see above
//   list.reset(): void                  hard clear (menu closed / view left): rows gone now
//   list.addBatch(batch: SearchBatch): void   empty batches are ignored
//   list.rows(): St.Widget[]            rows of the CURRENT query, best first; never stale ones.
//                                       Stale rows are also made non-reactive / non-focusable,
//                                       so neither the keyboard nor the mouse can activate a
//                                       result of an old query
//   list.visualRows(): St.Widget[]      rows() in screen order (reversed: best last)
//   list.first(): St.Widget | null      first (best) row of the CURRENT query; null while stale
//   list.activateFirst(): boolean       activate the first (best) result
//   list.selected(): St.Widget | null   the highlighted row (the first until moved); null while stale
//   list.select(row, announce?): void   move the highlight to `row` (announce: the screen reader is told
//                                       "Name, 2 of 5")
//   list.moveSelection(delta): St.Widget | null   one row towards worse (1) / better (-1) matches,
//                                       wrapping; announced
//   list.activateSelected(ctrl?): boolean   activate the highlighted result (`ctrl`: as a Ctrl+click on
//                                       an app elsewhere: a new window, and with keep-open-on-ctrl-click
//                                       the menu stays open)
//   list.setReversed(on): void          mirrored order (see above)
//   list.setSelectionVisible(v)          show/hide the :selected marker (hidden while a row has focus)
//   list.hasResults: boolean            current (non-stale) rows exist
//   list.hasPending: boolean            beginQuery() was called and no batch with rows has
//                                       arrived yet (stays true for a query without matches;
//                                       use SearchHandle.pending to know about the debounce)
//   list.destroy()
//   highlightMarkup(text, query)        re-export of search/highlight.ts
//   ResultHost: ShortcutHost & {openResultContext?(row: St.Widget, result: SearchResult): void}

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {SearchBatch, SearchResult} from '../../search/engine.js';
import {error} from '../../core/log.js';
import {highlightMarkup} from '../../search/highlight.js';
import {iconSizeFor, showDescriptions} from '../util.js';
import {stepIndex} from '../../model/listNav.js';
import {markList, nameItem, ResultAnnouncer} from './a11y.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import {makeNewBadge, newAccessibleName} from './newBadge.js';
import type {ShortcutHost} from './shortcutRow.js';

export type ResultHost = ShortcutHost & {
    /** One-line "No results" without icon and hint (the runner, which sizes itself to its content). */
    compactEmpty?: boolean;
    openResultContext?(row: St.Widget, result: SearchResult): void;
    /** Make a row of an app result a drag source that pins it (desktop id, display name). */
    dragApp?(row: St.Widget, id: string, name: string): void;
    /** Is the app with this desktop id new (a "New" pill after its name in the results)? */
    isNewApp?(id: string): boolean;
};

interface Section {
    providerId: string;
    order: number;
    box: St.BoxLayout;
    rows: St.Button[];
    /** Belongs to the previous query (dimmed, inert) until this provider's new batch replaces it. */
    stale: boolean;
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
    private readonly _empty: St.BoxLayout;
    private readonly _emptyTitle: St.Label;
    private _query = '';
    private readonly _results = new Map<St.Button, SearchResult>();
    private _cancelEmpty: (() => void) | null = null;
    private _cancelStale: (() => void) | null = null;
    private _pending = false;
    /** The row carrying :selected now (null while hidden). */
    private _marked: St.Button | null = null;
    /** The highlighted row once moved off the first one (null: the first). */
    private _pick: St.Button | null = null;
    private readonly _announcer: ResultAnnouncer;
    private _selectionVisible = true;
    private _reversed = false;
    /** Pushes the rows to the bottom of the view while reversed. */
    private readonly _spacer: St.Widget;

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
        markList(this.actor, _('Search results'));
        this._spacer = new St.Widget({y_expand: true, visible: false});
        this.actor.add_child(this._spacer);
        this._announcer = new ResultAnnouncer(scope);
        // Empty state: a soft icon, "No results for “query”" and a hint. The runner sizes itself to its
        // content, so it gets the compact one-line version (no icon, no hint).
        const compact = !!host.compactEmpty;
        this._empty = new St.BoxLayout({
            style_class: compact ? 'spawn-empty-state spawn-empty-compact' : 'spawn-empty-state',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        if (!compact)
            this._empty.add_child(new St.Icon({icon_name: 'edit-find-symbolic', style_class: 'spawn-empty-icon', x_align: Clutter.ActorAlign.CENTER}));
        this._emptyTitle = new St.Label({text: _('No results'), style_class: 'spawn-empty-title', x_align: Clutter.ActorAlign.CENTER});
        this._emptyTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._empty.add_child(this._emptyTitle);
        if (!compact)
            this._empty.add_child(new St.Label({text: _('Try a different or shorter word'), style_class: 'spawn-empty-hint', x_align: Clutter.ActorAlign.CENTER}));
        this.actor.add_child(this._empty);
        scope.add(() => {
            this._cancelEmpty?.();
            this._cancelStale?.();
            this.actor.destroy();
        }, 'ResultList');
    }

    get hasResults(): boolean {
        return this._sections.some(s => !s.stale && s.rows.length > 0);
    }

    get hasPending(): boolean {
        return this._pending;
    }

    beginQuery(query = ''): void {
        this._query = query.trim();
        this._pick = null;
        this._host.tooltips?.hide();
        this._pending = true;
        this._announcer.hold();
        this._empty.hide();
        this._cancelEmpty?.();
        this._cancelEmpty = null;
        if (!this._sections.some(s => s.rows.length > 0)) {
            this._clearSections();
            this._armEmpty();
            return;
        }
        for (const s of this._sections) {
            if (s.stale)
                continue;
            s.stale = true;
            s.box.opacity = STALE_OPACITY;
            for (const row of s.rows) {
                row.reactive = false;
                row.can_focus = false;
            }
        }
        this._updateSelection();
        if (this._cancelStale)
            return; // already waiting; the drop timer keeps its original deadline
        this._cancelStale = this._scope.timeout(STALE_MS, () => {
            this._cancelStale = null;
            this._dropStale();
            if (!this.hasResults) {
                this._clearSections();
                this._armEmpty();
            }
        });
    }

    reset(): void {
        this._host.tooltips?.hide();
        this._pending = false;
        this._announcer.reset();
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
        // This provider's rows of the previous query make way; the other providers' stay until theirs arrive.
        for (const old of this._sections.filter(s => s.providerId === batch.providerId))
            this._removeSection(old);
        this._pending = false;
        this._cancelEmpty?.();
        this._cancelEmpty = null;
        this._empty.hide();

        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-result-section'});
        box.add_child(new St.Label({text: batch.providerTitle, style_class: 'spawn-section-title'}));
        markList(box, batch.providerTitle);
        const section: Section = {providerId: batch.providerId, order: batch.order, box, rows: [], stale: false};
        for (const result of results) {
            const row = this._makeRow(result, batch.query);
            section.rows.push(row);
            this._results.set(row, result);
        }
        this._fillSection(section);

        // Insert keeping provider order (the label for "No results" stays last).
        let at = 0;
        while (at < this._sections.length && this._sections[at].order <= section.order)
            at++;
        this._sections.splice(at, 0, section);
        this.actor.add_child(box);
        this._placeSections();
        this._updateSelection();
        this._announcer.found(this._sections.reduce((n, s) => n + (s.stale ? 0 : s.rows.length), 0));
    }

    /** What the screen reader was last told about the result count (dev hook). */
    get announcement(): string {
        return this._announcer.lastMessage;
    }

    rows(): St.Widget[] {
        return this._sections.flatMap(s => s.stale ? [] : s.rows);
    }

    visualRows(): St.Widget[] {
        const rows = this.rows();
        return this._reversed ? rows.reverse() : rows;
    }

    selected(): St.Widget | null {
        if (this._pick && this._results.has(this._pick) && !this._isStaleRow(this._pick))
            return this._pick;
        return this.first();
    }

    select(row: Clutter.Actor | null, announce = false): void {
        if (!row || !this._results.has(row as St.Button) || this._isStaleRow(row as St.Button))
            return;
        this._pick = row as St.Button;
        this._updateSelection();
        if (announce)
            this._announceSelection();
    }

    moveSelection(delta: number, announce = true): St.Widget | null {
        const rows = this.rows();
        const next = rows[stepIndex(rows.indexOf(this.selected() as St.Widget), delta, rows.length)] ?? null;
        this.select(next, announce);
        return next;
    }

    activateSelected(ctrl = false): boolean {
        const row = this.selected() as St.Button | null;
        const result = row ? this._results.get(row) : null;
        if (!result)
            return false;
        this._activate(result, ctrl);
        return true;
    }

    setReversed(on: boolean): void {
        if (this._reversed === on)
            return;
        this._reversed = on;
        for (const s of this._sections)
            this._fillSection(s);
        this._placeSections();
    }

    first(): St.Widget | null {
        return this._sections.find(s => !s.stale && s.rows.length > 0)?.rows[0] ?? null;
    }

    activateFirst(): boolean {
        const row = this.first() as St.Button | null;
        const result = row ? this._results.get(row) : null;
        if (!result)
            return false;
        this._activate(result);
        return true;
    }

    /** Re-evaluate which row shows as selected (none while a row has keyboard focus). */
    updateSelection(): void {
        this._updateSelection();
    }

    destroy(): void {
        this.actor.destroy();
    }

    /** Show or hide the :selected marker (hidden while a row has focus). */
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
        if (this._reversed)
            rows.reverse();
        for (const row of rows)
            row.set_style(null);
        rows[rows.length - 1]?.set_style('padding-bottom: 0;');
    }

    private _removeSection(section: Section): void {
        const i = this._sections.indexOf(section);
        if (i >= 0)
            this._sections.splice(i, 1);
        for (const row of section.rows) {
            this._results.delete(row);
            if (this._marked === row)
                this._marked = null;
            if (this._pick === row)
                this._pick = null;
        }
        section.box.destroy();
    }

    /** The STALE_MS deadline: drop the sections no new batch replaced. */
    private _dropStale(): void {
        this._host.tooltips?.hide();
        for (const s of this._sections.filter(x => x.stale))
            this._removeSection(s);
        this._placeSections();
        this._updateSelection();
    }

    private _clearSections(): void {
        this._cancelStale?.();
        this._cancelStale = null;
        for (const s of this._sections)
            s.box.destroy();
        this._sections.length = 0;
        this._results.clear();
        this._marked = null;
        this._pick = null;
        this._spacer.visible = false;
    }

    /** A section's rows below its title, best first (reversed: best last, next to the entry). */
    private _fillSection(section: Section): void {
        const rows = this._reversed ? [...section.rows].reverse() : section.rows;
        rows.forEach((row, i) => {
            if (row.get_parent() === section.box)
                section.box.set_child_at_index(row, i + 1);
            else
                section.box.insert_child_at_index(row, i + 1);
        });
    }

    /** Sections in provider order after the spacer (reversed: the last provider first); the empty state stays last. */
    private _placeSections(): void {
        const n = this._sections.length;
        this._sections.forEach((s, i) => this.actor.set_child_at_index(s.box, 1 + (this._reversed ? n - 1 - i : i)));
        this.actor.set_child_above_sibling(this._empty, null);
        this._spacer.visible = this._reversed && n > 0;
        this._trimTail();
    }

    /** "Firefox, 2 of 5": the highlighted row, for a screen reader (the focus stays in the entry). */
    private _announceSelection(): void {
        const row = this.selected() as St.Button | null;
        const result = row ? this._results.get(row) : null;
        if (!row || !result)
            return;
        const rows = this.rows();
        this._announcer.say(_('%s, %d of %d').format(row.accessible_name || result.title, rows.indexOf(row) + 1, rows.length));
    }

    private _armEmpty(): void {
        this._cancelEmpty?.();
        this._cancelEmpty = this._scope.timeout(EMPTY_DELAY_MS, () => {
            this._cancelEmpty = null;
            if (!this.hasResults) {
                // \u201C \u201D: curly quotes around the query
                this._emptyTitle.text = this._query ? _('No results for \u201C%s\u201D').replace('%s', this._query) : _('No results');
            }
            this._empty.visible = !this.hasResults;
            if (this._pending && !this.hasResults)
                this._announcer.found(0, 0);
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
        const want = this._selectionVisible ? this.selected() as St.Button | null : null;
        if (this._marked && this._marked !== want) {
            this._marked.remove_style_pseudo_class('selected');
            this._marked.remove_accessible_state(Atk.StateType.SELECTED);
            this._marked = null;
        }
        if (!this._marked && want) {
            this._marked = want;
            want.add_style_pseudo_class('selected');
            want.add_accessible_state(Atk.StateType.SELECTED);
        }
    }

    private _isStaleRow(row: St.Button): boolean {
        return this._sections.some(s => s.stale && s.rows.includes(row));
    }

    private _isStale(result: SearchResult): boolean {
        return this._sections.some(s => s.stale && s.rows.some(r => this._results.get(r) === result));
    }

    /** `ctrl` (Ctrl+Return, Ctrl+click, middle click): an app as with a Ctrl+click anywhere else in the menu. */
    private _activate(result: SearchResult, ctrl = false): void {
        if (this._isStale(result))
            return; // a row of the previous query (cannot normally be reached: see beginQuery)
        const app = ctrl && result.providerId === 'apps';
        if (!(app && this._settings.get('keep-open-on-ctrl-click')))
            this._host.close();
        try {
            result.activate(app);
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
        if (this._settings.get('highlight-search-result-terms') && !result.plainTitle)
            title.clutter_text.set_markup(highlightMarkup(result.title, query));
        else
            title.text = result.title;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const isNew = result.providerId === 'apps' && Boolean(this._host.isNewApp?.(result.id));
        if (isNew) {
            const line = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
            title.x_expand = true;
            title.y_align = Clutter.ActorAlign.CENTER;
            line.add_child(title);
            line.add_child(makeNewBadge());
            text.add_child(line);
        } else {
            text.add_child(title);
        }
        const shownDescription = result.description && (result.alwaysShowDescription || showDescriptions(this._settings)) ? result.description : null;
        if (shownDescription) {
            const d = new St.Label({text: shownDescription, style_class: 'spawn-row-description'});
            d.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(d);
        }
        box.add_child(text);
        button.set_child(makeFace('spawn-row-surface', box));

        nameItem(button, newAccessibleName(result.title, isNew), {label: title, description: shownDescription, listItem: true});
        this._host.tooltips?.attach(button, title);
        wireItem(button, {
            activate: ctrl => this._activate(result, ctrl),
            context: this._host.openResultContext ? () => {
                if (!this._isStale(result))
                    this._host.openResultContext?.(button, result);
            } : undefined,
        });
        if (result.providerId === 'apps')
            this._host.dragApp?.(button, result.id, result.title);
        return button;
    }
}
