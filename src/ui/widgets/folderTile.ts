// FolderTile / FolderRow: pinned entry for a folder, as a grid tile or as a list row. Both show a
// rounded plate with a 2x2 preview of the folder's first apps (a folder-symbolic icon when none
// resolve) and the folder name: the tile puts the name under the plate, the row beside it with a
// trailing chevron. Click opens the FolderView, right-click / Menu key opens the folder context
// menu; a drop target for apps (the layout wires ui/dnd.ts).
//
// Public API:
//   new FolderTile(uuid: string, name: string, icons: Gio.Icon[], host: FolderHost, opts?)
//   new FolderRow(uuid, name, icons, host, opts?)     same API, list row (always one line; opts: {iconSize?, plateInset?})
//   tile.actor: St.Widget
//   tile.uuid: string
//   tile.update(name: string, icons: Gio.Icon[], count?: number): void   count = apps in the folder (the accessible name "Folder: X, N apps")
//   tile.setWidth(px)
//   tile.destroy()
//   FolderHost: {open(uuid, pointer?), openContext(tile, uuid), tooltips?}   pointer: opened with a click
//   opts: {iconSize?, multiLine?, count?}

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DEFAULT_ROW_ICON_SIZE, PINNED_ROW_BOX, PINNED_ROW_CLASS} from './appRow.js';
import {DEFAULT_TILE_ICON_SIZE, styleTileLabel} from './appTile.js';
import {nameItem} from './a11y.js';
import {makeItemButton, makeSurface, wireItem} from './interact.js';
import type {TooltipManager} from './tooltip.js';
import {isPointerEvent} from '../util.js';

export interface FolderHost {
    /** `pointer`: opened with a click (the popup then highlights nothing until hover or an arrow key). */
    open(uuid: string, pointer?: boolean): void;
    openContext(tile: St.Widget, uuid: string): void;
    tooltips?: TooltipManager;
}

// Grid plate: 4 + 16 + 8 + 16 + 4 = 48, exactly an app icon tall.
// List plate (28 px): 2 + 11 + 2 + 11 + 2 = 28.
// Keep in step with .spawn-folder-plate / .spawn-folder-plate-row (and the .spawn-folder-row
// overrides) in stylesheet.css.
const PLATE_PADDING = 4;
const PLATE_SPACING = 8;
const ROW_PLATE_PADDING = 2;
const ROW_PLATE_SPACING = 2;

/** "Folder: Work, 3 apps". */
function folderName(name: string, count: number): string {
    return `${_('Folder: %s').replace('%s', name)}, ${ngettext('%d app', '%d apps', count).replace('%d', String(count))}`;
}

/** The rounded folder icon: up to four mini app icons, or a folder glyph when there are none. */
class FolderPlate {
    readonly actor: St.BoxLayout;
    private readonly _rows: [St.BoxLayout, St.BoxLayout];
    private readonly _fallback: St.Icon;
    private readonly _mini: number;

