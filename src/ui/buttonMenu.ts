// ButtonMenu: the panel button's context menu (ArcMenu's right-click menu), a native shell PopupMenu
// attached to one MenuButton.
//
// Items come from the `context-menu-items` setting (aa{ss}, same Entry shape as the shortcut lists):
//   * `<id>.desktop`          the app (icon + name; an entry for an app that is not installed is skipped)
//   * Spawn_Separator         PopupSeparatorMenuItem (leading, trailing and doubled separators collapse)
//   * Spawn_Settings          Spawn's own preferences
//   * Spawn_PanelExtensionSettings   preferences of the ACTIVE panel extension (Dash to Panel, else
//                             App Icons Taskbar); no row when neither is active
//   * Spawn_ShowDesktop       toggle: minimize every normal window of the current workspace, the next
//                             activation restores exactly those windows (ui/showDesktop.ts, shared with the
//                             right-pane shortcut; the memory outlives this menu, a lock/unlock and rebuilds)
//   * Spawn_PowerOptions      submenu with the power actions, severity order (POWER_RANK), only the
//                             available ones (SystemActions / logind probe, like the power bar)
//   * Spawn_ActivitiesOverview, Spawn_ShowAllApplications, Spawn_RunCommand, Spawn_Software,
//     Spawn_Home/Documents/Downloads/Music/Pictures/Videos/Computer/Network/Recent,
//     Spawn_Lock/LogOut/Suspend/Restart/PowerOff/HybridSleep/Hibernate/SwitchUser
//                             the same ids the right-pane shortcuts understand (ShortcutRow's
//                             resolveShortcut gives name, icon and action)
//   * an absolute path / URI / command line, as in the right pane
// The icon 'Spawn_SpawnIcon' stands for the configured panel button icon (`menu-button-icon`).
//
// A fresh PopupMenu (own PopupMenuManager, arrow side from the button at open time) is built for
// every open and destroyed after it closed, so installed apps, the active panel extension, power
// availability and edits of the setting are always current (a superset of "build lazily, rebuild
// on change"). Opening it closes the Spawn popup; the button closes this menu when the popup opens.
//
// Public API:
//   new ButtonMenu(scope, button: ButtonMenuAnchor, deps: ButtonMenuDeps)
//   menu.open(fromKeyboard?: boolean): void   never throws; with fromKeyboard the first item is focused
//   menu.close(): void
//   menu.toggle(): void
//   menu.isOpen: boolean
//   ButtonMenuAnchor: St.Widget & {arrowSide: St.Side}   (the MenuButton)
//   ButtonMenuDeps: {settings, iconDir, popup: PopupControl, openPreferences()}
//   PopupControl: {isOpen, open(anchor), close(), showAllApps?()}   (SpawnPopup)

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {AZ_TASKBAR_UUID, ContextMenuId, DTP_UUID, PowerType, ShortcutId, SPAWN_ICON} from '../core/constants.js';
import {resolveButtonIcon} from '../core/icons.js';
import {error} from '../core/log.js';
import {openExtensionPrefs} from '../core/openPrefs.js';
import type {Scope} from '../core/scope.js';
import type {Entry, SpawnSettings} from '../core/settings.js';
import {ExtState} from '../panel/validate.js';
import {launchApp, applyTone, ownedScope} from './util.js';
import {toggleShowDesktop} from './showDesktop.js';
import {
    isPowerAvailable, type LogindInfo, POWER_INFO, POWER_RANK, POWER_SHORTCUTS, probeLogind, runPowerAction, systemActions,
} from './widgets/powerActions.js';
import {resolveShortcut, type ShortcutHost} from './widgets/shortcutRow.js';
import {closeMenu, openMenu, silenceSourceKeys} from './menuParams.js';

export interface PopupControl {
    readonly isOpen: boolean;
    /** The button the popup is attached to (SpawnPopup); keeps `active` correct with several buttons. */
    readonly anchor?: St.Widget | null;
    open(anchor: St.Widget): void;
    close(): void;
    showAllApps?(): void;
}

export interface ButtonMenuDeps {
    settings: SpawnSettings;
    iconDir: string;
    popup: PopupControl;
    openPreferences(): void;
}

export type ButtonMenuAnchor = St.Widget & {arrowSide: St.Side};

type MenuIcon = Gio.Icon | string | null;

