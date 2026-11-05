// Power actions shared by PowerBar and the power ShortcutRows.
//
// Lock, log out, suspend, restart, power off and switch user go through GNOME's SystemActions
// (so confirmation dialogs and policy match the shell); hibernate and hybrid sleep go straight
// to logind since SystemActions has no entry for them.
//
// Public API:
//   POWER_INFO: Record<PowerType, {name, icon}>      (name is translated lazily, on access)
//   POWER_RANK: number[]                      power types in SEVERITY order (the order the bar shows them)
//   isDestructive(type): boolean              Restart / Power Off
//   POWER_SHORTCUTS: Record<ShortcutId, {type, name, icon}>
//   systemActions(): SystemActions | null
//   isPowerAvailable(type, logind): boolean  current availability (hibernate/sleep from the probe)
//   probeLogind(): Promise<LogindInfo>       async CanHibernate / CanHybridSleep
//   runPowerAction(type, host: {close()}, scope): void   closes the menu first, then performs the action
//   powerSignalNames: string[]               SystemActions notify:: signals to watch

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {PowerType, ShortcutId} from '../../core/constants.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';

export type PowerTypeId = (typeof PowerType)[keyof typeof PowerType];

export interface PowerInfo {
    name: string;
    icon: string;
}

// Names are getters so they are translated when shown, not when the module loads. Restart uses
// the circular arrow (view-refresh): system-reboot-symbolic is a power ring plus a 3 px arrowhead
// and cannot be told apart from system-shutdown-symbolic at 16 px.
export const POWER_INFO: Record<number, PowerInfo> = {
    [PowerType.LOGOUT]: {get name() { return _('Log Out'); }, icon: 'system-log-out-symbolic'},
    [PowerType.LOCK]: {get name() { return _('Lock'); }, icon: 'system-lock-screen-symbolic'},
    [PowerType.RESTART]: {get name() { return _('Restart'); }, icon: 'view-refresh-symbolic'},
    [PowerType.POWER_OFF]: {get name() { return _('Power Off'); }, icon: 'system-shutdown-symbolic'},
    [PowerType.SUSPEND]: {get name() { return _('Suspend'); }, icon: 'media-playback-pause-symbolic'},
    [PowerType.HYBRID_SLEEP]: {get name() { return _('Hybrid Sleep'); }, icon: 'weather-clear-night-symbolic'},
    [PowerType.HIBERNATE]: {get name() { return _('Hibernate'); }, icon: 'document-save-symbolic'},
    [PowerType.SWITCH_USER]: {get name() { return _('Switch User'); }, icon: 'system-switch-user-symbolic'},
};

/** Least to most severe; the power bar sorts by this, not by the stored `power-options` order. */
export const POWER_RANK: readonly number[] = [
    PowerType.SWITCH_USER, PowerType.LOCK, PowerType.LOGOUT, PowerType.SUSPEND,
    PowerType.HYBRID_SLEEP, PowerType.HIBERNATE, PowerType.RESTART, PowerType.POWER_OFF,
];

export function isDestructive(type: number): boolean {
    return type === PowerType.RESTART || type === PowerType.POWER_OFF;
}

const powerShortcut = (type: number) => ({
    type,
    get name() { return POWER_INFO[type].name; },
    get icon() { return POWER_INFO[type].icon; },
});

export const POWER_SHORTCUTS: Record<string, {type: number; name: string; icon: string}> = {
    [ShortcutId.LOG_OUT]: powerShortcut(PowerType.LOGOUT),
    [ShortcutId.LOCK]: powerShortcut(PowerType.LOCK),
    [ShortcutId.RESTART]: powerShortcut(PowerType.RESTART),
    [ShortcutId.POWER_OFF]: powerShortcut(PowerType.POWER_OFF),
    [ShortcutId.SUSPEND]: powerShortcut(PowerType.SUSPEND),
    [ShortcutId.HYBRID_SLEEP]: powerShortcut(PowerType.HYBRID_SLEEP),
    [ShortcutId.HIBERNATE]: powerShortcut(PowerType.HIBERNATE),
    [ShortcutId.SWITCH_USER]: powerShortcut(PowerType.SWITCH_USER),
};

