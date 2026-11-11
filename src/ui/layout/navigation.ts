// Navigator: arrow, Tab, Home / End and Page keys across the groups of the menu.
//
// Responsibility: the keyboard model of the layout. The menu is a set of GROUPS (a list or grid of focusable
// items with a column count: the search entry, the quick links, the main view, the Undo button, Back / All
// Apps, the shortcuts, the power buttons, the category column); the navigator moves the focus between items and
// groups (arrows, Tab / Shift+Tab as pane cycling, Home / End / Page Up / Page Down inside a list). It knows
// nothing about how a group is built: the layout gives it `NavSources`, one provider per group. A different
// layout (another arrangement of panes) supplies its own sources and positions.
//
// Public API:
//   new Navigator(state, sources)
//   nav.move(dir): boolean         an arrow key; true when the key is consumed
//   nav.jump(sym): boolean         Home / End / Page Up / Page Down in the focused list or grid
//   nav.cyclePane(delta)           Tab (1) / Shift+Tab (-1): the next / previous group in reading order
//   nav.focusMain(last?)           focus the first (last) item of the main view (or the category column)
//   nav.focusItem(group, which?)   focus an item of `group` ('first' | 'last' | index)
//   nav.locate(groups, focus)      the group and index holding `focus`
//   nav.paneGroups()               groups by pane: left column, right pane, category column
//   NavSources                     the group providers the layout supplies

import Clutter from 'gi://Clutter';
import type St from 'gi://St';

import {nearestIndex} from '../../model/listNav.js';
import {centreOf, inView, pageTo} from './geometry.js';
import type {Dir, Group, LayoutState} from './types.js';

export interface NavSources {
    /** Groups of the main view of the left pane (one per list / grid in it). */
    mainGroups(): Group[];
    /** The category column next to the app list (All Apps with categories), if it shows. */
    categoryGroup(): Group | null;
    linksGroup(): Group | null;
    /** The quick links sit above the main view. */
    linksTop(): boolean;
    navGroup(): Group | null;
    undoGroup(): Group | null;
    searchGroup(): Group | null;
    /** Groups of the right pane (empty ones included). */
    rightGroups(): Group[];
    /** A row with a second stop (a removable place's eject button): Right / Left switch between them. */
    placeStep(dir: Dir, focus: Clutter.Actor | null): boolean;
    /** The highlighted search result row, for Tab into the results. */
    selectedResult(): Clutter.Actor | null;
}

export class Navigator {
    private readonly _state: LayoutState;
    private readonly _src: NavSources;

    constructor(state: LayoutState, sources: NavSources) {
        this._state = state;
        this._src = sources;
    }

    /** Left column groups in vertical order. */
    private _leftColumn(): Group[] {
        // An open folder popup keeps the keyboard inside it (header, then its apps).
        if (this._state.view === 'folder')
            return this._src.mainGroups().filter(g => g.items.length > 0);
        const out: Group[] = [];
        const search = this._src.searchGroup();
        const top = this._state.searchTop;
        if (search && top)
            out.push(search);
        const links = this._src.linksGroup();
        const linksTop = this._src.linksTop();
        if (links && linksTop)
            out.push(links);
        out.push(...this._src.mainGroups().filter(g => g.items.length > 0));
        if (links && !linksTop)
            out.push(links);
        const undo = this._src.undoGroup();
        if (undo)
            out.push(undo);
        const nav = this._src.navGroup();
        if (nav)
            out.push(nav);
        if (search && !top)
            out.push(search);
        return out;
    }

    locate(groups: Group[], focus: Clutter.Actor | null): {group: Group; index: number} | null {
        if (!focus)
            return null;
        for (const g of groups) {
            for (let i = 0; i < g.items.length; i++) {
                const it = g.items[i];
                if (it === focus || it.contains(focus))
                    return {group: g, index: i};
            }
        }
        return null;
    }

    focusItem(group: Group | undefined, which: 'first' | 'last' | number = 'first'): boolean {
        if (!group || group.items.length === 0)
            return false;
        const i = which === 'first' ? 0 : which === 'last' ? group.items.length - 1 : Math.min(which, group.items.length - 1);
        group.items[i].grab_key_focus();
        return true;
    }

