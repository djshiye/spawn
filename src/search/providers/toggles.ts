// QuickTogglesProvider ('toggles'): flip a system switch from the search box.
//
// "dark mode", "night light", "do not disturb" / "dnd", "wifi", "bluetooth", "aeroplane mode" / "airplane mode"
// show one row that says what Return will do ("Turn on dark mode", description "Currently off"); adding the state
// ("wifi off", "turn on bluetooth", "disable night light") sets exactly that, and says so when nothing would
// change ("Wi-Fi is already off"). Matching and scores: search/answers/toggleQuery.ts; the provider takes part
// in the best match (search/bestMatch.ts), so the Wi-Fi panel of Settings still leads for "wifi" and the switch
// leads for "wifi off".
//
// Where the state lives (all local, nothing leaves the computer):
//   dark mode        org.gnome.desktop.interface color-scheme ('prefer-dark' / 'default')
//   Night Light      org.gnome.settings-daemon.plugins.color night-light-enabled
//   Do Not Disturb   org.gnome.desktop.notifications show-banners (inverted)
//   Wi-Fi            NetworkManager's WirelessEnabled property on the system bus; offered only when the computer
//                    has a Wi-Fi device and the radio is not blocked by a hardware switch
//   Bluetooth, aeroplane mode   org.gnome.SettingsDaemon.Rfkill on the session bus (what Quick Settings uses);
//                    offered only when it reports the hardware
// A switch whose backend is missing (no schema, no service, no hardware) is simply not offered. The D-Bus state is
// asked for when a query first matches one of those switches and is then kept for PROBE_TTL_MS; the results of
// that query are delivered when the answer arrives (within PROBE_TIMEOUT_MS at the latest). Setting goes through
// the same services, so their own rules (polkit for Wi-Fi) apply and nothing is bypassed.
//
// On by default: search-quick-toggles. Immediate (in memory; the D-Bus state is only fetched on a match).
//
// Public API:
//   new QuickTogglesProvider(settings: SpawnSettings)   implements SearchProvider

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import {hasWifi, parseNmObjects} from '../answers/netinfo.js';
import {matchToggles} from '../answers/toggleQuery.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';

const PROBE_TTL_MS = 2000;
const PROBE_TIMEOUT_MS = 800;

const NM_NAME = 'org.freedesktop.NetworkManager';
const NM_PATH = '/org/freedesktop/NetworkManager';
const RFKILL_NAME = 'org.gnome.SettingsDaemon.Rfkill';
const RFKILL_PATH = '/org/gnome/SettingsDaemon/Rfkill';
const PROPERTIES = 'org.freedesktop.DBus.Properties';

/** What the two D-Bus services said; null = not there (or not asked yet). */
interface RadioState {
    wifi: boolean | null;
    bluetooth: boolean | null;
    aeroplane: boolean | null;
}

interface Toggle {
    key: string;
    /** As it reads inside "Turn on ...". */
    label: string;
    name: string;
    synonyms: readonly string[];
    icon: string;
    /** Needs the D-Bus probe before it can be offered. */
    radio: boolean;
    /** null: not available on this computer. */
    get(): boolean | null;
    set(on: boolean): void;
}

function call(bus: Gio.DBusConnection, name: string, path: string, iface: string, method: string, args: GLib.Variant | null,
    cancellable: Gio.Cancellable | null = null): Promise<GLib.Variant> {
    return new Promise((resolve, reject) => {
        bus.call(name, path, iface, method, args, null, Gio.DBusCallFlags.NO_AUTO_START, PROBE_TIMEOUT_MS, cancellable, (_c, res) => {
            try {
                resolve(bus.call_finish(res));
            } catch (e) {
                reject(e as Error);
            }
        });
    });
}

function settingsFor(schemaId: string, key: string): Gio.Settings | null {
    try {
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(schemaId, true);
        return schema?.has_key(key) ? new Gio.Settings({settings_schema: schema}) : null;
    } catch (e) {
        error(`cannot open the settings schema ${schemaId}`, e);
        return null;
    }
}

