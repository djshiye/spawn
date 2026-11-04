// FolderTile: pinned-grid tile for a folder: a rounded plate with a 2x2 preview of its first
// apps (a folder-symbolic icon when none resolve) over the folder name. Click opens the FolderView, right-click / Menu key opens the folder
// context menu; a drop target for apps (the layout wires ui/dnd.ts).
//
// Public API:
//   new FolderTile(uuid: string, name: string, icons: Gio.Icon[], host: FolderHost, opts?)
//   tile.actor: St.Widget
//   tile.uuid: string
//   tile.update(name: string, icons: Gio.Icon[]): void
//   tile.setWidth(px)
//   tile.destroy()
//   FolderHost: {open(uuid), openContext(tile, uuid), tooltips?}
//   opts: {iconSize?}

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {DEFAULT_TILE_ICON_SIZE} from './appTile.js';
import {makeItemButton, wireItem} from './interact.js';
import type {TooltipManager} from './tooltip.js';

export interface FolderHost {
    open(uuid: string): void;
    openContext(tile: St.Widget, uuid: string): void;
    tooltips?: TooltipManager;
}

const PLATE_PADDING = 5;
const PLATE_SPACING = 3;

export class FolderTile {
    readonly actor: St.Button;
    private readonly _uuid: string;
    private readonly _label: St.Label;
    private readonly _rows: [St.BoxLayout, St.BoxLayout];
    private readonly _fallback: St.Icon;
    private readonly _mini: number;

    constructor(uuid: string, name: string, icons: Gio.Icon[], host: FolderHost, opts: {iconSize?: number} = {}) {
        this._uuid = uuid;
        const size = opts.iconSize ?? DEFAULT_TILE_ICON_SIZE;
        this._mini = Math.floor((size - 2 * PLATE_PADDING - PLATE_SPACING) / 2);

        const button = makeItemButton('spawn-tile spawn-folder-tile');
        this.actor = button;
        button.x_expand = false;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'spawn-tile-box',
        });
        const plate = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'spawn-folder-plate',
            x_align: Clutter.ActorAlign.CENTER,
            width: size,
            height: size,
        });
        this._rows = [
            new St.BoxLayout({style_class: 'spawn-folder-plate-row', x_align: Clutter.ActorAlign.CENTER, y_expand: true}),
            new St.BoxLayout({style_class: 'spawn-folder-plate-row', x_align: Clutter.ActorAlign.CENTER, y_expand: true}),
        ];
        plate.add_child(this._rows[0]);
        plate.add_child(this._rows[1]);
        // Shown instead of the mini grid when none of the folder's apps resolve (all missing / empty).
        this._fallback = new St.Icon({
            icon_name: 'folder-symbolic',
            icon_size: Math.floor(size / 2),
            style_class: 'spawn-folder-fallback',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            visible: false,
        });
        plate.add_child(this._fallback);
        this._label = new St.Label({
            text: name,
            style_class: 'spawn-tile-label',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(plate);
        box.add_child(this._label);
        button.set_child(box);

        host.tooltips?.attach(button, this._label);
        wireItem(button, {
            activate: () => host.open(uuid),
            context: () => host.openContext(button, uuid),
        });
        this.update(name, icons);
    }

    get uuid(): string {
        return this._uuid;
    }

    update(name: string, icons: Gio.Icon[]): void {
        this._label.text = name;
        for (const row of this._rows) {
            for (const c of row.get_children())
                c.destroy();
        }
        const shown = icons.slice(0, 4);
        shown.forEach((gicon, i) => {
            const icon = new St.Icon({gicon, icon_size: this._mini, style_class: 'spawn-folder-mini'});
            this._rows[i < 2 ? 0 : 1].add_child(icon);
        });
        const empty = shown.length === 0;
        this._rows[0].visible = !empty;
        this._rows[1].visible = !empty;
        this._fallback.visible = empty;
    }

    setWidth(px: number): void {
        this.actor.set_width(px);
    }

    destroy(): void {
        this.actor.destroy();
    }
}