export const powerSignalNames = [
    'notify::can-power-off', 'notify::can-restart', 'notify::can-suspend',
    'notify::can-lock-screen', 'notify::can-switch-user', 'notify::can-logout',
];

interface SysActions {
    canPowerOff: boolean;
    canRestart: boolean;
    canSuspend: boolean;
    canLockScreen: boolean;
    canSwitchUser: boolean;
    canLogout: boolean;
    activatePowerOff(): void;
    activateRestart(): void;
    activateSuspend(): void;
    activateLockScreen(): void;
    activateSwitchUser(): void;
    activateLogout(): void;
    /** Re-reads the Polkit-dependent availability (no change notifications exist for it). */
    forceUpdate?(): void;
    connect(signal: string, cb: () => void): number;
    disconnect(id: number): void;
}

export function systemActions(): SysActions | null {
    try {
        return SystemActions.getDefault() as unknown as SysActions;
    } catch (e) {
        error('SystemActions unavailable', e);
        return null;
    }
}

export interface LogindInfo {
    hibernate: boolean;
    hybrid: boolean;
}

const LOGIN1 = {name: 'org.freedesktop.login1', path: '/org/freedesktop/login1', iface: 'org.freedesktop.login1.Manager'};

function canCall(result: string): boolean {
    return result === 'yes' || result === 'challenge';
}

export function probeLogind(): Promise<LogindInfo> {
    const bus = Gio.DBus.system;
    const ask = (method: string) => new Promise<boolean>(resolve => {
        try {
            bus.call(LOGIN1.name, LOGIN1.path, LOGIN1.iface, method, null, GLib.VariantType.new('(s)'),
                Gio.DBusCallFlags.NONE, 2000, null, (_c, res) => {
                    try {
                        const v = bus.call_finish(res);
                        resolve(canCall(v.deepUnpack<[string]>()[0]));
                    } catch {
                        resolve(false);
                    }
                });
        } catch {
            resolve(false);
        }
    });
    return Promise.all([ask('CanHibernate'), ask('CanHybridSleep')]).then(([hibernate, hybrid]) => ({hibernate, hybrid}));
}

export function isPowerAvailable(type: number, logind: LogindInfo | null): boolean {
    const sa = systemActions();
    switch (type) {
    case PowerType.LOGOUT: return Boolean(sa?.canLogout);
    case PowerType.LOCK: return Boolean(sa?.canLockScreen);
    case PowerType.RESTART: return Boolean(sa?.canRestart);
    case PowerType.POWER_OFF: return Boolean(sa?.canPowerOff);
    case PowerType.SUSPEND: return Boolean(sa?.canSuspend);
    case PowerType.SWITCH_USER: return Boolean(sa?.canSwitchUser);
    case PowerType.HIBERNATE: return Boolean(logind?.hibernate);
    case PowerType.HYBRID_SLEEP: return Boolean(logind?.hybrid);
    }
    return false;
}

function logindCall(method: 'Hibernate' | 'HybridSleep'): void {
    Gio.DBus.system.call(LOGIN1.name, LOGIN1.path, LOGIN1.iface, method, new GLib.Variant('(b)', [true]), null,
        Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
            try {
                c?.call_finish(res);
            } catch (e) {
                error(`logind ${method} failed`, e);
            }
        });
}

export function runPowerAction(type: number, host: {close(): void}, scope: Scope): void {
    host.close();
    // Let the popup release its grab first; the shell's dialogs need the stage.
    scope.idle(() => {
        try {
            const sa = systemActions();
            switch (type) {
            case PowerType.LOGOUT: sa?.activateLogout(); break;
            case PowerType.LOCK: sa?.activateLockScreen(); break;
            case PowerType.RESTART: sa?.activateRestart(); break;
            case PowerType.POWER_OFF: sa?.activatePowerOff(); break;
            case PowerType.SUSPEND: sa?.activateSuspend(); break;
            case PowerType.SWITCH_USER: sa?.activateSwitchUser(); break;
            case PowerType.HIBERNATE: logindCall('Hibernate'); break;
            case PowerType.HYBRID_SLEEP: logindCall('HybridSleep'); break;
            }
        } catch (e) {
            error('power action failed', e);
        }
    });
}
