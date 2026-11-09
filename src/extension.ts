// SpawnExtension: enable()/disable() only.
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

import {DesktopMemory} from './core/desktopToggle.js';
import {error, log} from './core/log.js';
import {openExtensionPrefs} from './core/openPrefs.js';
import {Scope} from './core/scope.js';
import {type ExtensionInfo, Services} from './core/services.js';
import {SCHEMA_ID, SpawnSettings} from './core/settings.js';
import GLib from 'gi://GLib';

import {installDevController, installDevHotkeyHooks} from './dev/devController.js';
import {Accelerator} from './input/accelerator.js';
import {DBusService, type MenuController} from './input/dbus.js';
import {Hotkeys} from './input/hotkeys.js';
import {ButtonAttacher} from './panel/attacher.js';
import {pickAnchor} from './panel/anchor.js';
import {closeOtherShellPopups, PanelTargets} from './panel/targets.js';
import {Theme} from './theme/theme.js';
import {MenuButton} from './ui/button.js';
import {SpawnPopup} from './ui/menu.js';
import {SpawnRunner} from './ui/runner.js';

export default class SpawnExtension extends Extension {
    private _root: Scope | null = null;
    /**
     * Show Desktop's remembered windows (ids only, no GObject). GNOME keeps this instance across
     * disable/enable (lock screen, panel rebuilds), so the memory survives them; ui/showDesktop.ts finds
     * it through Extension.lookupByUUID.
     */
    readonly desktopMemory = new DesktopMemory();
    /** enable() timing, kept for the dev benchmark (Dev.Benchmark). */
    private _enableMs = 0;
    private _startMs: Record<string, number> = {};

    override enable(): void {
        const t0 = GLib.get_monotonic_time();
        try {
            this._disposeRoot();
            this._enable();
            this._enableMs = (GLib.get_monotonic_time() - t0) / 1000;
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
        // Installed from a zip the schema sits in <extension dir>/schemas; installed from the RPM it is
        // in the system schema directory (no schemas/ here), like Extension.getSettings() does it.
        const schemaDir = this.dir.get_child('schemas');
        const source = schemaDir.query_exists(null)
            ? Gio.SettingsSchemaSource.new_from_directory(schemaDir.get_path() ?? '', Gio.SettingsSchemaSource.get_default(), false)
            : Gio.SettingsSchemaSource.get_default();
        const schema = source?.lookup(SCHEMA_ID, true);
        if (!source || !schema)
            throw new Error(`schema ${SCHEMA_ID} not found`);
        return new SpawnSettings(Gio.Settings.new_full(schema, null, null), source);
    }

    /** Runs one subsystem's start in its own child scope; a failure disposes only that scope. */
    private _start<T>(root: Scope, name: string, fn: (scope: Scope) => T): T | null {
        const scope = root.child(name);
        const t0 = GLib.get_monotonic_time();
        try {
            return fn(scope);
        } catch (e) {
            error(`subsystem '${name}' failed to start`, e);
            scope.dispose();
            return null;
        } finally {
            this._startMs[name] = Math.round((GLib.get_monotonic_time() - t0)) / 1000;
        }
    }

    private _enable(): void {
        const root = new Scope('spawn');
        this._root = root;
        this._startMs = {};

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

        // The standalone runner: lazy (no actors before its first open), owned by its own scope, with its
        // own accelerator (`runner-hotkey`). Opening one of runner / main menu closes the other.
        let runnerAccel: Accelerator | null = null;
        const runner = this._start(root, 'runner', scope => {
            const r = new SpawnRunner(scope, services, {beforeOpen: () => {
                if (popup?.isOpen)
                    popup.close();
                closeOtherShellPopups();
            }});
            runnerAccel = new Accelerator(scope, settings, 'runner-hotkey', () => r.toggle());
            runnerAccel.start();
            return r;
        });
        if (runner && popup) {
            popup.onOpenStateChanged(root, open => {
                if (open)
                    runner.close();
            });
        }

        const attacher = this._start(root, 'panel', scope => {
            const targets = new PanelTargets(scope, {isMultiMonitor: () => settings.get('multi-monitor')});
            const attacher = new ButtonAttacher(scope, {
                settings,
                targets,
                createButton: () => new MenuButton({
                    settings,
                    iconDir: info.iconDir,
                    popup: popup ?? {isOpen: false, toggle: () => {}, open: () => {}, close: () => {}},
                    openPreferences: () => openExtensionPrefs(this.uuid),
                }),
            });
            attacher.start();
            return attacher;
        });

        // The button a toggle should open on: the one on the monitor under the pointer, else the first.
        const anchorButton = (): MenuButton | null => {
            const buttons = attacher?.buttons() ?? [];
            let pointer = -1;
            try {
                pointer = global.display.get_current_monitor();
            } catch {
                pointer = -1;
            }
            return pickAnchor(buttons, b => Main.layoutManager.findIndexForActor(b), pointer);
        };

        const controller: MenuController = {
            // Close if the menu is open anywhere; otherwise open it on the pointer's monitor. When
            // Spawn cannot do that, Super hands back to GNOME's own behaviour (the Overview).
            toggle: (source = 'dbus') => {
                runner?.close();
                if (popup?.isOpen) {
                    popup.close();
                    return;
                }
                if (source === 'super' && Main.overview.visible) {
                    Main.overview.hide();
                    return;
                }
                const anchor = popup ? anchorButton() : null;
                if (popup && anchor)
                    popup.open(anchor);
                else if (source === 'super')
                    Main.overview.toggle();
            },
            open: () => {
                runner?.close();
                const anchor = anchorButton();
                if (anchor && popup)
                    popup.open(anchor);
            },
            close: () => popup?.close(),
            toggleRunner: () => runner?.toggle(),
            search: query => popup?.search(query),
            attachmentStatus: () => JSON.stringify(attacher?.status() ?? {attachments: [], pending: false, pendingForMs: 0}),
        };

        installDevController(controller, {
            root,
            services,
            popup,
            runner,
            runnerAccelBound: () => (runnerAccel as Accelerator | null)?.bound ?? false,
            firstButton: () => attacher?.buttons()[0] ?? null,
            enableMs: () => this._enableMs,
            startMs: () => this._startMs,
        });

        this._start(root, 'dbus', scope => {
            new DBusService(scope, settings, controller).start();
        });

        this._start(root, 'hotkeys', scope => {
            const hotkeys = new Hotkeys(scope, settings, source => controller.toggle(source));
            hotkeys.start();
            installDevHotkeyHooks(scope, controller, {
                hotkeys,
                popupOpen: () => popup?.isOpen ?? false,
                anchorButton,
            });
        });

        if (popup) {
            this._start(root, 'prebuild', scope => {
                this._afterStartup(scope, () => popup.prebuild(anchorButton()));
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