    constructor(size: number, padding: number, spacing: number) {
        this._mini = Math.max(8, Math.floor((size - 2 * padding - spacing) / 2));
        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'spawn-folder-plate',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            width: size,
            height: size,
        });
        this._rows = [
            new St.BoxLayout({style_class: 'spawn-folder-plate-row', x_align: Clutter.ActorAlign.CENTER, y_expand: true}),
            new St.BoxLayout({style_class: 'spawn-folder-plate-row', x_align: Clutter.ActorAlign.CENTER, y_expand: true}),
        ];
        this.actor.add_child(this._rows[0]);
        this.actor.add_child(this._rows[1]);
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
        this.actor.add_child(this._fallback);
    }

    update(icons: Gio.Icon[]): void {
        for (const row of this._rows) {
            for (const c of row.get_children())
                c.destroy();
        }
        const shown = icons.slice(0, 4);
        shown.forEach((gicon, i) => {
            const icon = new St.Icon({
                gicon,
                icon_size: this._mini,
                style_class: 'spawn-folder-mini',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._rows[i < 2 ? 0 : 1].add_child(icon);
        });
        const empty = shown.length === 0;
        this._rows[0].visible = !empty;
        this._rows[1].visible = !empty;
        this._fallback.visible = empty;
    }
}

export class FolderTile {
    readonly actor: St.Button;
    private readonly _uuid: string;
    private readonly _label: St.Label;
    private readonly _plate: FolderPlate;

    constructor(uuid: string, name: string, icons: Gio.Icon[], host: FolderHost, opts: {iconSize?: number; multiLine?: boolean; count?: number} = {}) {
        this._uuid = uuid;
        const size = opts.iconSize ?? DEFAULT_TILE_ICON_SIZE;

        const button = makeItemButton('spawn-tile spawn-folder-tile');
        this.actor = button;
        button.x_expand = false;
        if (opts.multiLine)
            button.y_expand = true;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: opts.multiLine ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER,
            style_class: 'spawn-tile-box',
        });
        this._plate = new FolderPlate(size, PLATE_PADDING, PLATE_SPACING);
        this._label = new St.Label({
            text: name,
            style_class: 'spawn-tile-label',
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        styleTileLabel(this._label, Boolean(opts.multiLine));
        box.add_child(this._plate.actor);
        box.add_child(this._label);
        const surface = makeSurface('spawn-tile-surface');
        surface.set_child(box);
        button.set_child(surface);

        host.tooltips?.attach(button, this._label);
        wireItem(button, {
            activate: () => host.open(uuid, isPointerEvent()),
            context: () => host.openContext(button, uuid),
        });
        this.update(name, icons, opts.count);
    }

    get uuid(): string {
        return this._uuid;
    }

    update(name: string, icons: Gio.Icon[], count = icons.length): void {
        this._label.text = name;
        this._plate.update(icons);
        nameItem(this.actor, folderName(name, count), {label: this._label});
    }

    setWidth(px: number): void {
        this.actor.set_width(px);
    }

    destroy(): void {
        this.actor.destroy();
    }
}

/** List-mode twin of FolderTile: plate, name and a trailing chevron in a full-width `.spawn-row`. */
export class FolderRow {
    readonly actor: St.Button;
    private readonly _uuid: string;
    private readonly _label: St.Label;
    private readonly _plate: FolderPlate;

    constructor(uuid: string, name: string, icons: Gio.Icon[], host: FolderHost, opts: {iconSize?: number; plateInset?: number; count?: number} = {}) {
        this._uuid = uuid;
        const size = opts.iconSize ?? DEFAULT_ROW_ICON_SIZE;
        const button = makeItemButton(`${PINNED_ROW_CLASS} spawn-folder-row`);
        this.actor = button;

        const box = new St.BoxLayout({style_class: PINNED_ROW_BOX, x_expand: true});
        this._plate = new FolderPlate(size, opts.plateInset ?? ROW_PLATE_PADDING, ROW_PLATE_SPACING);
        box.add_child(this._plate.actor);
        this._label = new St.Label({text: name, style_class: 'spawn-row-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._label);
        box.add_child(new St.Icon({
            icon_name: 'go-next-symbolic',
            icon_size: 16,
            style_class: 'spawn-folder-chevron',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        button.set_child(box);

        host.tooltips?.attach(button, this._label);
        wireItem(button, {
            activate: () => host.open(uuid, isPointerEvent()),
            context: () => host.openContext(button, uuid),
        });
        this.update(name, icons, opts.count);
    }

    get uuid(): string {
        return this._uuid;
    }

    update(name: string, icons: Gio.Icon[], count = icons.length): void {
        this._label.text = name;
        this._plate.update(icons);
        nameItem(this.actor, folderName(name, count), {label: this._label});
    }

    destroy(): void {
        this.actor.destroy();
    }
}