    focusMain(last = false): void {
        const cats = this._src.categoryGroup();
        if (cats && !last && cats.items.length > 0) {
            // All apps with a category column: start on the selected category.
            this.focusItem(cats, Math.max(0, cats.items.findIndex(c => (c as St.Widget).has_style_pseudo_class('checked'))));
            return;
        }
        const groups = this._src.mainGroups().filter(g => g.items.length > 0);
        // In a folder popup the apps come first, the header (rename / close) second.
        if (this._state.view === 'folder' && !last && groups.length > 1) {
            this.focusItem(groups[1], 'first');
            return;
        }
        if (groups.length === 0) {
            // Results still pending (or none): stay where the focus is instead of jumping to Back.
            if (this._state.view !== 'results')
                this.focusItem(this._src.navGroup() ?? undefined);
            return;
        }
        this.focusItem(last ? groups[groups.length - 1] : groups[0], last ? 'last' : 'first');
    }

    move(dir: Dir): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (this._src.placeStep(dir, focus))
            return true;
        const leftCol = this._leftColumn();
        const inFolder = this._state.view === 'folder';
        const rightCol = inFolder ? [] : this._src.rightGroups().filter(g => g.items.length > 0);
        const cats = inFolder ? null : this._src.categoryGroup();

        let col: Group[] = leftCol;
        let loc = this.locate(leftCol, focus);
        let onRight = false;
        if (!loc) {
            loc = this.locate(rightCol, focus);
            col = rightCol;
            onRight = true;
        }
        let inCats = false;
        if (!loc && cats) {
            loc = this.locate([cats], focus);
            col = leftCol;
            inCats = true;
        }
        if (!loc) {
            this.focusMain();
            return true;
        }
        const {group, index} = loc;
        const n = group.items.length;
        const cols = group.cols;
        const groupIdx = col.indexOf(group);

        const vertical = (delta: number): boolean => {
            const row = Math.floor(index / cols);
            const target = index + delta * cols;
            if (cols > 1 && Math.floor(target / cols) >= 0 && target >= 0 && target < n && (cols > 1 && group.id !== 'nav' && group.id !== 'power' && group.id !== 'header'))
                return this.focusItem(group, target);
            if (cols > 1 && delta > 0 && group.id !== 'nav' && group.id !== 'power' && group.id !== 'header') {
                const lastRow = Math.floor((n - 1) / cols);
                if (row < lastRow)
                    return this.focusItem(group, n - 1);
            }
            if (cols === 1 && index + delta >= 0 && index + delta < n)
                return this.focusItem(group, index + delta);
            if (inCats) {
                // The category column is not one of the left column's groups: leave it explicitly.
                const search = this._src.searchGroup();
                if (delta > 0)
                    return this.focusItem(this._src.navGroup() ?? (!this._state.searchTop && search ? search : undefined), 'first') || true;
                return (this._state.searchTop && search ? this.focusItem(search, 'first') : false) || true;
            }
            const next = col[groupIdx + delta];
            if (next)
                return this.focusItem(next, delta > 0 ? Math.min(index % Math.max(cols, 1), next.items.length - 1) : 'last');
            return true;
        };

        const horizontal = (delta: number): boolean => {
            if (inCats) {
                if (delta > 0)
                    return this.focusItem(leftCol.find(g => g.id === 'apps'), 'first');
                return true;
            }
            const rowStart = cols > 1 ? Math.floor(index / cols) * cols : 0;
            const rowEnd = cols > 1 ? Math.min(n - 1, rowStart + cols - 1) : 0;
            if (cols > 1) {
                const t = index + delta;
                if (t >= rowStart && t <= rowEnd)
                    return this.focusItem(group, t);
            }
            // Leaving the pane sideways: the item of the other pane at the same height (nearest column).
            if (onRight) {
                if (delta < 0)
                    this._focusNearest(leftCol.filter(g => g.id !== 'search'), focus as Clutter.Actor);
                return true;
            }
            if (inFolder)
                return true;
            if (delta > 0) {
                this._focusNearest(rightCol, focus as Clutter.Actor);
                return true;
            }
            if (cats && group.id === 'apps')
                return this.focusItem(cats, Math.max(0, cats.items.findIndex(c => (c as St.Widget).has_style_pseudo_class('checked'))));
            return true;
        };

