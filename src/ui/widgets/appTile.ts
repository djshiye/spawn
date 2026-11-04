// AppTile: pinned-grid tile for a Shell.App (icon over a one-line name).
//
// Click launches (Ctrl / middle click = new window and, with keep-open-on-ctrl-click, keeps the
// menu open), right-click / Menu key / Shift+F10 opens the context menu, draggable (the layout
// wires ui/dnd.ts). Also ActionTile for custom pinned entries (commands).
//
// Public API:
//   new AppTile(app: Shell.App, host: TileHost, opts?: TileOptions)
//   tile.actor: St.Widget
//   tile.app: Shell.App
//   tile.setWidth(px)
//   tile.destroy()
//   TileHost: {launch(app, ctrl), openContext(tile, app, folderUuid?), tooltips?}
//   TileOptions: {folderUuid?, iconSize?}
//   new ActionTile(name, icon, activate, host?, opts?)   same look, arbitrary action

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import type Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {makeItemButton, wireItem} from './interact.js';
import type {TooltipManager} from './tooltip.js';

export interface TileHost {
    launch(app: Shell.App, ctrl: boolean): void;
    openContext(tile: St.Widget, app: Shell.App, folderUuid?: string): void;
    tooltips?: TooltipManager;
}

export interface TileOptions {
    folderUuid?: string;
    iconSize?: number;
}

export const DEFAULT_TILE_ICON_SIZE = 48;

export class AppTile {
    readonly actor: St.Button;
    private readonly _app: Shell.App;

    constructor(app: Shell.App, host: TileHost, opts: TileOptions = {}) {
        this._app = app;
        const button = makeItemButton('spawn-menu-tile');
        this.actor = button;
        buildTileContent(button, app.get_name(), app.get_icon(), opts.iconSize ?? DEFAULT_TILE_ICON_SIZE, host.tooltips);
        wireItem(button, {
            activate: ctrl => host.launch(app, ctrl),
            context: () => host.openContext(button, app, opts.folderUuid),
        });
    }

    get app(): Shell.App {
        return this._app;
    }

    setWidth(px: number): void {
        this.actor.set_width(px);
    }

    destroy(): void {
        this.actor.destroy();
    }
}

export class ActionTile {
    readonly actor: St.Button;

    constructor(name: string, icon: Gio.Icon | string, activate: (ctrl: boolean) => void, host?: {tooltips?: TooltipManager}, opts: TileOptions = {}) {
        const button = makeItemButton('spawn-menu-tile');
        this.actor = button;
        buildTileContent(button, name, icon, opts.iconSize ?? DEFAULT_TILE_ICON_SIZE, host?.tooltips);
        wireItem(button, {activate});
    }

    setWidth(px: number): void {
        this.actor.set_width(px);
    }

    destroy(): void {
        this.actor.destroy();
    }
}

/** Icon + one-line label inside `button`; returns both. */
export function buildTileContent(button: St.Button, name: string, icon: Gio.Icon | string | null, iconSize: number, tooltips?: TooltipManager): {icon: St.Icon; label: St.Label} {
    button.x_expand = false;
    const box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'spawn-menu-tile-box',
    });
    const iconActor = new St.Icon({
        style_class: 'spawn-menu-tile-icon',
        icon_size: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
    });
    if (typeof icon === 'string')
        iconActor.icon_name = icon;
    else if (icon)
        iconActor.gicon = icon;
    const label = new St.Label({
        text: name,
        style_class: 'spawn-menu-tile-label',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    box.add_child(iconActor);
    box.add_child(label);
    button.set_child(box);
    tooltips?.attach(button, label);
    return {icon: iconActor, label};
}
