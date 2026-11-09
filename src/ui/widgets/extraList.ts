// ExtraList: the content of the two views behind the Favorites and Recent Files quick links: a flat list
// of rows in a vertical box that the layout puts into a scroll view (views 'favorites' and 'recent').
//
// Favorites: GNOME Shell's favourites (AppIndex.favorites) as ordinary app rows. Recent Files: the newest
// 25 live files from the shared RecentFilesProvider cache (opened with their default application; "More
// Recent Files..." opens recent:/// when older ones exist). When GNOME's File History switch is off
// (org.gnome.desktop.privacy remember-recent-files) the list is empty and says why. Rows are rebuilt every
// time the view is shown.
//
// Public API:
//   new ExtraList(services: Services, host: ExtraListHost)
//   list.actor: St.BoxLayout
//   list.show(kind: 'favorites' | 'recent'): void   rebuild the rows
//   list.rows(): St.Widget[]                        the rows (keyboard group)
//   list.destroy()
//   ExtraListHost extends TileHost: {close(), keepOpen?}   close() closes the popup

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {Services} from '../../core/services.js';
import type {RecentItem} from '../../search/providers/recentFiles.js';
import {displayName, iconSizeFor, showDescriptions} from '../util.js';
import {markList, nameItem} from './a11y.js';
import {AppRow} from './appRow.js';
import type {TileHost} from './appTile.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';

/** Like ArcMenu's list: the 25 most recent files. */
export const MAX_RECENT_FILES = 25;

export interface ExtraListHost extends TileHost {
    close(): void;
}

export class ExtraList {
    readonly actor: St.BoxLayout;
    private readonly _services: Services;
    private readonly _host: ExtraListHost;

    constructor(services: Services, host: ExtraListHost) {
        this._services = services;
        this._host = host;
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-list'});
    }

    show(kind: 'favorites' | 'recent'): void {
        markList(this.actor, kind === 'favorites' ? _('Favourite apps') : _('Recent files'));
        this._host.tooltips?.hide();
        for (const c of this.actor.get_children())
            c.destroy();
        try {
            if (kind === 'favorites')
                this._fillFavorites();
            else
                this._fillRecent();
        } catch (e) {
            error(`could not build the ${kind} list`, e);
        }
        // each row carries 1 px of the pitch below it: the last one has nothing to separate from (the scroll range)
        (this.actor.get_last_child() as St.Widget | null)?.set_style('padding-bottom: 0;');
    }

    rows(): St.Widget[] {
        return this.actor.get_children().filter((c): c is St.Button => c instanceof St.Button);
    }

    destroy(): void {
        this.actor.destroy();
    }

    private _empty(text: string): void {
        this.actor.add_child(new St.Label({
            text,
            style_class: 'spawn-empty-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        }));
    }

    private _fillFavorites(): void {
        const s = this._services.settings;
        const opts = {iconSize: iconSizeFor(s, 'icon-size-apps', 28), description: showDescriptions(s)};
        const apps = this._services.appIndex.favorites();
        for (const app of apps)
            this.actor.add_child(new AppRow(app, this._host, {...opts, name: displayName(app, s)}).actor);
        if (apps.length === 0)
            this._empty(_('No favourites'));
    }

    private _fillRecent(): void {
        const recent = this._services.recentFiles.list(MAX_RECENT_FILES);
        if (!recent.remembering) {
            this._empty(_('File history is turned off in the privacy settings'));
            return;
        }
        if (recent.more)
            this.actor.add_child(this._moreRow());
        for (const entry of recent.entries)
            this.actor.add_child(this._fileRow(entry));
        if (recent.entries.length === 0)
            this._empty(_('No recent files'));
    }

    private _row(iconName: string | Gio.Icon, title: string, description: string | null, activate: (ctrl: boolean) => void): St.Button {
        const size = iconSizeFor(this._services.settings, 'icon-size-apps', 28);
        const button = makeItemButton('spawn-list-row');
        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const icon = new St.Icon({style_class: 'spawn-row-icon', icon_size: size, y_align: Clutter.ActorAlign.CENTER});
        if (typeof iconName === 'string')
            icon.icon_name = iconName;
        else
            icon.gicon = iconName;
        box.add_child(icon);
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        const label = new St.Label({text: title, style_class: 'spawn-row-label'});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(label);
        if (description) {
            const dl = new St.Label({text: description, style_class: 'spawn-row-description'});
            dl.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            text.add_child(dl);
        }
        box.add_child(text);
        button.set_child(makeFace('spawn-row-surface', box));
        nameItem(button, title, {label, description, listItem: true});
        this._host.tooltips?.attach(button, label);
        wireItem(button, {activate: ctrl => activate(ctrl)});
        return button;
    }

    private _fileRow(entry: RecentItem): St.Button {
        const gicon = entry.mime ? Gio.content_type_get_icon(entry.mime) : Gio.ThemedIcon.new('text-x-generic');
        return this._row(gicon, entry.name, entry.folder, ctrl => {
            this._services.recentFiles.open(entry);
            if (!(ctrl && this._services.settings.get('keep-open-on-ctrl-click')))
                this._host.close();
        });
    }

    private _moreRow(): St.Button {
        return this._row('document-open-recent-symbolic', _('More Recent Files...'), null, () => {
            this._host.close();
            try {
                Gio.AppInfo.launch_default_for_uri('recent:///', global.create_app_launch_context(0, -1));
            } catch (e) {
                if (!(e instanceof GLib.Error))
                    throw e;
                error('could not open recent:///', e);
            }
        });
    }
}
