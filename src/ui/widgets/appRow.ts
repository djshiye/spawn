// AppRow: list row for a Shell.App (All Apps / Frequent / category lists).
//
// Icon, name and (apps-show-extra-details) a dimmed description. Launch + context menu behave
// like AppTile. Also the list-mode rows of the pinned view (`pinned: true`) and ActionRow, the
// ActionTile twin for ghosts and pinned commands.
//
// Public API:
//   new AppRow(app: Shell.App, host: TileHost, opts?: RowOptions)
//   row.actor: St.Widget
//   row.app: Shell.App
//   row.destroy()
//   RowOptions: {iconSize?, description?: boolean, folderUuid?, symbolic?, name?, pinned?}
//   A pinned row is an outer transparent button (`spawn-pinned-row`) around a `spawn-row-surface` that draws it.
//   new ActionRow(name, icon, activate, host?, opts?)   arbitrary action; opts: {iconSize?, context?}

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import type Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import St from 'gi://St';

import type {TileHost} from './appTile.js';
import {makeItemButton, wireItem} from './interact.js';
import type {TooltipManager} from './tooltip.js';
import {symbolicGIcon} from '../util.js';

export interface RowOptions {
    iconSize?: number;
    description?: boolean;
    folderUuid?: string;
    /** Use the symbolic variant of the app icon. */
    symbolic?: boolean;
    /** Label text instead of the app name (apps-show-generic-names). */
    name?: string;
    /** A row of the pinned list (drag source / drop target, marked `spawn-pinned-row`). */
    pinned?: boolean;
}

export const DEFAULT_ROW_ICON_SIZE = 28;

/** Outer button of a pinned list row (transparent, full hit area) and its visible face (see interact.ts). */
export const PINNED_ROW_CLASS = 'spawn-pinned-row';
export const PINNED_ROW_BOX = 'spawn-row-box spawn-surface spawn-row-surface';


export class AppRow {
    readonly actor: St.Button;
    private readonly _app: Shell.App;

    constructor(app: Shell.App, host: TileHost, opts: RowOptions = {}) {
        this._app = app;
        const button = makeItemButton(opts.pinned ? PINNED_ROW_CLASS : 'spawn-row');
        this.actor = button;

        const box = new St.BoxLayout({style_class: opts.pinned ? PINNED_ROW_BOX : 'spawn-row-box', x_expand: true});
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

/** List-mode ActionTile: a row that runs an arbitrary action (ghost of a missing app, pinned command). */
export class ActionRow {
    readonly actor: St.Button;

    constructor(name: string, icon: Gio.Icon | string, activate: (ctrl: boolean) => void, host?: {tooltips?: TooltipManager},
        opts: {iconSize?: number; context?: () => void} = {}) {
        const button = makeItemButton(PINNED_ROW_CLASS);
        this.actor = button;
        const box = new St.BoxLayout({style_class: PINNED_ROW_BOX, x_expand: true});
        const iconActor = new St.Icon({
            style_class: 'spawn-row-icon',
            icon_size: opts.iconSize ?? DEFAULT_ROW_ICON_SIZE,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (typeof icon === 'string')
            iconActor.icon_name = icon;
        else
            iconActor.gicon = icon;
        box.add_child(iconActor);
        const label = new St.Label({text: name, style_class: 'spawn-row-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(label);
        button.set_child(box);
        host?.tooltips?.attach(button, label);
        wireItem(button, {activate, context: opts.context});
    }

    destroy(): void {
        this.actor.destroy();
    }
}
