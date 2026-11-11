// UndoController: the in-menu Undo banner and what it can undo.
//
// Responsibility: the "Folder deleted", "Pinned / Unpinned / Removed from folder", "Hidden from Menu" and
// "Removed from the menu" actions that offer Undo for 8 s (also Ctrl+Z): remember what is needed to put the
// thing back, show the banner, restore on request, and end the window when the menu closes or the pinned
// list changes otherwise. The banner widget is owned here; the layout places it in the left pane.
//
// Public API:
//   new UndoController(scope, services, state, host)
//   undo.banner: UndoBanner             the widget (`banner.actor`, `banner.button`, `banner.visible`)
//   undo.deleteFolder(uuid)             "Delete Folder" (apps move to the top level) + banner
//   undo.changePinned(message, change, focusId?)   pin / unpin / remove-from-folder with the banner
//   undo.removeShortcut(entry, name)    "Remove from Menu" on a right-pane shortcut + banner
//   undo.hideApp(app)                   "Hide from Menu" + banner
//   undo.hasUndo(): boolean             something can be undone now (Ctrl+Z)
//   undo.undoLast()                     the banner's Undo button / Ctrl+Z
//   undo.dismiss()                      end the window (menu closed / opened, the list changed otherwise)
//   UndoHost                            what the controller asks of the layout (focus, the pinned grid)

import type Shell from 'gi://Shell';
import type St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {Entry, SettingsSnapshot} from '../../core/settings.js';
import {addHidden, removeHidden} from '../../model/hiddenApps.js';
import type {FolderUndo} from '../../model/pinned.js';
import {UndoBanner} from '../widgets/undoBanner.js';
import type {LayoutState} from './types.js';

/** How long the "Folder deleted - Undo" banner stays (it also goes when the menu closes). */
const UNDO_MS = 8000;

export interface UndoHost {
    /** Put the keyboard on the main list. */
    focusMain(): void;
    /** Bring the pinned grid up to date with the store now. */
    syncPinned(): void;
    /** The cached pinned tile for `key` (`f:<uuid>`, `a:<id>`), if it exists. */
    pinnedTile(key: string): St.Widget | null;
}

export class UndoController {
    readonly banner: UndoBanner;
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _host: UndoHost;
    private _undo: FolderUndo | null = null;
    /** The app hidden last (its banner offers Undo). */
    private _undoHide: {id: string; name: string} | null = null;
    /** Right-pane shortcut lists as they were before "Remove from Menu" (its banner offers Undo). */
    private _undoShortcuts: SettingsSnapshot | null = null;
    /** Tile to put the keyboard on after an Undo (key of the pinned tile cache), when the restored thing is a pinned tile. */
    private _undoFocusKey: string | null = null;
    private _cancelUndoTimer: (() => void) | null = null;

