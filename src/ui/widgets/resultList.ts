// ResultList: streaming search results. One section per SearchBatch (provider title + rows),
// ordered by SearchBatch.order (the engine's provider registration order: apps > windows >
// recent files > GNOME shell providers in their sort-order) regardless of arrival order, except for the
// best match: the section that holds the single strongest result across the sections that rank names
// (search/bestMatch.ts: apps, Settings panels, app actions, power actions) is shown first, so its first row,
// the highlighted one, is the best match of the whole query ("display" -> the Displays panel, not an app
// that lists it as a keyword). Moving the section (not copying its row to a "Best match" heading) keeps every
// result once, the counts and the "2 of 5" announcements true and the list as compact as before. While a
// calculator / conversion answer shows, it keeps the top. The leader is re-picked with every arriving batch
// only until the highlight was moved (keys, pointer, focus); after that it stays, so a late batch never
// reorders under the user. A batch with the title '' is a bare row group without heading (the runner's Run row).
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
// When a provider's new batch replaces its section, the rows of results with the same id are reused (a row is
// 6-7 actors): they get the new title markup (the highlight follows the query), description, icon (when it
// changed), accessible name and place, and leave the stale state; the rows of results that are gone are
// destroyed, new results get new rows. A row whose shape changes (a "New" pill, a description appearing) is
// rebuilt. The settings the rows depend on are read once per batch.
//
// Public API:
//   new ResultList(scope: Scope, settings: SpawnSettings, host: ResultHost)
//   list.actor: St.Widget
//   list.beginQuery(): void             a new query starts: keep old rows dimmed, see above
//   list.reset(): void                  hard clear (menu closed / view left): rows gone now
//   list.addBatch(batch: SearchBatch): void   empty batches are ignored
//   list.titles(): string[]            accessible names of rows(), best first (dev hook)
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
import type Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {SearchBatch, SearchResult} from '../../search/engine.js';
import {error} from '../../core/log.js';
import {ANSWER_ROWS, MULTI_ROW_PROVIDERS, pickLeader, sectionRank} from '../../search/bestMatch.js';
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
    /** 1 when the box starts with the title label, 0 for a bare group (rows start at child 0). */
    head: number;
    /** Score of the first (best) row: what the best match compares. */
    top: number;
    /** Belongs to the previous query (dimmed, inert) until this provider's new batch replaces it. */
    stale: boolean;
}

/** What a row was built from, so a reused row only changes what differs. */
interface RowParts {
    box: St.BoxLayout;
    icon: St.Widget;
    /** The icon's gicon and size; a result with a createIcon factory gets a new icon every time. */
    gicon: Gio.Icon | null;
    iconSize: number;
    factory: boolean;
    title: St.Label;
    /** Last title text / markup applied. */
    titleKey: string;
    desc: St.Label | null;
    /** What the accessible name was last set from. */
    nameKey: string;
    /** Row shape: markup or plain title, "New" pill, description present, drag name; a change rebuilds the row. */
    shape: string;
}

/** Settings read once for a batch. */
interface RowSettings {
    highlight: boolean;
    descriptions: boolean;
    iconSize: number;
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
    private readonly _parts = new Map<St.Button, RowParts>();
    /** The row that carries the tail padding now (see _trimTail). */
    private _tail: St.Button | null = null;
    private _cancelEmpty: (() => void) | null = null;
    private _cancelStale: (() => void) | null = null;
    private _pending = false;
    /** The row carrying :selected now (null while hidden). */
    private _marked: St.Button | null = null;
    /** The highlighted row once moved off the first one (null: the first). */
    private _pick: St.Button | null = null;
    /** Provider id of the best-match section (null: the provider order stands). */
    private _leader: string | null = null;
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
        this._leader = null;
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
        const max = MULTI_ROW_PROVIDERS.has(batch.providerId) ? ANSWER_ROWS : Math.max(1, this._settings.get('max-search-results'));
        const results = batch.results.slice(0, max);
        if (results.length === 0)
            return;
        const rs: RowSettings = {
            highlight: this._settings.get('highlight-search-result-terms'),
            descriptions: showDescriptions(this._settings),
            iconSize: iconSizeFor(this._settings, 'icon-size-apps', 28),
        };
        // This provider's rows of the previous query are reused where the result is still there; the other
        // providers' stay until theirs arrive.
        const titled = batch.providerTitle !== '';
        const olds = this._sections.filter(s => s.providerId === batch.providerId);
        const reuse = olds.find(s => s.head === (titled ? 1 : 0)) ?? null;
        for (const old of olds) {
            if (old !== reuse)
                this._removeSection(old);
        }
        const spare = new Map<string, St.Button>();
        if (reuse) {
            for (const row of reuse.rows) {
                const id = this._results.get(row)?.id;
                if (id !== undefined && !spare.has(id))
                    spare.set(id, row);
            }
            this._resetMarks(reuse);
        }
        this._pending = false;
        this._cancelEmpty?.();
        this._cancelEmpty = null;
        this._empty.hide();

