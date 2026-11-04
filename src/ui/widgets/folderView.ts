// FolderView: the contents of one pinned folder, shown in place of the pinned grid. Header with a
// back button and the folder name (click to rename inline), then the apps as a tile grid.
// Tiles are draggable (reorder inside the folder via ui/dnd.ts) and can be dropped onto the
// header to take them out of the folder. Rebuilt from PinnedStore whenever it changes.
//
// Public API:
//   new FolderView(scope: Scope, services: Services, host: FolderViewHost)
//   view.actor: St.Widget
//   view.show(uuid: string): void
//   view.refresh(): void              re-sync with the store (also called on store changes)
//   view.uuid: string | null
//   view.tiles(): St.Widget[]         app tiles in order (keyboard nav)
//   view.headerButtons(): St.Widget[] back + name buttons
//   view.startRename(): void
//   view.scroll: St.ScrollView
//   view.destroy()
//   FolderViewHost: TileHost & {back(), metrics?(): {columns, tileWidth, iconSize}}

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {acceptDrops, enableDrag} from '../dnd.js';
import {lookupApp} from '../util.js';
import {AppTile, type TileHost} from './appTile.js';
import {makeItemButton, wireItem} from './interact.js';
import {TileGrid} from './tileGrid.js';

export type FolderViewHost = TileHost & {
    back(): void;
    metrics?(): {columns: number; tileWidth: number; iconSize: number};
};

export class FolderView {
    readonly actor: St.BoxLayout;
    readonly scroll: St.ScrollView;
    private readonly _services: Services;
    private readonly _host: FolderViewHost;
    private readonly _header: St.BoxLayout;
    private readonly _backButton: St.Button;
    private readonly _nameButton: St.Button;
    private readonly _nameLabel: St.Label;
    private readonly _hint: St.Label;
    private readonly _grid = new TileGrid();
    private _entry: St.Entry | null = null;
    private _finish: ((commit: boolean) => void) | null = null;
    private _uuid: string | null = null;
    private _tiles: St.Widget[] = [];
    private _tileScope: Scope;
    private _destroyed = false;

