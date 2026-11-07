// AppTile: pinned-grid tile for a Shell.App (icon over a one-line name).
//
// Long names wrap onto two lines (then an ellipsis) when `multiLine` is set (`multi-lined-labels`);
// the tiles of a row then stretch to the tallest one with their content aligned to the top.
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
//   TileOptions: {folderUuid?, iconSize?, multiLine?, name?, context?}
//   new ActionTile(name, icon, activate, host?, opts?)   same look, arbitrary action;
//                                                        opts.context = right click / Menu key
//   styleTileLabel(label, multiLine)                     shared by FolderTile

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import type Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {nameItem} from './a11y.js';
import {makeItemButton, makeSurface, wireItem} from './interact.js';
import type {TooltipManager} from './tooltip.js';

export interface TileHost {
    launch(app: Shell.App, ctrl: boolean): void;
    openContext(tile: St.Widget, app: Shell.App, folderUuid?: string): void;
    tooltips?: TooltipManager;
}

export interface TileOptions {
    folderUuid?: string;
    iconSize?: number;
    /** Wrap the name onto up to two lines instead of one ellipsized line. */
    multiLine?: boolean;
    /** Label text instead of the app name (apps-show-generic-names). */
    name?: string;
    /** ActionTile only: opens the tile's context menu. */
    context?: () => void;
}

export const DEFAULT_TILE_ICON_SIZE = 48;

export class AppTile {
    readonly actor: St.Button;
    private readonly _app: Shell.App;

    constructor(app: Shell.App, host: TileHost, opts: TileOptions = {}) {
        this._app = app;
        const button = makeItemButton('spawn-tile');
        this.actor = button;
        buildTileContent(button, opts.name ?? app.get_name(), app.get_icon(), opts.iconSize ?? DEFAULT_TILE_ICON_SIZE, host.tooltips, opts.multiLine);
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
        const button = makeItemButton('spawn-tile');
        this.actor = button;
        buildTileContent(button, name, icon, opts.iconSize ?? DEFAULT_TILE_ICON_SIZE, host?.tooltips, opts.multiLine);
        wireItem(button, {activate, context: opts.context});
    }

    setWidth(px: number): void {
        this.actor.set_width(px);
    }

    destroy(): void {
        this.actor.destroy();
    }
}

/**
 * One ellipsized line, or (multiLine) up to two wrapped lines: the label is capped at two lines'
 * height by `.spawn-tile-label-multi` and Clutter.Text ellipsizes what does not fit.
 */
export function styleTileLabel(label: St.Label, multiLine: boolean): void {
    const ct = label.clutter_text;
    ct.ellipsize = Pango.EllipsizeMode.END;
    if (multiLine) {
        label.add_style_class_name('spawn-tile-label-multi');
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    }
}

/** Icon + name label inside `button`; returns both. */
export function buildTileContent(button: St.Button, name: string, icon: Gio.Icon | string | null, iconSize: number, tooltips?: TooltipManager, multiLine = false): {icon: St.Icon; label: St.Label} {
    button.x_expand = false;
    if (multiLine)
        button.y_expand = true;
    const box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: multiLine ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER,
        style_class: 'spawn-tile-box',
    });
    const iconActor = new St.Icon({
        style_class: 'spawn-tile-icon',
        icon_size: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
    });
    if (typeof icon === 'string')
        iconActor.icon_name = icon;
    else if (icon)
        iconActor.gicon = icon;
    const label = new St.Label({
        text: name,
        style_class: 'spawn-tile-label',
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    styleTileLabel(label, multiLine);
    box.add_child(iconActor);
    box.add_child(label);
    const surface = makeSurface('spawn-tile-surface');
    surface.set_child(box);
    button.set_child(surface);
    nameItem(button, name, {label});
    tooltips?.attach(button, label);
    return {icon: iconActor, label};
}
