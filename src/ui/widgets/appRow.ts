// AppRow: list row for a Shell.App (All Apps / Frequent / category lists).
//
// Icon, name and (apps-show-extra-details) a dimmed description. Launch + context menu behave
// like AppTile.
//
// Public API:
//   new AppRow(app: Shell.App, host: TileHost, opts?: RowOptions)
//   row.actor: St.Widget
//   row.app: Shell.App
//   row.destroy()
//   RowOptions: {iconSize?, description?: boolean, folderUuid?, symbolic?, name?}

import Clutter from 'gi://Clutter';
import type Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import St from 'gi://St';

import type {TileHost} from './appTile.js';
import {makeItemButton, wireItem} from './interact.js';
import {symbolicGIcon} from '../util.js';

export interface RowOptions {
    iconSize?: number;
    description?: boolean;
    folderUuid?: string;
    /** Use the symbolic variant of the app icon. */
    symbolic?: boolean;
    /** Label text instead of the app name (apps-show-generic-names). */
    name?: string;
}

export const DEFAULT_ROW_ICON_SIZE = 28;

export class AppRow {
    readonly actor: St.Button;
    private readonly _app: Shell.App;

    constructor(app: Shell.App, host: TileHost, opts: RowOptions = {}) {
        this._app = app;
        const button = makeItemButton('spawn-row');
        this.actor = button;

        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const icon = new St.Icon({
            style_class: 'spawn-row-icon',
            icon_size: opts.iconSize ?? DEFAULT_ROW_ICON_SIZE,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const gicon = opts.symbolic ? symbolicGIcon(app.get_icon()) : app.get_icon();
        if (gicon)
            icon.gicon = gicon;
        box.add_child(icon);

        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        const label = new St.Label({text: opts.name ?? app.get_name(), style_class: 'spawn-row-label'});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(label);
        const desc = opts.description ? app.get_description() : null;
        if (desc) {
            const dl = new St.Label({text: desc.split('\n')[0], style_class: 'spawn-row-description'});
            dl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(dl);
        }
        box.add_child(text);
        button.set_child(box);

        host.tooltips?.attach(button, label, desc ? () => `${app.get_name()}\n${desc}` : undefined);
        wireItem(button, {
            activate: ctrl => host.launch(app, ctrl),
            context: () => host.openContext(button, app, opts.folderUuid),
        });
    }

    get app(): Shell.App {
        return this._app;
    }

    destroy(): void {
        this.actor.destroy();
    }
}
