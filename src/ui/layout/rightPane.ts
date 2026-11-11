// RightPane: the right column of the two-pane layout.
//
// Responsibility: the user card, the shortcuts list (folder shortcuts, external devices + network
// locations, bookmarks, application shortcuts) and the power bar; they are rebuilt as a unit when their
// settings change, the shortcut rows again when a drive is mounted / ejected or the bookmarks change.
// Also the keyboard groups of the column and the removable place's eject-button stop.
//
// Public API:
//   new RightPane(scope, services, state, deps)   deps: {pane, host, tooltips, context, scrolls}
//   right.build(): void                    (re)build the whole column
//   right.fill(): void                     (re)build the shortcut rows only
//   right.groups(): Group[]                keyboard groups (shortcuts, power buttons), empty ones included
//   right.placeStep(dir, focus): boolean   Right / Left between a removable place's row and its eject button
//   right.scroll                           the shortcuts scroll view (null before the first build)
//   right.places                           devices / network / bookmarks (debug counts)
//   right.setFakePlaces(specs | null)      dev hook (Ui.SetPlaces)

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ShortcutId} from '../../core/constants.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {Entry} from '../../core/settings.js';
import {Places, type FakePlace, type Place} from '../../model/places.js';
import type {AppContextMenu} from '../contextMenu.js';
import {iconSizeOrHidden, lookupApp} from '../util.js';
import {markList} from '../widgets/a11y.js';
import {PlaceRow} from '../widgets/placeRow.js';
import {PowerBar} from '../widgets/powerBar.js';
import {resolveShortcut, ShortcutRow, type ShortcutHost} from '../widgets/shortcutRow.js';
import {UserCard} from '../widgets/userCard.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import type {ScrollFactory} from './scrolls.js';
import type {Dir, Group, LayoutState} from './types.js';

export interface RightPaneDeps {
    /** The column box the rows are added to (cleared on every build). */
    pane: St.BoxLayout;
    /** What the shortcut rows, user card and power bar may ask of the menu (close it, show All Apps). */
    host: ShortcutHost;
    tooltips: TooltipManager;
    context: AppContextMenu;
    scrolls: ScrollFactory;
}

export class RightPane {
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _pane: St.BoxLayout;
    private readonly _host: ShortcutHost;
    private readonly _tooltips: TooltipManager;
    private readonly _context: AppContextMenu;
    private readonly _scrolls: ScrollFactory;
    /** Scope of everything built by build(); disposed and recreated by the next build. */
    private readonly _rightScope: Scope;
    private _userCard: UserCard | null = null;
    private _shortcutRows: Array<ShortcutRow | PlaceRow> = [];
    private _shortcutsBox: St.BoxLayout | null = null;
    private _powerBar: PowerBar | null = null;
    private _shortcutScroll: St.ScrollView | null = null;
    readonly places: Places;

    constructor(scope: Scope, services: Services, state: LayoutState, deps: RightPaneDeps) {
        this._services = services;
        this._state = state;
        this._pane = deps.pane;
        this._host = deps.host;
        this._tooltips = deps.tooltips;
        this._context = deps.context;
        this._scrolls = deps.scrolls;
        this.places = new Places(scope.child('places'), services.settings);
        this.places.onChanged(scope, () => this.fill());
        this._rightScope = scope.child('right pane');
    }

    get scroll(): St.ScrollView | null {
        return this._shortcutScroll;
    }

    /** Dev hook (Ui.SetPlaces): show fake devices / network locations / bookmarks, null = the real ones. */
    setFakePlaces(specs: FakePlace[] | null): void {
        this.places.setFake(specs);
    }

    /** Is `focus` a removable place's row or eject button; Right / Left switch between them. */
    placeStep(dir: Dir, focus: Clutter.Actor | null): boolean {
        // A removable place has a second stop at the right end of its row: Right reaches the eject button, Left returns.
        const place = this._shortcutRows.find((r): r is PlaceRow => r instanceof PlaceRow && r.ejectButton !== null && (r.actor === focus || r.ejectButton === focus));
        if (place?.ejectButton) {
            if (dir === 'right' && focus === place.actor) {
                place.ejectButton.grab_key_focus();
                return true;
            }
            if (dir === 'left' && focus === place.ejectButton) {
                place.actor.grab_key_focus();
                return true;
            }
        }
        return false;
    }

    // ---- build ----

