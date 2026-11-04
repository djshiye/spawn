// SpawnMenuExtension: enable()/disable() only.
//
// enable() builds a root Scope and starts each subsystem inside its own child scope, wrapped
// in try/catch: if one subsystem fails to start, only that subsystem is disposed, the error is
// logged, and the rest keep running. enable() itself never throws. disable() disposes the root
// scope (LIFO, each teardown guarded) and is safe to call at any time, including twice.
// Enable is idempotent: calling it again first disposes any previous state.
//
// Lifetime of shared objects: see core/services.ts (lazy AppIndex/PinnedStore/SearchEngine) and
// ui/menu.ts (lazy popup + layout). Nothing here keeps module-level mutable state.

import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error, log} from './core/log.js';
import {Scope} from './core/scope.js';
import {type ExtensionInfo, Services} from './core/services.js';
import {SCHEMA_ID, SpawnSettings} from './core/settings.js';
import {DBusService, type MenuController} from './input/dbus.js';
import {Hotkeys} from './input/hotkeys.js';
import {ButtonAttacher} from './panel/attacher.js';
import {PanelTargets} from './panel/targets.js';
import {Theme} from './theme/theme.js';
import {MenuButton} from './ui/button.js';
import {SpawnPopup} from './ui/menu.js';

export default class SpawnMenuExtension extends Extension {
    private _root: Scope | null = null;

    override enable(): void {
        try {
            this._disposeRoot();
            this._enable();
        } catch (e) {
            error('enable failed; staying idle', e);
            this._disposeRoot();
        }
    }

    override disable(): void {
        this._disposeRoot();
    }

    private _disposeRoot(): void {
        const root = this._root;
        this._root = null;
        try {
            root?.dispose();
        } catch (e) {
            error('dispose failed', e);
        }
    }

    private _loadSettings(): SpawnSettings {
        const schemaDir = this.dir.get_child('schemas').get_path();
        if (!schemaDir)
            throw new Error('schemas directory missing');
        const source = Gio.SettingsSchemaSource.new_from_directory(schemaDir, Gio.SettingsSchemaSource.get_default(), false);
        const schema = source.lookup(SCHEMA_ID, true);
        if (!schema)
            throw new Error(`schema ${SCHEMA_ID} not found in ${schemaDir}`);
        return new SpawnSettings(Gio.Settings.new_full(schema, null, null), source);
    }

    /** Runs one subsystem's start in its own child scope; a failure disposes only that scope. */
    private _start<T>(root: Scope, name: string, fn: (scope: Scope) => T): T | null {
        const scope = root.child(name);
        try {
            return fn(scope);
        } catch (e) {
            error(`subsystem '${name}' failed to start`, e);
            scope.dispose();
            return null;
        }
    }

    private _enable(): void {
        const root = new Scope('spawn-menu');
        this._root = root;

        const settings = this._loadSettings();
        const info: ExtensionInfo = {
            uuid: this.uuid,
            path: this.path,
            iconDir: `${this.path}/data/icons`,
        };
        const services = new Services(root.child('services'), settings, info);

        this._start(root, 'theme', scope => {
            new Theme(scope, settings).start();
        });

        const popup = this._start(root, 'popup', scope => new SpawnPopup(scope, services));

        const attacher = this._start(root, 'panel', scope => {
            const targets = new PanelTargets(scope, {isMultiMonitor: () => settings.get('multi-monitor')});
            const attacher = new ButtonAttacher(scope, {
                settings,
                targets,
                createButton: () => new MenuButton({
                    settings,
                    iconDir: info.iconDir,
                    popup: popup ?? {toggle: () => {}},
                }),
            });
            attacher.start();
            return attacher;
        });

        const controller: MenuController = {
            toggle: () => {
                const anchor = attacher?.buttons()[0];
                if (anchor && popup)
                    popup.toggle(anchor);
            },
            open: () => {
                const anchor = attacher?.buttons()[0];
                if (anchor && popup)
                    popup.open(anchor);
            },
            close: () => popup?.close(),
            search: () => {},
            attachmentStatus: () => JSON.stringify(attacher?.status() ?? {attachments: [], pending: false, pendingForMs: 0}),
        };

        this._start(root, 'dbus', scope => {
            new DBusService(scope, settings, controller).start();
        });

        this._start(root, 'hotkeys', scope => {
            new Hotkeys(scope, settings, () => controller.toggle()).start();
        });

        if (popup) {
            this._start(root, 'prebuild', scope => {
                this._afterStartup(scope, () => popup.prebuild());
            });
        }

        log('enabled');
    }

    /** Runs `cb` on an idle once the shell has finished starting (immediately if it has). */
    private _afterStartup(scope: Scope, cb: () => void): void {
        const lm = Main.layoutManager as unknown as {_startingUp?: boolean};
        if (lm._startingUp)
            scope.connect(Main.layoutManager, 'startup-complete', () => scope.idle(cb));
        else
            scope.idle(cb);
    }
}
