// GNOME Settings panels found in the installed desktop files, and matching a query against them.
// Imports only gi://Gio / GLib and rank.ts, so it is unit-testable with gjs -m (tests/panels.test.js).
//
// gnome-control-center installs one NoDisplay desktop file per panel, named
//   org.gnome.Settings-<panel>-panel.desktop   (GNOME 45 and later)
//   gnome-<panel>-panel.desktop                (GNOME 3.x to 44, and some distributions still)
// with Name=, Keywords=, Icon= and X-GNOME-Settings-Panel=<panel> (the argument of
// `gnome-control-center <panel>`). Both namings are read; the panel id is X-GNOME-Settings-Panel, else the part
// of the file name. Only ids made of lower-case letters, digits and "-" are accepted (they end up as an
// argv element, never in a shell). When no panel file exists at all (a stripped-down install) a small
// built-in list of the well-known panels is used instead.
//
// Matching: the panel Name (full weight), then its Keywords, a built-in synonym table (wifi: wi-fi, wireless,
// internet...) and the id, scored like app names by rank.ts. Only substring-tier matches (and one-edit typos)
// count, never loose subsequences, and the query needs 3 characters.
//
// Public API:
//   SettingsPanel                        {id, name, icon, keys (normalised), description: ''}
//   panelIdFromFileName(name): string | null
//   isValidPanelId(id): boolean
//   loadPanels(dirs: string[]): SettingsPanel[]      reads <dir>/*-panel.desktop; earlier dirs win
//   builtinPanels(): SettingsPanel[]                 the fallback list
//   panelDirs(): string[]                            user data dir, then the system data dirs, + "/applications"
//   matchPanels(query, panels, limit?): Ranked<SettingsPanel>[]
//   panelArgv(id): string[]                          ['gnome-control-center', id]

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

import {hasAlnum, normalize, rankApps, type Ranked} from './rank.js';

export interface SettingsPanel {
    id: string;
    name: string;
    icon: Gio.Icon | null;
    keys: string[];
    description: string;
}

export const MIN_QUERY_LENGTH = 3;
const MIN_SCORE = 380;
const PANEL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE_NAME = /^(?:org\.gnome\.Settings-(.+)-panel|gnome-(.+)-panel)\.desktop$/;

/** Extra search words per panel id: only a fallback for what the desktop files' Keywords= leave out. */
const SYNONYMS: Record<string, string[]> = {
    wifi: ['wifi', 'wi-fi', 'wireless', 'wlan', 'internet', 'hotspot'],
    network: ['network', 'ethernet', 'vpn', 'proxy', 'internet', 'lan'],
    bluetooth: ['bluetooth', 'bt'],
    display: ['display', 'monitor', 'screen', 'resolution', 'refresh rate', 'night light', 'brightness'],
    sound: ['sound', 'audio', 'volume', 'speakers', 'microphone', 'headphones'],
    keyboard: ['keyboard', 'shortcuts', 'input sources', 'typing'],
    mouse: ['mouse', 'touchpad', 'trackpad', 'pointer', 'scrolling'],
    power: ['power', 'battery', 'power saving', 'suspend', 'energy'],
    privacy: ['privacy', 'location', 'camera', 'screen lock', 'permissions'],
    users: ['users', 'user accounts', 'password', 'login'],
    printers: ['printers', 'printing', 'scanner'],
    about: ['about', 'system', 'device name', 'hardware', 'version'],
    background: ['background', 'wallpaper', 'appearance', 'dark mode', 'theme'],
    notifications: ['notifications', 'do not disturb'],
    datetime: ['date', 'time', 'timezone', 'clock'],
    region: ['region', 'language', 'formats', 'locale'],
    color: ['colour', 'color', 'calibration'],
    sharing: ['sharing', 'remote desktop', 'screen sharing', 'file sharing'],
    search: ['search', 'indexing'],
    multitasking: ['multitasking', 'hot corner', 'workspaces'],
    applications: ['applications', 'apps', 'default apps'],
    'online-accounts': ['online accounts', 'accounts', 'google', 'nextcloud'],
    'universal-access': ['universal access', 'accessibility', 'screen reader', 'zoom'],
    'removable-media': ['removable media', 'usb', 'autorun'],
    thunderbolt: ['thunderbolt'],
    wacom: ['wacom', 'tablet', 'pen'],
    lock: ['lock screen', 'screen lock'],
    system: ['system', 'about', 'users', 'region', 'language', 'date', 'time'],
};