/** One row to show: separators are `null`-icon rows with `separator` set. */
interface Row {
    separator?: boolean;
    label?: string;
    icon?: MenuIcon;
    /** Runs on activation; `close` closes the menu first (power dialogs need a free stage). */
    run?: (close: () => void) => void;
    /** Power submenu rows. */
    submenu?: Row[];
    /** Re-evaluated when the logind probe returns. */
    visible?: () => boolean;
}

const POWER_SUBMENU_ICON = 'system-shutdown-symbolic';

export class ButtonMenu {
    private readonly _scope: Scope;
    private readonly _button: ButtonMenuAnchor;
    private readonly _deps: ButtonMenuDeps;
    private _openScope: {scope: Scope; release(): void} | null = null;
    private _menu: PopupMenu.PopupMenu | null = null;
    /** Set when a row was activated, before its action runs; Escape / outside click leave it false. */
    private _activated = false;
    private _logind: LogindInfo | null = null;
    private _probing = false;
    private _refreshers: Array<() => void> = [];

    constructor(scope: Scope, button: ButtonMenuAnchor, deps: ButtonMenuDeps) {
        this._scope = scope;
        this._button = button;
        this._deps = deps;
        scope.add(() => this._teardown(), 'ButtonMenu');
        // Probe early: by the first right click the Hibernate / Hybrid Sleep answer is usually known.
        this._probeLogind();
        // An edit of the item list (or of the icon 'Spawn_SpawnIcon' stands for) while the menu is open: close it.
        deps.settings.onChanged(scope, ['context-menu-items', 'menu-button-icon'], () => {
            if (this.isOpen)
                this.close();
        });
    }

    get isOpen(): boolean {
        return this._menu?.isOpen ?? false;
    }

    toggle(): void {
        if (this.isOpen)
            this.close();
        else
            this.open();
    }

    open(fromKeyboard = false): void {
        try {
            this._teardown();
            this._deps.popup.close();
            this._probeLogind();
            // Availability depends on Polkit, which sends no change notifications.
            systemActions()?.forceUpdate?.();

            const owned = ownedScope(this._scope, 'button menu');
            const scope = owned.scope;
            this._openScope = owned;
            const button = this._button;

            const menu = new PopupMenu.PopupMenu(button, 0.5, button.arrowSide);
            this._menu = menu;
            // Rebuilt on every open: its key handling must not stay behind on the panel button (button.ts owns those keys).
            silenceSourceKeys(menu);
            const manager = new PopupMenu.PopupMenuManager(button);
            Main.uiGroup.add_child(menu.actor);
            menu.actor.hide();
            menu.actor.add_style_class_name('spawn-button-menu');
            applyTone(menu.actor, menu.box);
            manager.addMenu(menu);
            scope.add(() => {
                manager.removeMenu(menu);
                menu.destroy();
            }, 'button menu actors');

            this._populate(menu, scope);

            this._activated = false;
            scope.connect(menu, 'open-state-changed', (_m: unknown, open: boolean) => {
                if (open) {
                    button.add_style_pseudo_class('active');
                    return;
                }
                this._clearActive();
                // Escape or an outside click after a keyboard open: the focus belongs on the button.
                if (fromKeyboard && !this._activated)
                    this._scope.idle(() => this._focusButton());
                // Defer: destroying inside the close notification re-enters the manager.
                this._scope.idle(() => {
                    if (this._menu === menu)
                        this._teardown();
                });
            });
            scope.add(() => this._clearActive(), 'button menu active class');

            if (menu.isEmpty()) {
                this._teardown();
                return;
            }
            openMenu(menu);
            if (fromKeyboard)
                menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
        } catch (e) {
            error('button menu open failed', e);
            this._teardown();
        }
    }

    close(): void {
        try {
            if (this._menu)
                closeMenu(this._menu, false);
        } catch (e) {
            error('button menu close failed', e);
        }
        this._teardown();
    }

    /** Drops the :active look, unless the Spawn popup is open on this button (it set the class itself). */
    private _clearActive(): void {
        try {
            const popup = this._deps.popup;
            if (popup.isOpen && (popup.anchor === undefined || popup.anchor === this._button))
                return;
            this._button.remove_style_pseudo_class('active');
        } catch {
            // button already gone
        }
    }

