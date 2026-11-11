// FolderController: the pinned folder popup.
//
// Responsibility: create the FolderView (the card over both panes, on top of the panes in the layout root)
// the first time a folder opens, feed it the grid metrics, open a folder next to its tile and focus it,
// and start a rename. Which view is under the popup and the switch to the 'folder' view stay with the
// layout (`host.setView`).
//
// Public API:
//   new FolderController(scope, services, state, deps)   deps: {root, tileHost, metrics, context, host}
//   folders.view: FolderView | null        null until the first folder opens
//   folders.ensure(): FolderView
//   folders.show(uuid, pointer = false)    open a folder (`pointer`: opened with a click, no app highlighted)
//   folders.rename(uuid)                   open the folder and start renaming it (context menu Rename, F2)

import type St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {AppContextMenu} from '../contextMenu.js';
import type {TileHost} from '../widgets/appTile.js';
import {FolderView} from '../widgets/folderView.js';
import type {PaneMetrics} from './metrics.js';
import type {LayoutState, ViewId} from './types.js';

export interface FolderControllerDeps {
    /** The layout root the popup is added to (on top of the panes). */
    root: St.Widget;
    tileHost: TileHost;
    metrics: PaneMetrics;
    context: AppContextMenu;
    host: {
        /** Show a view (the 'folder' view: the popup over the current one). */
        setView(view: ViewId): void;
        /** Close the popup / go back. */
        back(): void;
        /** The pinned tile of folder `uuid` when the pinned view shows it. */
        folderTile(uuid: string): St.Widget | null;
    };
}

export class FolderController {
    view: FolderView | null = null;
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _root: St.Widget;
    private readonly _tileHost: TileHost;
    private readonly _metrics: PaneMetrics;
    private readonly _context: AppContextMenu;
    private readonly _host: FolderControllerDeps['host'];

    constructor(scope: Scope, services: Services, state: LayoutState, deps: FolderControllerDeps) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._root = deps.root;
        this._tileHost = deps.tileHost;
        this._metrics = deps.metrics;
        this._context = deps.context;
        this._host = deps.host;
    }

    ensure(): FolderView {
        if (!this.view) {
            this.view = new FolderView(this._scope.child('folder view'), this._services, {
                ...this._tileHost,
                back: () => this._host.back(),
                metrics: () => ({
                    columns: this._metrics.cols,
                    tileWidth: this._metrics.tileWidth,
                    iconSize: this._metrics.tileIconSize,
                    // The popup is always a grid, so the grid's label setting applies in the list display too.
                    multiLine: this._services.settings.get('multi-lined-labels'),
                    list: this._metrics.listMode(),
                    rowIconSize: this._metrics.rowIconSize(),
                    size: this._metrics.itemSize(),
                    ...this._metrics.contentSize(),
                }),
                openMissingContext: (tile, id) => this._context.open(tile, {kind: 'custom', id}),
            });
            this._root.add_child(this.view.actor);
        }
        return this.view;
    }

    /** `pointer`: opened with a click, so no app is highlighted until the pointer or an arrow key picks one. */
    show(uuid: string, pointer = false): void {
        const fv = this.ensure();
        // The card opens next to the folder it came from when that folder is on screen (pinned view).
        const tile = this._state.view === 'pinned' ? this._host.folderTile(uuid) : null;
        // The folder vanished (deleted elsewhere, emptied): show() already went back to the default
        // view, so do not switch to an empty folder view.
        if (!fv.show(uuid, this._state.isOpen, tile?.mapped ? tile : null))
            return;
        this._host.setView('folder');
        if (!this._state.isOpen)
            return;
        if (pointer) {
            fv.focusCard();
            return;
        }
        (fv.tiles()[0] ?? fv.headerButtons()[0]).grab_key_focus();
    }

    /** Open the folder and start renaming it (its context menu's Rename, F2). */
    rename(uuid: string): void {
        this.show(uuid);
        if (this._state.view === 'folder' && this.view?.uuid === uuid)
            this.view.startRename();
    }
}
