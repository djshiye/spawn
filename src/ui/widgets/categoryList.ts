// CategoryList: the "All apps" view. A category column on the left (All Apps, Frequent, then the
// GMenu categories) and the apps of the selected category as rows on the right. Rows are built
// lazily per category and cached until AppIndex reports a change. Moving focus onto a category
// (keyboard) or clicking it selects it.
//
// Public API:
//   new CategoryList(scope: Scope, services: Services, host: TileHost)
//   list.actor: St.Widget
//   list.showCategory(id: string): void   ('all' | 'frequent' | GMenu id)
//   list.refresh(): void                  drop cached rows and rebuild what is visible
//   list.setColumnVisible(visible)        false = flat "all apps" list without the category column
//   list.columnScroll() / list.appScroll()   the two scroll views (scroll settings are re-applied live)
//   list.categoryButtons(): St.Widget[]
//   list.appRows(): St.Widget[]           rows of the selected category
//   list.selectedId: string
//   list.destroy()

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {applyScrollSettings, displayName, iconSizeFor} from '../util.js';
import {AppRow} from './appRow.js';
import type {TileHost} from './appTile.js';
import {makeItemButton, wireItem} from './interact.js';

interface CategoryEntry {
    id: string;
    name: string;
    icon: string;
}

/** Adwaita symbolic icon for a GMenu category (the menu data only ships colourful ones). */
export function symbolicCategoryIcon(id: string, name: string): string {
    const key = `${id} ${name}`.toLowerCase();
    const table: Array<[RegExp, string]> = [
        [/audio|video|sound|multimedia/, 'applications-multimedia-symbolic'],
        [/develop|program/, 'applications-engineering-symbolic'],
        [/edu|science/, 'applications-science-symbolic'],
        [/game/, 'applications-games-symbolic'],
        [/graphic/, 'applications-graphics-symbolic'],
        [/network|internet/, 'web-browser-symbolic'],
        [/office/, 'x-office-document-symbolic'],
        [/setting|system/, 'applications-system-symbolic'],
        [/access|util/, 'applications-utilities-symbolic'],
    ];
    for (const [re, icon] of table) {
        if (re.test(key))
            return icon;
    }
    return 'view-more-symbolic';
}

export class CategoryList {
    readonly actor: St.BoxLayout;
    private readonly _services: Services;
    private readonly _host: TileHost;
    private readonly _column: St.ScrollView;
    private readonly _columnBox: St.BoxLayout;
    private readonly _appsScroll: St.ScrollView;
    private readonly _appsBox: St.BoxLayout;
    private readonly _separator: St.Widget;
    private readonly _lists = new Map<string, St.BoxLayout>();
    private readonly _buttons = new Map<string, St.Button>();
    private _selected = 'all';
    private _columnVisible = true;
    private _built = false;
    private _dirty = false;
    private _destroyed = false;