    private _focusButton(): void {
        try {
            if (this._button.get_stage() && !this.isOpen)
                this._button.grab_key_focus();
        } catch {
            // button already gone
        }
    }

    private _teardown(): void {
        const owned = this._openScope;
        this._openScope = null;
        this._menu = null;
        this._refreshers = [];
        owned?.release();
    }

    private _probeLogind(): void {
        if (this._probing)
            return;
        this._probing = true;
        probeLogind().then(info => {
            this._logind = info;
            this._probing = false;
            for (const refresh of [...this._refreshers])
                refresh();
        }).catch(() => {
            this._probing = false;
        });
    }

    /** Until the first logind answer arrives, Hibernate / Hybrid Sleep count as available (no empty first menu). */
    private _powerAvailable(type: number): boolean {
        if (this._logind === null && (type === PowerType.HIBERNATE || type === PowerType.HYBRID_SLEEP))
            return true;
        // Restart to Firmware Setup is opt-in: only when its switch in the power buttons list is on
        if (type === PowerType.FIRMWARE && !this._deps.settings.get('power-options').some(([id, on]) => id === type && on))
            return false;
        return isPowerAvailable(type, this._logind);
    }

    // ---- building ----

    private _populate(menu: PopupMenu.PopupMenu, scope: Scope): void {
        const rows = this._rows(this._deps.settings.get('context-menu-items'));
        const close = () => closeMenu(menu, false);
        for (const row of rows)
            menu.addMenuItem(this._item(row, close, scope));
    }

    private _item(row: Row, close: () => void, scope: Scope): PopupMenu.PopupBaseMenuItem | PopupMenu.PopupSubMenuMenuItem | PopupMenu.PopupSeparatorMenuItem {
        if (row.separator)
            return new PopupMenu.PopupSeparatorMenuItem();

        if (row.submenu) {
            const sub = new PopupMenu.PopupSubMenuMenuItem(row.label ?? '', true);
            setIcon(sub.icon, row.icon ?? null);
            for (const child of row.submenu)
                sub.menu.addMenuItem(this._item(child, close, scope));
            // Shown while at least one of its actions is available.
            const anyChild = () => (row.submenu ?? []).some(r => r.visible?.() ?? true);
            sub.visible = anyChild();
            this._refreshers.push(() => {
                sub.visible = anyChild();
            });
            return sub;
        }

        const item = row.icon ? new PopupMenu.PopupImageMenuItem(row.label ?? '', row.icon) : new PopupMenu.PopupMenuItem(row.label ?? '');
        item.connect('activate', () => {
            // Before run(): most rows close the menu synchronously, and open-state-changed must see this.
            this._activated = true;
            try {
                row.run?.(close);
            } catch (e) {
                error(`button menu item '${row.label ?? ''}' failed`, e);
            }
        });
        // Availability is re-checked when the logind probe returns.
        if (row.visible) {
            const visible = row.visible;
            item.visible = visible();
            this._refreshers.push(() => {
                item.visible = visible();
            });
        }
        return item;
    }

    /** Entries -> rows: unknown / unavailable entries dropped, separators collapsed and trimmed. */
    private _rows(entries: Entry[]): Row[] {
        const rows: Row[] = [];
        for (const entry of entries) {
            const row = this._row(entry);
            if (!row)
                continue;
            if (row.separator && (rows.length === 0 || rows[rows.length - 1]?.separator))
                continue;
            rows.push(row);
        }
        while (rows.length > 0 && rows[rows.length - 1]?.separator)
            rows.pop();
        return rows;
    }

    private _spawnIcon(): MenuIcon {
        const resolved = resolveButtonIcon(this._deps.settings.get('menu-button-icon'), this._deps.iconDir);
        if (resolved.kind === 'file')
            return Gio.FileIcon.new(Gio.File.new_for_path(resolved.path));
        return resolved.name.trim() === '' ? 'start-here-symbolic' : resolved.name;
    }

    /** The entry's own icon (themed name / absolute path), 'Spawn_SpawnIcon' resolved, or `fallback`. */
    private _icon(entry: Entry, fallback: MenuIcon): MenuIcon {
        const icon = entry.icon;
        if (icon === SPAWN_ICON)
            return this._spawnIcon();
        if (!icon || icon.startsWith('Spawn_') || icon.startsWith('ArcMenu_'))
            return fallback;
        return iconFrom(icon);
    }

