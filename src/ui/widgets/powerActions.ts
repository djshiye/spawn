// Power actions shared by PowerBar and the power ShortcutRows.
//
// Lock, log out, suspend, restart, power off and switch user go through GNOME's SystemActions
// (so confirmation dialogs and policy match the shell); hibernate and hybrid sleep go straight
// to logind since SystemActions has no entry for them.
//
// Public API:
//   POWER_INFO: Record<PowerType, {id, name, icon, shortcut}>
//   POWER_SHORTCUTS: Record<ShortcutId, {type, name, icon}>
//   systemActions(): SystemActions | null
//   isPowerAvailable(type, logind): boolean  current availability (hibernate/sleep from the probe)
//   probeLogind(): Promise<LogindInfo>       async CanHibernate / CanHybridSleep
//   runPowerAction(type, host: {close()}, scope): void   closes the menu first, then performs the action
//   powerSignalNames: string[]               SystemActions notify:: signals to watch

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {PowerType, ShortcutId} from '../../core/constants.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';

export type PowerTypeId = (typeof PowerType)[keyof typeof PowerType];

export interface PowerInfo {
    name: string;
    icon: string;
}

export const POWER_INFO: Record<number, PowerInfo> = {
    [PowerType.LOGOUT]: {name: 'Log Out', icon: 'system-log-out-symbolic'},
    [PowerType.LOCK]: {name: 'Lock', icon: 'system-lock-screen-symbolic'},
    [PowerType.RESTART]: {name: 'Restart', icon: 'system-reboot-symbolic'},
    [PowerType.POWER_OFF]: {name: 'Power Off', icon: 'system-shutdown-symbolic'},
    [PowerType.SUSPEND]: {name: 'Suspend', icon: 'media-playback-pause-symbolic'},
    [PowerType.HYBRID_SLEEP]: {name: 'Hybrid Sleep', icon: 'weather-clear-night-symbolic'},
    [PowerType.HIBERNATE]: {name: 'Hibernate', icon: 'document-save-symbolic'},
    [PowerType.SWITCH_USER]: {name: 'Switch User', icon: 'system-switch-user-symbolic'},
};

export const POWER_SHORTCUTS: Record<string, {type: number; name: string; icon: string}> = {
    [ShortcutId.LOG_OUT]: {type: PowerType.LOGOUT, ...POWER_INFO[PowerType.LOGOUT]},
    [ShortcutId.LOCK]: {type: PowerType.LOCK, ...POWER_INFO[PowerType.LOCK]},
    [ShortcutId.RESTART]: {type: PowerType.RESTART, ...POWER_INFO[PowerType.RESTART]},
    [ShortcutId.POWER_OFF]: {type: PowerType.POWER_OFF, ...POWER_INFO[PowerType.POWER_OFF]},
    [ShortcutId.SUSPEND]: {type: PowerType.SUSPEND, ...POWER_INFO[PowerType.SUSPEND]},
    [ShortcutId.HYBRID_SLEEP]: {type: PowerType.HYBRID_SLEEP, ...POWER_INFO[PowerType.HYBRID_SLEEP]},
    [ShortcutId.HIBERNATE]: {type: PowerType.HIBERNATE, ...POWER_INFO[PowerType.HIBERNATE]},
    [ShortcutId.SWITCH_USER]: {type: PowerType.SWITCH_USER, ...POWER_INFO[PowerType.SWITCH_USER]},
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