    build(): void {
        if (this._state.destroyed)
            return;
        this._tooltips.hide();
        this._rightScope.dispose();
        this._userCard = null;
        this._shortcutRows = [];
        this._powerBar = null;
        this._shortcutScroll = null;
        this._shortcutsBox = null;
        for (const c of this._pane.get_children())
            c.destroy();

        const s = this._services.settings;
        const scope = this._rightScope;

        this._userCard = new UserCard(scope, s, this._host, card => this._context.open(card, {kind: 'usercard'}));
        this._pane.add_child(this._userCard.actor);
        if (s.get('show-user-avatar'))
            this._pane.remove_style_class_name('spawn-no-card');
        else
            this._pane.add_style_class_name('spawn-no-card');

        const shortcutsBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-shortcuts-box'});
        markList(shortcutsBox, _('Shortcuts'));
        const scroll = this._scrolls.make(shortcutsBox, 'spawn-shortcuts', false);
        this._shortcutScroll = scroll;
        this._shortcutsBox = shortcutsBox;
        this.fill();
        this._pane.add_child(scroll);

        this._powerBar = new PowerBar(scope, s, this._host);
        this._pane.add_child(this._powerBar.actor);
    }

    /**
     * (Re)build the rows of the shortcuts list: folder shortcuts, then external devices + network locations,
     * then bookmarks, then application shortcuts, a rule between non-empty groups. Runs again when a drive
     * is mounted / ejected or the bookmarks change.
     */
    fill(): void {
        const box = this._shortcutsBox;
        if (this._state.destroyed || !box)
            return;
        this._tooltips.hide();
        for (const c of box.get_children())
            c.destroy();
        this._shortcutRows = [];

        const s = this._services.settings;
        const scope = this._rightScope;
        const host = this._host;
        const iconSize = iconSizeOrHidden(s, 'icon-size-shortcuts', 16);
        const symbolic = s.get('icon-style-shortcuts') === 'Symbolic';

        const places: Place[] = [];
        if (s.get('show-external-devices'))
            places.push(...this.places.devices(), ...this.places.network());
        const bookmarks: Place[] = s.get('show-bookmarks') ? this.places.bookmarks() : [];
        const groups: Array<Array<Entry | Place>> = [s.get('directory-shortcuts'), places, bookmarks, s.get('application-shortcuts')]
            .filter(g => g.length > 0);
        const list: Array<Entry | Place> = [];
        groups.forEach((g, i) => {
            if (i > 0)
                list.push({id: ShortcutId.SEPARATOR});
            list.push(...g);
        });

        let lastWasSeparator = true;
        for (const item of list) {
            // One damaged shortcut must not take the others down with it.
            try {
                if (!('id' in item)) {
                    const row = new PlaceRow(item, host, {iconSize});
                    lastWasSeparator = false;
                    this._shortcutRows.push(row);
                    box.add_child(row.actor);
                    continue;
                }
                const row = new ShortcutRow(item, host, {iconSize, symbolic, scope, context: button => this._openShortcutContext(button, item, host)});
                if (row.isSeparator) {
                    if (lastWasSeparator) {
                        row.destroy();
                        continue;
                    }
                    lastWasSeparator = true;
                } else {
                    if (!ShortcutRow.resolve(item)) {
                        row.destroy();
                        continue;
                    }
                    lastWasSeparator = false;
                }
                this._shortcutRows.push(row);
                box.add_child(row.actor);
            } catch (e) {
                error(`shortcut ${JSON.stringify(item)} skipped`, e);
            }
        }
        const last = this._shortcutRows[this._shortcutRows.length - 1];
        if (last?.isSeparator) {
            last.destroy();
            this._shortcutRows.pop();
        }
    }

    /** Right click / Menu key on a right-pane shortcut: Open, New Window, Remove from Menu, Edit Shortcuts…. */
    private _openShortcutContext(row: St.Widget, entry: Entry, host: ShortcutHost): void {
        const resolved = resolveShortcut(entry);
        if (!resolved)
            return;
        const app = entry.id.endsWith('.desktop') ? lookupApp(this._services, entry.id) : null;
        this._context.open(row, {kind: 'shortcut', entry, name: resolved.name, app, open: () => resolved.run(host, this._rightScope)});
    }

    // ---- keyboard ----

    groups(): Group[] {
        const items: Clutter.Actor[] = [];
        if (this._userCard?.actor.visible)
            items.push(this._userCard.actor);
        for (const r of this._shortcutRows) {
            if (!r.isSeparator)
                items.push(r.actor);
        }
        const groups: Group[] = [{id: 'shortcuts', items, cols: 1}];
        const power = this._powerBar?.buttons() ?? [];
        if (power.length)
            groups.push({id: 'power', items: power, cols: power.length});
        return groups;
    }
}