    private _row(entry: Entry): Row | null {
        const id = entry.id;
        const settings = this._deps.settings;

        if (id === ShortcutId.SEPARATOR || id === 'ArcMenu_Separator')
            return {separator: true};

        if (id.endsWith('.desktop')) {
            const app = Shell.AppSystem.get_default().lookup_app(id);
            if (!app)
                return null;
            return {
                label: entry.name || app.get_name(),
                icon: this._icon(entry, app.get_icon()),
                run: () => launchApp(app, settings, false),
            };
        }

        switch (id) {
        case ContextMenuId.SETTINGS:
            return {
                label: entry.name || _('Spawn Settings'),
                icon: this._icon(entry, this._spawnIcon()),
                run: close => {
                    close();
                    this._scope.idle(() => this._deps.openPreferences());
                },
            };
        case ContextMenuId.PANEL_EXTENSION_SETTINGS: {
            const target = activePanelExtension();
            if (!target)
                return null;
            return {
                label: target.label,
                icon: this._icon(entry, 'application-x-addon-symbolic'),
                run: close => {
                    close();
                    this._scope.idle(() => openExtensionPrefs(target.uuid));
                },
            };
        }
        case ShortcutId.SHOW_DESKTOP:
            return {
                label: entry.name || _('Show Desktop'),
                icon: this._icon(entry, 'computer-symbolic'),
                run: close => {
                    close();
                    toggleShowDesktop();
                },
            };
        case ShortcutId.POWER_OPTIONS:
            return this._powerRow(entry);
        case ShortcutId.ACTIVITIES_OVERVIEW:
            return {
                label: entry.name || _('Activities Overview'),
                icon: this._icon(entry, 'view-fullscreen-symbolic'),
                run: close => {
                    close();
                    Main.overview.show();
                },
            };
        }

        const power = POWER_SHORTCUTS[id];
        if (power) {
            return {
                label: entry.name || power.name,
                icon: this._icon(entry, power.icon),
                visible: () => this._powerAvailable(power.type),
                run: close => runPowerAction(power.type, {close}, this._scope),
            };
        }

        const resolved = resolveShortcut(entry);
        if (!resolved)
            return null;
        const icon = resolved.icon;
        return {
            label: resolved.name,
            icon: typeof icon === 'string' ? iconFrom(icon) : icon,
            // Close through the menu (the teardown is deferred): destroying it from inside the item's
            // own activation would use the disposed items afterwards.
            run: close => {
                const host: ShortcutHost = {
                    close,
                    showAllApps: () => {
                        close();
                        this._scope.idle(() => this._showAllApps());
                    },
                };
                resolved.run(host, this._scope);
            },
        };
    }

    private _powerRow(entry: Entry): Row {
        const types = [...POWER_RANK];
        return {
            label: entry.name || _('Power Options'),
            icon: this._icon(entry, POWER_SUBMENU_ICON),
            submenu: types.map((type): Row => ({
                label: POWER_INFO[type]?.name ?? '',
                icon: POWER_INFO[type]?.icon ?? null,
                visible: () => this._powerAvailable(type),
                run: close => runPowerAction(type, {close}, this._scope),
            })),
        };
    }

    // ---- actions ----

    private _showAllApps(): void {
        const popup = this._deps.popup;
        popup.open(this._button);
        popup.showAllApps?.();
    }
}

/** Dash to Panel, else App Icons Taskbar, whichever is ACTIVE right now. */
function activePanelExtension(): {uuid: string; label: string} | null {
    const candidates = [
        {uuid: DTP_UUID, label: _('Dash to Panel Settings')},
        {uuid: AZ_TASKBAR_UUID, label: _('App Icons Taskbar Settings')},
    ];
    for (const c of candidates) {
        try {
            if (Main.extensionManager.lookup(c.uuid)?.state === ExtState.ACTIVE)
                return c;
        } catch {
            // extension manager not ready
        }
    }
    return null;
}

function iconFrom(icon: string): Gio.Icon | string {
    return icon.startsWith('/') ? Gio.FileIcon.new(Gio.File.new_for_path(icon)) : icon;
}

function setIcon(target: St.Icon | undefined, icon: MenuIcon): void {
    if (!target || !icon)
        return;
    if (typeof icon === 'string')
        target.icon_name = icon;
    else
        target.gicon = icon;
}