    constructor(scope: Scope, services: Services, host: FolderViewHost) {
        this._services = services;
        this._host = host;
        this._tileScope = scope.child('folder tiles');

        this.actor = new St.BoxLayout({
            style_class: 'spawn-folder-view',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        this._header = new St.BoxLayout({style_class: 'spawn-folder-header', reactive: true});
        this._backButton = makeItemButton('spawn-row spawn-folder-back');
        this._backButton.x_expand = false;
        this._backButton.set_child(new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 16}));
        wireItem(this._backButton, {activate: () => host.back()});
        host.tooltips?.attach(this._backButton, null, () => 'Back');

        this._nameButton = makeItemButton('spawn-row spawn-folder-name');
        this._nameButton.x_expand = false;
        const nameBox = new St.BoxLayout({style_class: 'spawn-row-box'});
        this._nameLabel = new St.Label({style_class: 'spawn-folder-title', y_align: Clutter.ActorAlign.CENTER});
        this._nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        nameBox.add_child(this._nameLabel);
        nameBox.add_child(new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 14, style_class: 'spawn-folder-edit-icon', y_align: Clutter.ActorAlign.CENTER}));
        this._nameButton.set_child(nameBox);
        wireItem(this._nameButton, {activate: () => this.startRename()});
        host.tooltips?.attach(this._nameButton, null, () => 'Rename folder');

        this._hint = new St.Label({text: 'Drop here to take out of folder', style_class: 'spawn-folder-hint', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._header.add_child(this._backButton);
        this._header.add_child(this._nameButton);
        this._header.add_child(this._hint);
        this.actor.add_child(this._header);

        const settings = services.settings;
        this.scroll = new St.ScrollView({
            style_class: settings.get('scrollview-fade-effect') ? 'vfade' : '',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: settings.get('scrollbars-visible') ? St.PolicyType.AUTOMATIC : St.PolicyType.EXTERNAL,
            overlay_scrollbars: settings.get('scrollbars-overlay'),
            y_expand: true,
        });
        this.scroll.add_child(this._grid.actor);
        this.actor.add_child(this.scroll);

        services.pinned.onChanged(scope, () => {
            if (this._uuid && this.actor.mapped)
                this.refresh();
        });
        scope.add(() => this.destroy(), 'FolderView');
    }

    get uuid(): string | null {
        return this._uuid;
    }

    tiles(): St.Widget[] {
        return this._tiles;
    }

    headerButtons(): St.Widget[] {
        return [this._backButton, this._nameButton];
    }

    show(uuid: string): void {
        this._uuid = uuid;
        this._cancelRename();
        this.refresh();
        this.scroll.vadjustment.value = 0;
    }

    refresh(): void {
        if (this._destroyed || !this._uuid)
            return;
        const store = this._services.pinned;
        const uuid = this._uuid;
        const folder = store.items().find(i => i.kind === 'folder' && i.uuid === uuid);
        if (!folder || folder.kind !== 'folder') {
            // Emptied or deleted: nothing left to show.
            this._uuid = null;
            this._host.back();
            return;
        }
        if (!this._entry)
            this._nameLabel.text = folder.name;

        this._host.tooltips?.hide();
        // Per-tile drag/drop registrations live in a scope that is reset on every rebuild.
        this._tileScope.dispose();
        acceptDrops(this._tileScope, this._header, store, {kind: 'unfolder', folderUuid: uuid});

        for (const t of this._tiles)
            t.destroy();
        const metrics = this._host.metrics?.() ?? {columns: 4, tileWidth: 96, iconSize: 48};
        const tiles: St.Widget[] = [];
        for (const entry of store.folderApps(uuid)) {
            const app = lookupApp(this._services, entry.id);
            if (!app)
                continue;
            const tile = new AppTile(app, this._host, {folderUuid: uuid, iconSize: metrics.iconSize});
            enableDrag(this._tileScope, tile.actor, {
                id: entry.id,
                folderUuid: uuid,
                onDragBegin: () => this._setDragging(true),
                onDragEnd: () => this._setDragging(false),
            });
            acceptDrops(this._tileScope, tile.actor, store, {kind: 'app', id: entry.id, folderUuid: uuid});
            tiles.push(tile.actor);
        }
        this._tiles = tiles;
        this._grid.setTiles(tiles, metrics.columns, metrics.tileWidth);
        acceptDrops(this._tileScope, this._grid.actor, store, {kind: 'grid', index: () => -1, folderUuid: uuid});
    }

    startRename(): void {
        if (!this._uuid || this._entry || this._destroyed)
            return;
        const uuid = this._uuid;
        const entry = new St.Entry({
            text: this._nameLabel.text,
            style_class: 'spawn-folder-rename',
            x_expand: true,
            can_focus: true,
        });
        this._entry = entry;
        this._nameButton.hide();
        this._header.insert_child_above(entry, this._nameButton);
        const ct = entry.clutter_text;
        let finished = false;
        const finish = (commit: boolean) => {
            if (finished)
                return;
            finished = true;
            this._finish = null;
            const text = ct.text.trim();
            this._entry = null;
            entry.destroy();
            this._nameButton.show();
            if (commit && text && this._uuid === uuid)
                this._services.pinned.renameFolder(uuid, text);
            this._nameButton.grab_key_focus();
        };
        this._finish = finish;
        ct.connect('activate', () => {
            finish(true);
            return Clutter.EVENT_STOP;
        });
        ct.connect('key-focus-out', () => finish(true));
        ct.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finish(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        ct.grab_key_focus();
        ct.set_selection(0, -1);
    }

    /** Abort an inline rename without saving. */
    cancelRename(): void {
        this._cancelRename();
    }

    /** True while the rename entry is open (the layout then leaves Escape/typing to it). */
    get renaming(): boolean {
        return this._entry !== null;
    }

    destroy(): void {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._tileScope.dispose();
        this.actor.destroy();
    }

    private _cancelRename(): void {
        this._finish?.(false);
    }

    private _setDragging(on: boolean): void {
        this._hint.visible = on;
        if (on)
            this._header.add_style_pseudo_class('drag');
        else
            this._header.remove_style_pseudo_class('drag');
    }
}
