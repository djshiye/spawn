// FrequentView: the list of the most used apps.
//
// Responsibility: the "Frequent" view (a scroll view of app rows) and the row fill that the pinned view
// reuses for its "Pinned and Frequent" section. Rows come from `AppIndex.frequent`, limited by
// `max-frequent-apps`.
//
// Public API:
//   new FrequentView(services, tileHost, tooltips, scrolls)
//   frequent.ensure(): St.ScrollView     build the view the first time, then refill it; returns its scroll view
//   frequent.box / frequent.scroll       the list and its scroll view (null before the first ensure)
//   frequent.refill()                    refill the built list (a catalogue change while it shows)
//   frequent.fill(box)                   (re)fill any box with the frequent rows (also the pinned section); a box that
//                                        already holds the rows for the same apps, icon size, descriptions, names, "New"
//                                        badges and hidden state is left as it is (the menu opens often, the rows rarely differ)
//   frequent.rows(): Clutter.Actor[]     the focusable rows of the view

import Clutter from 'gi://Clutter';
import type Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import type {Services} from '../../core/services.js';
import {displayName, iconSizeFor, showDescriptions} from '../util.js';
import {markList} from '../widgets/a11y.js';
import {AppRow} from '../widgets/appRow.js';
import type {TileHost} from '../widgets/appTile.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import type {ScrollFactory} from './scrolls.js';

export class FrequentView {
    box: St.BoxLayout | null = null;
    scroll: St.ScrollView | null = null;
    private readonly _services: Services;
    private readonly _tileHost: TileHost;
    private readonly _tooltips: TooltipManager;
    private readonly _scrolls: ScrollFactory;
    /** What each filled box shows (see _signature); the box is refilled when it differs. */
    private readonly _filled = new WeakMap<St.BoxLayout, string>();

    constructor(services: Services, tileHost: TileHost, tooltips: TooltipManager, scrolls: ScrollFactory) {
        this._services = services;
        this._tileHost = tileHost;
        this._tooltips = tooltips;
        this._scrolls = scrolls;
    }

    ensure(): St.ScrollView {
        if (!this.scroll) {
            this.box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-list'});
            this.scroll = this._scrolls.make(this.box, 'spawn-frequent');
        }
        this.fill(this.box as St.BoxLayout);
        return this.scroll;
    }

    refill(): void {
        if (this.box)
            this.fill(this.box);
    }

    rows(): Clutter.Actor[] {
        return this.box?.get_children().filter(c => c instanceof St.Button) ?? [];
    }

    /** `max-frequent-apps`; anything below 1 (hand-edited dconf) falls back to the default of 8. */
    private _limit(): number {
        const n = this._services.settings.get('max-frequent-apps');
        return n > 0 ? n : 8;
    }

    /** Everything a row shows: the apps in order (hidden ones are not in the list), icon size, description, name, "New" badge. */
    private _signature(apps: readonly Shell.App[], iconSize: number, description: boolean): string {
        const s = this._services.settings;
        const parts = apps.map(a => [a.get_id() ?? '', displayName(a, s), this._tileHost.isNew?.(a) ? 1 : 0,
            a.get_icon()?.to_string() ?? '', description ? a.get_description() ?? '' : ''].join('\u0001'));
        return `${iconSize}|${description}|${parts.join('\u0002')}`;
    }

    fill(box: St.BoxLayout): void {
        const s = this._services.settings;
        const opts = {iconSize: iconSizeFor(s, 'icon-size-apps', 28), description: showDescriptions(s)};
        const apps = this._services.appIndex.frequent(this._limit());
        const signature = this._signature(apps, opts.iconSize, opts.description);
        if (this._filled.get(box) === signature && box.get_n_children() > 0)
            return;
        this._filled.set(box, signature);
        markList(box, _('Frequent apps'));
        this._tooltips.hide();
        for (const c of box.get_children())
            c.destroy();
        for (const app of apps)
            box.add_child(new AppRow(app, this._tileHost, {...opts, name: displayName(app, s)}).actor);
        // each row carries 1 px of the pitch below it: the last one has nothing to separate from (the scroll range)
        (box.get_last_child() as St.Widget | null)?.set_style('padding-bottom: 0;');
        if (apps.length === 0) {
            box.add_child(new St.Label({
                text: _('Nothing here yet'),
                style_class: 'spawn-empty-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            }));
        }
    }
}