    constructor(scope: Scope, services: Services, host: TileHost) {
        this._services = services;
        this._host = host;
        this.actor = new St.BoxLayout({style_class: 'spawn-category-list', x_expand: true, y_expand: true});

        this._columnBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'spawn-category-column-box'});
        this._column = this._makeScroll(this._columnBox, 'spawn-category-column');
        this._separator = new St.Widget({style_class: 'spawn-vseparator', y_expand: true});
        this._appsBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-category-apps-box'});
        this._appsScroll = this._makeScroll(this._appsBox, 'spawn-category-apps');
        this._appsScroll.x_expand = true;

        this.actor.add_child(this._column);
        this.actor.add_child(this._separator);
        this.actor.add_child(this._appsScroll);

        services.appIndex.onChanged(scope, () => {
            if (this.actor.mapped)
                this.refresh();
            else
                this._dirty = true;
        });
        scope.add(() => this.destroy(), 'CategoryList');
    }

    get selectedId(): string {
        return this._selected;
    }

    /** Build the category column and show the selection; call when the view becomes visible. */
    ensureBuilt(): void {
        if (this._destroyed)
            return;
        if (this._dirty) {
            this._dirty = false;
            this.refresh();
            return;
        }
        if (!this._built)
            this._buildColumn();
        this._showList(this._selected);
    }

    showCategory(id: string): void {
        if (this._destroyed)
            return;
        this._selected = id;
        if (!this._built)
            this._buildColumn();
        this._showList(id);
    }

    refresh(): void {
        if (this._destroyed)
            return;
        this._host.tooltips?.hide();
        for (const l of this._lists.values())
            l.destroy();
        this._lists.clear();
        for (const c of this._columnBox.get_children())
            c.destroy();
        this._buttons.clear();
        this._built = false;
        this._buildColumn();
        if (!this._buttons.has(this._selected))
            this._selected = 'all';
        this._showList(this._selected);
    }

    setColumnVisible(visible: boolean): void {
        this._columnVisible = visible;
        this._column.visible = visible;
        this._separator.visible = visible;
        if (!visible)
            this.showCategory('all');
    }

    categoryButtons(): St.Widget[] {
        return this._columnVisible ? [...this._buttons.values()] : [];
    }

    appRows(): St.Widget[] {
        const list = this._lists.get(this._selected);
        return list ? list.get_children() as St.Widget[] : [];
    }

    appScroll(): St.ScrollView {
        return this._appsScroll;
    }

    /** The category column's scroll view (the layout re-applies scroll settings to both). */
    columnScroll(): St.ScrollView {
        return this._column;
    }

    destroy(): void {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this.actor.destroy();
    }

    private _makeScroll(child: St.BoxLayout, styleClass: string): St.ScrollView {
        const settings = this._services.settings;
        const scroll = new St.ScrollView({
            style_class: styleClass,
            hscrollbar_policy: St.PolicyType.NEVER,
            y_expand: true,
        });
        applyScrollSettings(scroll, settings);
        scroll.add_child(child);
        return scroll;
    }

    private _categories(): CategoryEntry[] {
        const out: CategoryEntry[] = [
            {id: 'all', name: _('All Apps'), icon: 'view-app-grid-symbolic'},
            {id: 'frequent', name: _('Frequent'), icon: 'document-open-recent-symbolic'},
        ];
        const symbolic = this._services.settings.get('icon-style-categories') === 'Symbolic';
        for (const c of this._services.appIndex.categories())
            out.push({id: c.id, name: c.name, icon: symbolic ? symbolicCategoryIcon(c.id, c.name) : c.iconName || 'applications-other'});
        return out;
    }

    private _buildColumn(): void {
        const size = iconSizeFor(this._services.settings, 'icon-size-categories', 16);
        for (const cat of this._categories()) {
            const button = makeItemButton('spawn-row spawn-category-row');
            const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
            const icon = new St.Icon({style_class: 'spawn-category-icon', icon_size: size, y_align: Clutter.ActorAlign.CENTER});
            icon.gicon = Gio.ThemedIcon.new(cat.icon);
            const label = new St.Label({text: cat.name, style_class: 'spawn-row-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(icon);
            box.add_child(label);
            button.set_child(box);
            this._host.tooltips?.attach(button, label);
            wireItem(button, {activate: () => this.showCategory(cat.id)});
            button.connect('key-focus-in', () => this.showCategory(cat.id));
            this._columnBox.add_child(button);
            this._buttons.set(cat.id, button);
        }
        this._built = true;
    }

    private _showList(id: string): void {
        for (const [bid, b] of this._buttons) {
            if (bid === id)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
        }
        let list = this._lists.get(id);
        // The frequent list reflects live usage: rebuild every time it is shown.
        if (id === 'frequent' && list) {
            this._host.tooltips?.hide();
            list.destroy();
            this._lists.delete(id);
            list = undefined;
        }
        if (!list) {
            list = this._buildList(id);
            this._lists.set(id, list);
            this._appsBox.add_child(list);
        }
        for (const [lid, l] of this._lists)
            l.visible = lid === id;
        this._appsScroll.vadjustment.value = 0;
    }

    private _buildList(id: string): St.BoxLayout {
        const settings = this._services.settings;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        try {
            const limit = id === 'frequent' ? Math.max(0, settings.get('max-frequent-apps')) : 0;
            const apps = this._services.appIndex.categoryApps(id, limit);
            const opts = {
                iconSize: iconSizeFor(settings, 'icon-size-apps', 28),
                description: settings.get('apps-show-extra-details'),
            };
            for (const app of apps)
                box.add_child(new AppRow(app, this._host, {...opts, name: displayName(app, settings)}).actor);
            if (apps.length === 0) {
                box.add_child(new St.Label({
                    text: id === 'frequent' ? _('Nothing here yet') : _('No apps'),
                    style_class: 'spawn-empty-label',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: true,
                }));
            }
        } catch (e) {
            error(`could not build category ${id}`, e);
        }
        return box;
    }
}