        let section: Section;
        if (reuse) {
            section = reuse;
            section.order = batch.order;
            section.top = results[0].score;
            section.stale = false;
            section.box.opacity = 255;
            const label = titled ? section.box.get_child_at_index(0) as St.Label : null;
            if (label && label.text !== batch.providerTitle) {
                label.text = batch.providerTitle;
                markList(section.box, batch.providerTitle);
            }
        } else {
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-result-section'});
            if (titled)
                box.add_child(new St.Label({text: batch.providerTitle, style_class: 'spawn-section-title'}));
            markList(box, titled ? batch.providerTitle : _('Search results'));
            section = {providerId: batch.providerId, order: batch.order, box, rows: [], head: titled ? 1 : 0, top: results[0].score, stale: false};
        }
        const previous = section.rows;
        const rows: St.Button[] = [];
        for (const result of results) {
            const kept = spare.get(result.id) ?? null;
            if (kept)
                spare.delete(result.id);
            const row = kept && this._refreshRow(kept, result, batch.query, rs) ? kept : this._makeRow(result, batch.query, rs);
            rows.push(row);
            this._results.set(row, result);
        }
        // Rows of results that are gone (or were rebuilt above) go.
        for (const row of previous) {
            if (!rows.includes(row))
                this._dropRow(row);
        }
        section.rows = rows;
        this._fillSection(section);

