// AppContextMenu: the app right-click / Menu-key / Shift+F10 menu (and the folder menu).
//
// App menu = the shell's own AppMenu (open windows, New Window, desktop actions, discrete GPU,
// App Details in Software, Quit) plus Spawn items: Pin to / Unpin from Menu, Add to Folder
// (existing folders + New Folder), Remove from Folder. Folder menu: Open, Rename, Delete.
// It owns its PopupMenuManager so the grab stacks on top of the main popup's; a fresh menu is
// built for every open and destroyed on close. Mutations go through Services.pinned.
//
// Public API:
//   new AppContextMenu(scope, services, host)
//   menu.open(source: St.Widget, target: ContextTarget): void   popup at `source`
//   menu.close(): void
//   menu.isOpen: boolean
//   ContextTarget: {kind: 'app', app: Shell.App, folderUuid?: string}
//                | {kind: 'folder', uuid: string}
//                | {kind: 'custom', id: string}           (pinned command entry: unpin only)

import St from 'gi://St';
import type Shell from 'gi://Shell';

import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import {uniqueFolderName} from './dnd.js';
import type {LayoutHost} from './layout.js';
import {ownedScope} from './util.js';

export type ContextTarget =
    | {kind: 'app'; app: Shell.App; folderUuid?: string}
    | {kind: 'folder'; uuid: string}
    | {kind: 'custom'; id: string};

type MenuItems = PopupMenu.PopupMenu & {_getMenuItems(): PopupMenu.PopupBaseMenuItem[]};

export class AppContextMenu {
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _host: LayoutHost;
    private _openScope: {scope: Scope; release(): void} | null = null;
    private _menu: PopupMenu.PopupMenu | null = null;

    constructor(scope: Scope, services: Services, host: LayoutHost) {
        this._scope = scope;
        this._services = services;
        this._host = host;
        scope.add(() => this._teardown(), 'AppContextMenu');
    }

    get isOpen(): boolean {
        return this._menu?.isOpen ?? false;
    }

    open(source: St.Widget, target: ContextTarget): void {
        try {
            this._teardown();
            const owned = ownedScope(this._scope, 'context menu');
            const scope = owned.scope;
            this._openScope = owned;

            const menu = target.kind === 'app'
                ? this._buildAppMenu(source, target, scope)
                : this._buildSimpleMenu(source, target, scope);
            this._menu = menu;

            const manager = new PopupMenu.PopupMenuManager(source);
            Main.uiGroup.add_child(menu.actor);
            menu.actor.hide();
            menu.actor.add_style_class_name('spawn-context-menu');
            manager.addMenu(menu);
            scope.add(() => {
                manager.removeMenu(menu);
                menu.destroy();
            }, 'context menu actors');

            scope.connect(menu, 'open-state-changed', (_m: unknown, open: boolean) => {
                if (!open) {
                    // Defer: destroying inside the close notification re-enters the manager.
                    this._scope.idle(() => {
                        if (this._menu === menu)
                            this._teardown();
                    });
                }
            });
            scope.connect(menu, 'activate', (_m: unknown, item: {_spawnKeepOpen?: boolean}) => {
                if (!item._spawnKeepOpen)
                    this._scope.idle(() => this._host.close());
            });
            menu.open(PopupAnimation.FULL);
        } catch (e) {
            error('context menu failed', e);
            this._teardown();
        }
    }

    close(): void {
        try {
            this._menu?.close(PopupAnimation.NONE);
        } catch (e) {
            error('context menu close failed', e);
        }
        this._teardown();
    }

    private _teardown(): void {
        const owned = this._openScope;
        this._openScope = null;
        this._menu = null;
        owned?.release();
    }

    private _buildAppMenu(source: St.Widget, target: Extract<ContextTarget, {kind: 'app'}>, scope: Scope): PopupMenu.PopupMenu {
        const menu = new AppMenu(source, St.Side.TOP, {showSingleWindows: true} as never) as MenuItems & AppMenu;
        menu.setApp(target.app);
        scope.add(() => menu.setApp(null as never), 'app menu app');

        const id = target.app.get_id();
        if (!id)
            return menu;
        const store = this._services.pinned;

        const mine: PopupMenu.PopupBaseMenuItem[] = [];
        const own = <T extends PopupMenu.PopupBaseMenuItem>(item: T): T => {
            (item as unknown as {_spawnKeepOpen: boolean})._spawnKeepOpen = true;
            mine.push(item);
            return item;
        };
        const action = (label: string, cb: () => void) => {
            const item = own(new PopupMenu.PopupMenuItem(label));
            item.connect('activate', () => cb());
            return item;
        };

        if (store.isPinned(id))
            action('Unpin from Menu', () => store.unpin(id));
        else
            action('Pin to Menu', () => store.pin(id));

        if (target.folderUuid) {
            const folderUuid = target.folderUuid;
            action('Remove from Folder', () => store.removeFromFolder(folderUuid, id));
        }

        const folders = store.items().filter(i => i.kind === 'folder' && i.uuid !== target.folderUuid);
        const sub = own(new PopupMenu.PopupSubMenuMenuItem('Add to Folder'));
        for (const f of folders) {
            if (f.kind !== 'folder')
                continue;
            const uuid = f.uuid;
            const item = new PopupMenu.PopupMenuItem(f.name || 'Folder');
            (item as unknown as {_spawnKeepOpen: boolean})._spawnKeepOpen = true;
            item.connect('activate', () => store.addToFolder(uuid, id));
            sub.menu.addMenuItem(item);
        }
        if (folders.length > 0)
            sub.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const create = new PopupMenu.PopupMenuItem('New Folder');
        (create as unknown as {_spawnKeepOpen: boolean})._spawnKeepOpen = true;
        create.connect('activate', () => {
            if (target.folderUuid)
                store.removeFromFolder(target.folderUuid, id);
            store.createFolder(uniqueFolderName(store), [id]);
        });
        sub.menu.addMenuItem(create);

        // Spawn items replace the (hidden) Pin-to-Dash slot.
        const slot = menu as unknown as {_toggleFavoriteItem?: PopupMenu.PopupBaseMenuItem};
        let at = slot._toggleFavoriteItem ? menu._getMenuItems().indexOf(slot._toggleFavoriteItem) : -1;
        if (at < 0)
            at = 0;
        mine.forEach((item, i) => menu.addMenuItem(item, at + i));
        return menu;
    }

    private _buildSimpleMenu(source: St.Widget, target: Exclude<ContextTarget, {kind: 'app'}>, scope: Scope): PopupMenu.PopupMenu {
        void scope;
        const menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.TOP);
        const store = this._services.pinned;
        const add = (label: string, cb: () => void, keepOpen = true) => {
            const item = new PopupMenu.PopupMenuItem(label);
            (item as unknown as {_spawnKeepOpen: boolean})._spawnKeepOpen = keepOpen;
            item.connect('activate', () => cb());
            menu.addMenuItem(item);
        };
        if (target.kind === 'folder') {
            const uuid = target.uuid;
            add('Open', () => this._host.openFolder?.(uuid));
            add('Rename', () => this._host.renameFolder?.(uuid));
            add('Delete Folder', () => store.deleteFolder(uuid));
        } else {
            const id = target.id;
            add('Unpin from Menu', () => store.unpin(id));
        }
        return menu;
    }
}