    constructor(scope: Scope, services: Services, state: LayoutState, host: UndoHost) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._host = host;
        this.banner = new UndoBanner(() => this.undoLast());
        scope.add(() => this._cancelUndoTimer?.(), 'undo timer');
        // Any other change of the pinned list ends the undo window (restoring would clobber it).
        services.pinned.onChanged(scope, () => {
            if (this._undo && !services.pinned.isUnchangedSince(this._undo))
                this.dismiss();
        });
    }

    /** "Delete Folder": the apps move to the top level; the banner offers to put the folder back. */
    deleteFolder(uuid: string): void {
        const store = this._services.pinned;
        const undo = store.captureFolder(uuid);
        store.dissolveFolder(uuid);
        if (!undo)
            return;
        store.markDissolved(undo);
        this.dismiss();
        this._undo = undo;
        this._undoFocusKey = `f:${undo.uuid}`;
        this.banner.show(_('Folder \u201c%s\u201d deleted').format(undo.name));
        this._cancelUndoTimer = this._scope.timeout(UNDO_MS, () => this.dismiss());
    }

    /**
     * Pin, unpin or remove-from-folder with the Undo banner: the whole pinned list is remembered first, so Undo puts
     * every app back in its exact slot (and folder, even one that went away with its last app). `focusId`: the app
     * to put the keyboard on after Undo (an unpin leaves nothing to focus; a pin undone leaves nothing either).
     */
    changePinned(message: string, change: () => void, focusId?: string): void {
        if (this._state.destroyed)
            return;
        const store = this._services.pinned;
        const undo = store.captureState(message);
        change();
        store.markDissolved(undo);
        this.dismiss();
        this._undo = undo;
        this._undoFocusKey = focusId ? `a:${focusId}` : null;
        this.banner.show(message);
        this._cancelUndoTimer = this._scope.timeout(UNDO_MS, () => this.dismiss());
    }

    /** "Remove from Menu" on a right-pane shortcut: the entry leaves its list; the banner offers Undo. */
    removeShortcut(entry: Entry, name: string): void {
        if (this._state.destroyed)
            return;
        const settings = this._services.settings;
        const same = (a: Entry, b: Entry) => JSON.stringify(a) === JSON.stringify(b);
        const keys = ['directory-shortcuts', 'application-shortcuts'] as const;
        const key = keys.find(k => settings.get(k).some(e => same(e, entry)));
        if (!key)
            return;
        const snapshot = settings.snapshot(keys);
        const list = [...settings.get(key)];
        list.splice(list.findIndex(e => same(e, entry)), 1);
        settings.set(key, list);
        this.dismiss();
        this._undoShortcuts = snapshot;
        this.banner.show(_('Removed \u201c%s\u201d from the menu').format(name));
        this._cancelUndoTimer = this._scope.timeout(UNDO_MS, () => this.dismiss());
    }

    private _undoShortcutRemoval(): void {
        const snapshot = this._undoShortcuts;
        this.dismiss();
        if (!snapshot || this._state.destroyed)
            return;
        try {
            this._services.settings.restore(snapshot);
        } catch (e) {
            error('undo of shortcut removal failed', e);
            return;
        }
        if (this._state.isOpen)
            this._host.focusMain();
    }

    hasUndo(): boolean {
        return Boolean(this._undo || this._undoHide || this._undoShortcuts);
    }

    dismiss(): void {
        this._cancelUndoTimer?.();
        this._cancelUndoTimer = null;
        this._undo = null;
        this._undoHide = null;
        this._undoShortcuts = null;
        this._undoFocusKey = null;
        this.banner.hide();
    }

    /** "Hide from Menu": the app leaves the generated lists; a pinned app stays pinned. */
    hideApp(app: Shell.App): void {
        const id = app.get_id();
        if (!id || this._state.destroyed)
            return;
        const settings = this._services.settings;
        const hidden = settings.get('hidden-apps');
        if (hidden.includes(id))
            return;
        settings.set('hidden-apps', addHidden(hidden, id));
        const name = app.get_name() || id;
        this.dismiss();
        this._undoHide = {id, name};
        // A pinned app stays in the pinned list: say so, or the banner reads as if nothing happened.
        this.banner.show(this._services.pinned.isPinned(id) ? _('Hidden from All Apps, still pinned') : _('\u201c%s\u201d hidden').format(name));
        this._cancelUndoTimer = this._scope.timeout(UNDO_MS, () => this.dismiss());
    }

    private _undoHidden(): void {
        const undo = this._undoHide;
        this.dismiss();
        if (!undo || this._state.destroyed)
            return;
        const settings = this._services.settings;
        settings.set('hidden-apps', removeHidden(settings.get('hidden-apps'), undo.id));
        if (this._state.isOpen)
            this._host.focusMain();
    }

    /** The banner's Undo button / Ctrl+Z: whichever action the banner is showing. */
    undoLast(): void {
        if (this._undoHide)
            this._undoHidden();
        else if (this._undoShortcuts)
            this._undoShortcutRemoval();
        else
            this._undoDelete();
    }

    private _undoDelete(): void {
        const undo = this._undo;
        const focusKey = this._undoFocusKey;
        this.dismiss();
        if (!undo || this._state.destroyed)
            return;
        try {
            if (!this._services.pinned.restoreFolder(undo))
                return;
        } catch (e) {
            error('undo of folder delete failed', e);
            return;
        }
        // The banner (and its focus) is gone: put the keyboard on the folder that came back.
        if (this._state.isOpen && this._state.view === 'pinned') {
            this._host.syncPinned();
            const widget = focusKey ? this._host.pinnedTile(focusKey) : null;
            if (widget)
                widget.grab_key_focus();
            else
                this._host.focusMain();
        }
    }
}