        if (!reuse) {
            this._sections.push(section);
            this.actor.add_child(section.box);
        }
        this._sortSections();
        this._placeSections();
        this._updateSelection();
        this._announcer.found(this._sections.reduce((n, s) => n + (s.stale ? 0 : s.rows.length), 0));
    }

    /**
     * Provider order, the best-match section first (the label for "No results" stays last). The leader is picked
     * from the sections of the current query, and kept once the user moved the highlight.
     */
    private _sortSections(): void {
        if (!this._pick || !this._sections.some(s => s.providerId === this._leader && !s.stale))
            this._leader = pickLeader(this._sections.filter(s => !s.stale).map(s => ({providerId: s.providerId, order: s.order, score: s.top})));
        const leader = this._leader;
        // Array.prototype.sort is stable
        this._sections.sort((a, b) => sectionRank(a.order, a.providerId, leader) - sectionRank(b.order, b.providerId, leader));
    }

    /** What the screen reader was last told about the result count (dev hook). */
    get announcement(): string {
        return this._announcer.lastMessage;
    }

    titles(): string[] {
        return this.rows().map(r => r.accessible_name ?? '');
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
        const last = rows[rows.length - 1] ?? null;
        if (last === this._tail)
            return;
        // Only the row that changes is restyled (the old tail may be gone: _dropRow forgets it).
        this._tail?.set_style(null);
        last?.set_style('padding-bottom: 0;');
        this._tail = last;
    }

    private _removeSection(section: Section): void {
        const i = this._sections.indexOf(section);
        if (i >= 0)
            this._sections.splice(i, 1);
        for (const row of section.rows) {
            this._results.delete(row);
            this._parts.delete(row);
            if (this._marked === row)
                this._marked = null;
            if (this._pick === row)
                this._pick = null;
            if (this._tail === row)
                this._tail = null;
        }
        section.box.destroy();
    }

    /** A row of a section that stays leaves the selection as if it had been rebuilt (the caller re-applies it). */
    private _resetMarks(section: Section): void {
        for (const row of section.rows) {
            if (this._marked === row) {
                row.remove_style_pseudo_class('selected');
                row.remove_accessible_state(Atk.StateType.SELECTED);
                this._marked = null;
            }
            if (this._pick === row)
                this._pick = null;
        }
    }

    /** Destroy one row of a section that stays. */
    private _dropRow(row: St.Button): void {
        this._results.delete(row);
        this._parts.delete(row);
        if (this._marked === row)
            this._marked = null;
        if (this._pick === row)
            this._pick = null;
        if (this._tail === row)
            this._tail = null;
        row.destroy();
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
        this._parts.clear();
        this._tail = null;
        this._marked = null;
        this._pick = null;
        this._spacer.visible = false;
    }

    /** A section's rows below its title, best first (reversed: best last, next to the entry). */
    private _fillSection(section: Section): void {
        const rows = this._reversed ? [...section.rows].reverse() : section.rows;
        rows.forEach((row, i) => {
            if (row.get_parent() === section.box)
                section.box.set_child_at_index(row, i + section.head);
            else
                section.box.insert_child_at_index(row, i + section.head);
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

    private _makeIcon(result: SearchResult, size: number): St.Widget {
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

    /** What a row looks like for `result`: its shape (a change rebuilds the row), "New" pill and shown description. */
    private _describe(result: SearchResult, rs: RowSettings): {shape: string; markup: boolean; isNew: boolean; description: string | null} {
        const markup = rs.highlight && !result.plainTitle;
        const isNew = result.providerId === 'apps' && Boolean(this._host.isNewApp?.(result.id));
        const description = result.description && (result.alwaysShowDescription || rs.descriptions) ? result.description : null;
        // The drag source of an app row carries its name from when it was built.
        const shape = `${markup ? 1 : 0}${isNew ? 1 : 0}${description ? 1 : 0}${result.providerId === 'apps' ? result.title : ''}`;
        return {shape, markup, isNew, description};
    }

    private _titleKey(result: SearchResult, query: string, markup: boolean): string {
        return markup ? highlightMarkup(result.title, query) : result.title;
    }

    /**
     * A row of the previous batch for the same result: refresh what can differ and let it leave the stale state.
     * False when the row has another shape (it is rebuilt then).
     */
    private _refreshRow(row: St.Button, result: SearchResult, query: string, rs: RowSettings): boolean {
        const parts = this._parts.get(row);
        const d = this._describe(result, rs);
        if (!parts || parts.shape !== d.shape)
            return false;
        row.reactive = true;
        row.can_focus = true;
        const key = this._titleKey(result, query, d.markup);
        if (key !== parts.titleKey) {
            if (d.markup)
                parts.title.clutter_text.set_markup(key);
            else
                parts.title.text = key;
            parts.titleKey = key;
        }
        if (parts.desc && d.description && parts.desc.text !== d.description)
            parts.desc.text = d.description;
        const factory = typeof result.createIcon === 'function';
        const gicon = result.icon ?? null;
        const same = gicon === parts.gicon || (gicon !== null && parts.gicon !== null && gicon.equal(parts.gicon));
        if (factory || parts.factory || parts.iconSize !== rs.iconSize || !same) {
            const icon = this._makeIcon(result, rs.iconSize);
            parts.box.remove_child(parts.icon);
            parts.icon.destroy();
            parts.box.insert_child_at_index(icon, 0);
            parts.icon = icon;
            parts.gicon = gicon;
            parts.iconSize = rs.iconSize;
            parts.factory = factory;
        }
        const name = newAccessibleName(result.title, d.isNew);
        const nameKey = `${name}\n${d.description ?? ''}`;
        if (nameKey !== parts.nameKey) {
            nameItem(row, name, {label: parts.title, description: d.description, listItem: true});
            parts.nameKey = nameKey;
        }
        return true;
    }

    private _makeRow(result: SearchResult, query: string, rs: RowSettings): St.Button {
        const button = makeItemButton('spawn-result-row');
        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const icon = this._makeIcon(result, rs.iconSize);
        box.add_child(icon);

        const d = this._describe(result, rs);
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        const title = new St.Label({style_class: 'spawn-row-label'});
        const titleKey = this._titleKey(result, query, d.markup);
        if (d.markup)
            title.clutter_text.set_markup(titleKey);
        else
            title.text = titleKey;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        if (d.isNew) {
            const line = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
            title.x_expand = true;
            title.y_align = Clutter.ActorAlign.CENTER;
            line.add_child(title);
            line.add_child(makeNewBadge());
            text.add_child(line);
        } else {
            text.add_child(title);
        }
        let desc: St.Label | null = null;
        if (d.description) {
            desc = new St.Label({text: d.description, style_class: 'spawn-row-description'});
            desc.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(desc);
        }
        box.add_child(text);
        button.set_child(makeFace('spawn-row-surface', box));

        const name = newAccessibleName(result.title, d.isNew);
        nameItem(button, name, {label: title, description: d.description, listItem: true});
        this._parts.set(button, {
            box, icon, gicon: result.icon ?? null, iconSize: rs.iconSize, factory: typeof result.createIcon === 'function',
            title, titleKey, desc, nameKey: `${name}\n${d.description ?? ''}`, shape: d.shape,
        });
        this._host.tooltips?.attach(button, title);
        // The handlers look the row's current result up: a reused row stands for a newer result.
        wireItem(button, {
            activate: ctrl => {
                const current = this._results.get(button);
                if (current)
                    this._activate(current, ctrl);
            },
            context: this._host.openResultContext ? () => {
                const current = this._results.get(button);
                if (current && !this._isStale(current))
                    this._host.openResultContext?.(button, current);
            } : undefined,
        });
        if (result.providerId === 'apps')
            this._host.dragApp?.(button, result.id, result.title);
        return button;
    }
}