const BUILTIN: Array<[string, string, string]> = [
    ['wifi', 'Wi-Fi', 'network-wireless-symbolic'],
    ['network', 'Network', 'network-workgroup-symbolic'],
    ['bluetooth', 'Bluetooth', 'bluetooth-symbolic'],
    ['display', 'Displays', 'video-display-symbolic'],
    ['sound', 'Sound', 'audio-speakers-symbolic'],
    ['keyboard', 'Keyboard', 'input-keyboard-symbolic'],
    ['mouse', 'Mouse & Touchpad', 'input-mouse-symbolic'],
    ['power', 'Power', 'battery-symbolic'],
    ['privacy', 'Privacy', 'preferences-system-privacy-symbolic'],
    ['users', 'Users', 'system-users-symbolic'],
    ['printers', 'Printers', 'printer-symbolic'],
    ['about', 'About', 'help-about-symbolic'],
    ['background', 'Background', 'preferences-desktop-wallpaper-symbolic'],
    ['notifications', 'Notifications', 'preferences-system-notifications-symbolic'],
    ['datetime', 'Date & Time', 'preferences-system-time-symbolic'],
    ['region', 'Region & Language', 'preferences-desktop-locale-symbolic'],
    ['color', 'Color', 'preferences-color-symbolic'],
    ['sharing', 'Sharing', 'preferences-system-sharing-symbolic'],
    ['multitasking', 'Multitasking', 'view-grid-symbolic'],
    ['universal-access', 'Accessibility', 'preferences-desktop-accessibility-symbolic'],
];

export function isValidPanelId(id: string): boolean {
    return PANEL_ID.test(id);
}

export function panelIdFromFileName(name: string): string | null {
    const m = FILE_NAME.exec(name);
    const id = m ? (m[1] ?? m[2]) : null;
    return id && isValidPanelId(id) ? id : null;
}

export function panelArgv(id: string): string[] {
    return ['gnome-control-center', id];
}

function makePanel(id: string, name: string, icon: Gio.Icon | null, keywords: readonly string[]): SettingsPanel {
    const keys = new Set<string>();
    for (const k of [...keywords, ...(SYNONYMS[id] ?? []), id.replace(/-/g, ' '), id]) {
        const n = normalize(k);
        if (n)
            keys.add(n);
    }
    return {id, name, icon, keys: [...keys], description: ''};
}

export function loadPanels(dirs: string[]): SettingsPanel[] {
    const panels = new Map<string, SettingsPanel>();
    for (const dir of dirs) {
        let names: string[];
        try {
            names = listNames(dir);
        } catch {
            continue; // a missing directory is normal
        }
        for (const file of names.sort()) {
            const fileId = panelIdFromFileName(file);
            if (!fileId)
                continue;
            const info = GioUnix.DesktopAppInfo.new_from_filename(GLib.build_filenamev([dir, file]));
            if (!info)
                continue;
            const declared = info.get_string('X-GNOME-Settings-Panel');
            if (declared && !isValidPanelId(declared))
                continue; // a declared id that could not be an argument is not trusted at all
            const id = declared || fileId;
            const name = info.get_name();
            if (!name || panels.has(id))
                continue;
            let keywords: string[] = [];
            try {
                keywords = info.get_keywords() ?? [];
            } catch {
                // no Keywords=
            }
            panels.set(id, makePanel(id, name, info.get_icon(), keywords));
        }
    }
    return [...panels.values()];
}

function listNames(dir: string): string[] {
    const out: string[] = [];
    const en = Gio.File.new_for_path(dir).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    try {
        for (let i = en.next_file(null); i; i = en.next_file(null))
            out.push(i.get_name());
    } finally {
        en.close(null);
    }
    return out;
}

export function builtinPanels(): SettingsPanel[] {
    return BUILTIN.map(([id, name, icon]) => makePanel(id, name, new Gio.ThemedIcon({name: icon}), []));
}

export function panelDirs(): string[] {
    return [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()].map(d => GLib.build_filenamev([d, 'applications']));
}

export function matchPanels(query: string, panels: readonly SettingsPanel[], limit?: number): Ranked<SettingsPanel>[] {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH || !hasAlnum(q))
        return [];
    return rankApps(q, panels, undefined).filter(r => r.score >= MIN_SCORE).slice(0, limit ?? panels.length);
}