export class QuickTogglesProvider implements SearchProvider {
    readonly id = 'toggles';
    readonly title = _('Quick settings');
    readonly immediate = true;

    private _toggles: Toggle[] | null = null;
    private readonly _gsettings = new Map<string, Gio.Settings | null>();
    private _radio: RadioState = {wifi: null, bluetooth: null, aeroplane: null};
    private _probedAt = 0;
    private _probing: Promise<void> | null = null;

    constructor(private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-quick-toggles');
    }

    clear(): void {
        this._probedAt = 0;
    }

    search(query: string, token: CancelToken): SearchResult[] | Promise<SearchResult[]> {
        const matches = matchToggles(query.trim(), this._all());
        if (matches.length === 0)
            return [];
        const build = (): SearchResult[] => {
            if (token.cancelled)
                return [];
            const out: SearchResult[] = [];
            for (const {item, score, want} of matches) {
                const state = item.get();
                if (state === null)
                    continue;
                const target = want ?? !state;
                const same = target === state;
                const stateText = state ? _('Currently on') : _('Currently off');
                let title: string;
                if (same)
                    title = (state ? _('%s is already on') : _('%s is already off')).replace('%s', item.name);
                else
                    title = (target ? _('Turn on %s') : _('Turn off %s')).replace('%s', item.label);
                out.push({
                    id: item.key,
                    providerId: this.id,
                    title,
                    description: same ? _('Nothing to change') : stateText,
                    alwaysShowDescription: true,
                    plainTitle: true,
                    icon: new Gio.ThemedIcon({name: item.icon}),
                    score,
                    activate: () => {
                        if (same)
                            return;
                        try {
                            item.set(target);
                        } catch (e) {
                            error(`switching ${item.key} failed`, e);
                        }
                    },
                });
            }
            return out;
        };
        if (!matches.some(m => m.item.radio) || GLib.get_monotonic_time() / 1000 - this._probedAt < PROBE_TTL_MS)
            return build();
        return this._probe().then(build);
    }

    private _gs(schemaId: string, key: string): Gio.Settings | null {
        const id = `${schemaId}/${key}`;
        if (!this._gsettings.has(id))
            this._gsettings.set(id, settingsFor(schemaId, key));
        return this._gsettings.get(id) ?? null;
    }

    private _all(): Toggle[] {
        if (this._toggles)
            return this._toggles;
        const flag = (schemaId: string, key: string, invert = false) => ({
            get: (): boolean | null => {
                const s = this._gs(schemaId, key);
                return s ? s.get_boolean(key) !== invert : null;
            },
            set: (on: boolean): void => {
                this._gs(schemaId, key)?.set_boolean(key, on !== invert);
            },
        });
        const rfkill = (property: string, invert: boolean, field: 'bluetooth' | 'aeroplane') => ({
            get: (): boolean | null => this._radio[field],
            set: (on: boolean): void => {
                this._radio[field] = on;
                this._setProperty(Gio.DBus.session, RFKILL_NAME, RFKILL_PATH, RFKILL_NAME, property, on !== invert);
            },
        });
        this._toggles = [
            {
                key: 'dark', label: _('dark mode'), name: _('Dark mode'), icon: 'dark-mode-symbolic', radio: false,
                synonyms: ['dark mode', 'dark style', 'dark theme', 'night mode'],
                get: (): boolean | null => {
                    const s = this._gs('org.gnome.desktop.interface', 'color-scheme');
                    return s ? s.get_string('color-scheme') === 'prefer-dark' : null;
                },
                set: (on: boolean): void => {
                    this._gs('org.gnome.desktop.interface', 'color-scheme')?.set_string('color-scheme', on ? 'prefer-dark' : 'default');
                },
            },
            {
                key: 'nightLight', label: _('Night Light'), name: _('Night Light'), icon: 'night-light-symbolic', radio: false,
                synonyms: ['night light', 'nightlight', 'blue light', 'night shift', 'warm colours', 'warm colors'],
                ...flag('org.gnome.settings-daemon.plugins.color', 'night-light-enabled'),
            },
            {
                key: 'dnd', label: _('Do Not Disturb'), name: _('Do Not Disturb'), icon: 'notifications-disabled-symbolic', radio: false,
                synonyms: ['do not disturb', 'dnd', 'mute notifications', 'silence notifications', 'quiet mode'],
                ...flag('org.gnome.desktop.notifications', 'show-banners', true),
            },
            {
                key: 'wifi', label: _('Wi-Fi'), name: _('Wi-Fi'), icon: 'network-wireless-symbolic', radio: true,
                synonyms: ['wifi', 'wi fi', 'wireless', 'wlan'],
                get: (): boolean | null => this._radio.wifi,
                set: (on: boolean): void => {
                    this._radio.wifi = on;
                    this._setProperty(Gio.DBus.system, NM_NAME, NM_PATH, NM_NAME, 'WirelessEnabled', on);
                },
            },
            {
                key: 'bluetooth', label: _('Bluetooth'), name: _('Bluetooth'), icon: 'bluetooth-active-symbolic', radio: true,
                synonyms: ['bluetooth', 'blue tooth'],
                ...rfkill('BluetoothAirplaneMode', true, 'bluetooth'),
            },
            {
                key: 'aeroplane', label: _('aeroplane mode'), name: _('Aeroplane mode'), icon: 'airplane-mode-symbolic', radio: true,
                synonyms: ['aeroplane mode', 'airplane mode', 'flight mode', 'plane mode'],
                ...rfkill('AirplaneMode', false, 'aeroplane'),
            },
        ];
        return this._toggles;
    }