        switch (dir) {
        case 'up': return vertical(-1);
        case 'down': return vertical(1);
        case 'left': return horizontal(-1);
        case 'right': return horizontal(1);
        }
    }

    /** Focus the item of `groups` nearest to `from` on screen, vertically first (only items scrolled into view). */
    private _focusNearest(groups: Group[], from: Clutter.Actor): boolean {
        const items = groups.flatMap(g => g.items).filter(inView);
        const target = items[nearestIndex(items.map(centreOf), centreOf(from))];
        target?.grab_key_focus();
        return Boolean(target);
    }

    /** The keyboard groups by pane: the left column, the right pane (none in a folder popup), the category column. */
    paneGroups(): {left: Group[]; right: Group[]; cats: Group | null} {
        const inFolder = this._state.view === 'folder';
        return {
            left: this._leftColumn(),
            right: inFolder ? [] : this._src.rightGroups().filter(g => g.items.length > 0),
            cats: inFolder ? null : this._src.categoryGroup(),
        };
    }

    /** Home / End (first / last item) and Page Up / Down (one visible page) inside the focused list or grid. */
    jump(sym: number): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const {left, right, cats} = this.paneGroups();
        const loc = this.locate([...left, ...right, ...(cats ? [cats] : [])], focus);
        if (!loc || loc.group.id === 'search')
            return false;
        const items = loc.group.items;
        const current = items[loc.index];
        let target: Clutter.Actor | null;
        if (sym === Clutter.KEY_Home || sym === Clutter.KEY_KP_Home)
            target = items[0];
        else if (sym === Clutter.KEY_End || sym === Clutter.KEY_KP_End)
            target = items[items.length - 1];
        else
            target = pageTo(items, current, sym === Clutter.KEY_Page_Down || sym === Clutter.KEY_KP_Page_Down ? 1 : -1);
        if (target && target !== current)
            target.grab_key_focus();
        return true;
    }

    /** F2 on a pinned folder (or anywhere in its open popup): rename it. */
    cyclePane(delta: number): void {
        if (this._state.view === 'folder') {
            // Tab stays inside the folder popup: header <-> apps.
            const groups = this._src.mainGroups().filter(g => g.items.length > 0);
            const loc = this.locate(groups, global.stage.key_focus as Clutter.Actor | null);
            const current = loc ? groups.indexOf(loc.group) : -1;
            const n = groups.length;
            if (n > 0)
                this.focusItem(groups[((current + delta) % n + n) % n], 'first');
            return;
        }
        const panes: Array<() => boolean> = [];
        const search = this._src.searchGroup();
        const cats = this._src.categoryGroup();
        const main = this._src.mainGroups().filter(g => g.items.length > 0);
        const nav = this._src.navGroup();
        const right = this._src.rightGroups().filter(g => g.items.length > 0);
        const focus = global.stage.key_focus as Clutter.Actor | null;

        const add = (g: Group | null | undefined, which: 'first' | 'last' = 'first') => {
            if (!g || !g.items.length)
                return;
            // Into the search results: the highlighted one.
            const at = g.id === 'results' ? g.items.indexOf(this._src.selectedResult() as Clutter.Actor) : -1;
            panes.push(() => this.focusItem(g, at >= 0 ? at : which));
        };
        const links = this._src.linksGroup();
        const linksTop = this._src.linksTop();
        // Reading order wherever the entry sits: search, the list (and what is below it), right pane, power buttons.
        add(search);
        if (linksTop)
            add(links);
        add(cats, 'first');
        for (const g of main)
            add(g);
        if (!linksTop)
            add(links);
        const undo = this._src.undoGroup();
        add(undo);
        add(nav);
        for (const g of right)
            add(g);

        // Which pane holds the focus?
        const all: Array<Group | null> = [search, linksTop ? links : null, cats, ...main, linksTop ? null : links, undo, nav, ...right];
        const groups = all.filter((g): g is Group => Boolean(g && g.items.length));
        const loc = this.locate(groups, focus);
        const current = loc ? groups.indexOf(loc.group) : -1;
        const next = ((current + delta) % panes.length + panes.length) % panes.length;
        panes[next]?.();
    }
}
