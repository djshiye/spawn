// CategoryLinks: the "category quick links" of the start view (ArcMenu's arcmenu-extra-categories-links):
// a few rows (Favorites, Frequent Apps, All Apps, Pinned Apps, Recent Files) above or below the list that
// open that view in one click. Each row is a `spawn-list-row` (transparent outer button that owns the
// pane's 8 px inset, visible `spawn-row-surface` face), so the links have no dead pixels and keep the
// focus ring of every other list row.
//
// Public API:
//   new CategoryLinks(host: LinksHost, location: 'Top' | 'Bottom')
//   links.actor: St.BoxLayout          class "spawn-links"; a separator on the list's side, then the rows
//   links.setLinks(ids: number[], iconSize: number)  rebuild the rows for these CategoryLink ids (in order)
//   links.buttons(): St.Button[]       the rows (keyboard group)
//   links.destroy()
//   LinksHost: {open(id: number): void, tooltips?}
//   linkInfo(id): {name, icon}         display name (translated) and symbolic icon of a link id

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CategoryLink} from '../../core/constants.js';
import type {MenuItemLocation} from '../../core/settings.js';
import {markList, nameItem} from './a11y.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import type {TooltipManager} from './tooltip.js';

export interface LinksHost {
    open(id: number): void;
    tooltips?: TooltipManager;
}

export function linkInfo(id: number): {name: string; icon: string} {
    switch (id) {
    case CategoryLink.FAVORITES: return {name: _('Favourites'), icon: 'emote-love-symbolic'};
    case CategoryLink.FREQUENT: return {name: _('Frequent Apps'), icon: 'user-bookmarks-symbolic'};
    case CategoryLink.ALL_PROGRAMS: return {name: _('All Apps'), icon: 'view-app-grid-symbolic'};
    case CategoryLink.PINNED: return {name: _('Pinned Apps'), icon: 'view-pin-symbolic'};
    case CategoryLink.RECENT_FILES: return {name: _('Recent Files'), icon: 'document-open-recent-symbolic'};
    default: return {name: `#${id}`, icon: 'view-more-symbolic'};
    }
}

export class CategoryLinks {
    readonly actor: St.BoxLayout;
    private readonly _host: LinksHost;
    private readonly _location: MenuItemLocation;
    private readonly _rows: St.BoxLayout;
    private _buttons: St.Button[] = [];

    constructor(host: LinksHost, location: MenuItemLocation) {
        this._host = host;
        this._location = location;
        this.actor = new St.BoxLayout({style_class: 'spawn-links', orientation: Clutter.Orientation.VERTICAL, x_expand: true, visible: false});
        this._rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        markList(this._rows, _('Quick links'));
        const separator = new St.Widget({style_class: 'spawn-separator', x_expand: true});
        // Top: the rows, then the rule under them; Bottom: the rule above the rows.
        if (location === 'Top') {
            this.actor.add_child(this._rows);
            this.actor.add_child(separator);
        } else {
            this.actor.add_child(separator);
            this.actor.add_child(this._rows);
        }
    }

    get location(): MenuItemLocation {
        return this._location;
    }

    setLinks(ids: number[], iconSize: number): void {
        this._host.tooltips?.hide();
        for (const c of this._rows.get_children())
            c.destroy();
        this._buttons = [];
        for (const id of ids) {
            const info = linkInfo(id);
            const button = makeItemButton('spawn-list-row');
            const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
            if (iconSize > 0)
                box.add_child(new St.Icon({style_class: 'spawn-category-icon', icon_name: info.icon, icon_size: iconSize, y_align: Clutter.ActorAlign.CENTER}));
            const label = new St.Label({text: info.name, style_class: 'spawn-row-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(label);
            button.set_child(makeFace('spawn-row-surface', box));
            nameItem(button, info.name, {label, listItem: true});
            this._host.tooltips?.attach(button, label);
            wireItem(button, {activate: () => this._host.open(id)});
            this._rows.add_child(button);
            this._buttons.push(button);
        }
        // a row carries 1 px of the pitch below it; the last one has nothing to separate from
        (this._rows.get_last_child() as St.Widget | null)?.set_style('padding-bottom: 0;');
    }

    buttons(): St.Button[] {
        return this._buttons;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