    private _setProperty(bus: Gio.DBusConnection, name: string, path: string, iface: string, property: string, value: boolean): void {
        const args = new GLib.Variant('(ssv)', [iface, property, new GLib.Variant('b', value)]);
        call(bus, name, path, PROPERTIES, 'Set', args).catch(e => {
            this._probedAt = 0; // what was assumed above did not happen: ask again next time
            error(`setting ${property} failed`, e);
        });
    }

    /** Ask both services at once; a missing service just leaves its switches unavailable. Never rejects. */
    private _probe(): Promise<void> {
        this._probing ??= Promise.all([this._probeRfkill(), this._probeWifi()]).then(([rf, wifi]) => {
            this._radio = {wifi, bluetooth: rf.bluetooth, aeroplane: rf.aeroplane};
            this._probedAt = GLib.get_monotonic_time() / 1000;
        }).finally(() => {
            this._probing = null;
        });
        return this._probing;
    }

    private async _probeRfkill(): Promise<{bluetooth: boolean | null; aeroplane: boolean | null}> {
        try {
            const reply = await call(Gio.DBus.session, RFKILL_NAME, RFKILL_PATH, PROPERTIES, 'GetAll', new GLib.Variant('(s)', [RFKILL_NAME]));
            const [props] = reply.recursiveUnpack() as [Record<string, unknown>];
            return {
                bluetooth: props.BluetoothHasAirplaneMode === true ? props.BluetoothAirplaneMode !== true : null,
                aeroplane: props.HasAirplaneMode === true ? props.AirplaneMode === true : null,
            };
        } catch {
            return {bluetooth: null, aeroplane: null};
        }
    }

    private async _probeWifi(): Promise<boolean | null> {
        try {
            const bus = Gio.DBus.system;
            const [objects, props] = await Promise.all([
                call(bus, NM_NAME, '/org/freedesktop', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects', null),
                call(bus, NM_NAME, NM_PATH, PROPERTIES, 'GetAll', new GLib.Variant('(s)', [NM_NAME])),
            ]);
            const [all] = props.recursiveUnpack() as [Record<string, unknown>];
            if (!hasWifi(parseNmObjects((objects.recursiveUnpack() as [unknown])[0])) || all.WirelessHardwareEnabled === false)
                return null;
            return all.WirelessEnabled === true;
        } catch {
            return null;
        }
    }
}
