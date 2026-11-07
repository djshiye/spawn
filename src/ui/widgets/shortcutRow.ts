// ShortcutRow: right-pane shortcut (directory, application, built-in or separator) built from one
// Entry of directory-shortcuts / application-shortcuts.
//
// Resolves Spawn_* ids (core/constants.ts ShortcutId), .desktop ids and absolute paths /
// shell commands. Separators render as a thin line. Power ids are handled by the PowerBar
// helpers in powerBar.ts.
//
// Public API:
//   new ShortcutRow(entry: Entry, host: ShortcutHost, opts?: ShortcutOptions)
//   row.actor: St.Widget
//   row.isSeparator: boolean
//   row.destroy()
//   ShortcutRow.resolve(entry): ResolvedShortcut | null    null when it cannot be shown (missing app)
//   ShortcutHost: {close(), showAllApps?(), tooltips?}
//   ShortcutOptions: {iconSize?, symbolic?, scope?}   iconSize 0 = no icon

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ShortcutId} from '../../core/constants.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Entry} from '../../core/settings.js';
import {toggleShowDesktop} from '../showDesktop.js';
import {symbolicGIcon} from '../util.js';
import {nameItem} from './a11y.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import {POWER_SHORTCUTS, runPowerAction} from './powerActions.js';
import type {TooltipManager} from './tooltip.js';

export interface ShortcutHost {
    close(): void;
    /** Switch to the all-apps view (Spawn_ShowAllApplications). */
    showAllApps?(): void;
    tooltips?: TooltipManager;
}

export interface ShortcutOptions {
    iconSize?: number;
    symbolic?: boolean;
    /** Scope for deferred actions (power); required for power shortcuts. */
    scope?: Scope;
}

export interface ResolvedShortcut {
    name: string;
    icon: Gio.Icon | string | null;
    run(host: ShortcutHost, scope: Scope): void;
}

/** Marks a string for translation without translating it at module load (`_()` runs where it is shown). */
const N_ = (s: string): string => s;

const DIRS: Record<string, {dir: GLib.UserDirectory | null; icon: string; name: string}> = {
    [ShortcutId.HOME]: {dir: null, icon: 'user-home-symbolic', name: N_('Home')},
    [ShortcutId.DOCUMENTS]: {dir: GLib.UserDirectory.DIRECTORY_DOCUMENTS, icon: 'folder-documents-symbolic', name: N_('Documents')},
    [ShortcutId.DOWNLOADS]: {dir: GLib.UserDirectory.DIRECTORY_DOWNLOAD, icon: 'folder-download-symbolic', name: N_('Downloads')},
    [ShortcutId.MUSIC]: {dir: GLib.UserDirectory.DIRECTORY_MUSIC, icon: 'folder-music-symbolic', name: N_('Music')},
    [ShortcutId.PICTURES]: {dir: GLib.UserDirectory.DIRECTORY_PICTURES, icon: 'folder-pictures-symbolic', name: N_('Pictures')},
    [ShortcutId.VIDEOS]: {dir: GLib.UserDirectory.DIRECTORY_VIDEOS, icon: 'folder-videos-symbolic', name: N_('Videos')},
};

const URIS: Record<string, {uri: string; icon: string; name: string}> = {
    [ShortcutId.COMPUTER]: {uri: 'computer:///', icon: 'computer-symbolic', name: N_('Computer')},
    [ShortcutId.NETWORK]: {uri: 'network:///', icon: 'network-workgroup-symbolic', name: N_('Network')},
    [ShortcutId.RECENT]: {uri: 'recent:///', icon: 'document-open-recent-symbolic', name: N_('Recent')},
};

function openUri(uri: string): void {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        error(`could not open ${uri}`, e);
    }
}

function customIcon(entry: Entry): string | null {
    const icon = entry.icon;
    if (!icon || icon.startsWith('Spawn_') || icon.startsWith('ArcMenu_'))
        return null;
    return icon;
}

function appShortcut(id: string, nameOverride?: string): ResolvedShortcut | null {
    const app = Shell.AppSystem.get_default().lookup_app(id);
    if (!app)
        return null;
    return {
        name: nameOverride || app.get_name(),
        icon: app.get_icon(),
        run: host => {
            host.close();
            app.activate();
        },
    };
}

export function resolveShortcut(entry: Entry): ResolvedShortcut | null {
    const id = entry.id;
    const name = entry.name;
    const icon = customIcon(entry);

    const dir = DIRS[id];
    if (dir) {
        const path = dir.dir === null ? GLib.get_home_dir() : GLib.get_user_special_dir(dir.dir) ?? GLib.get_home_dir();
        const label = name || _(dir.name);
        return {name: label, icon: icon ?? dir.icon, run: host => { host.close(); openUri(GLib.filename_to_uri(path, null)); }};
    }
    const uri = URIS[id];
    if (uri)
        return {name: name || _(uri.name), icon: icon ?? uri.icon, run: host => { host.close(); openUri(uri.uri); }};

    const power = POWER_SHORTCUTS[id];
    if (power) {
        return {
            name: name || power.name,
            icon: icon ?? power.icon,
            run: (host, scope) => runPowerAction(power.type, host, scope),
        };
    }

    switch (id) {
    case ShortcutId.SOFTWARE: {
        const sw = Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop');
        if (!sw)
            return null;
        return {name: name || sw.get_name(), icon: icon ?? sw.get_icon(), run: host => { host.close(); sw.activate(); }};
    }
    case ShortcutId.ACTIVITIES_OVERVIEW:
        return {name: name || _('Activities Overview'), icon: icon ?? 'view-fullscreen-symbolic', run: host => { host.close(); Main.overview.show(); }};
    case ShortcutId.SHOW_ALL_APPS:
        return {name: name || _('All Apps'), icon: icon ?? 'view-app-grid-symbolic', run: host => host.showAllApps?.()};
    case ShortcutId.RUN_COMMAND:
        return {name: name || _('Run Command'), icon: icon ?? 'system-run-symbolic', run: host => { host.close(); Main.openRunDialog(); }};
    case ShortcutId.SHOW_DESKTOP:
        return {
            name: name || _('Show Desktop'),
            icon: icon ?? 'computer-symbolic',
            run: host => {
                host.close();
                toggleShowDesktop();
            },
        };
    case ShortcutId.FOLDER:
        return null;
    }

    if (id.endsWith('.desktop'))
        return appShortcut(id, name);

    if (id.startsWith('/') || id.startsWith('file://') || id.includes('://')) {
        const u = id.includes('://') ? id : GLib.filename_to_uri(id, null);
        return {name: name || GLib.path_get_basename(id), icon: icon ?? 'folder-symbolic', run: host => { host.close(); openUri(u); }};
    }
    if (id.startsWith('Spawn_') || id.startsWith('ArcMenu_'))
        return null;
    if (!id)
        return null;
    // Anything else is a shell command.
    return {
        name: name || id,
        icon: icon ?? 'utilities-terminal-symbolic',
        run: host => {
            host.close();
            try {
                GLib.spawn_command_line_async(id);
            } catch (e) {
                error(`could not run ${id}`, e);
            }
        },
    };
}

export class ShortcutRow {
    readonly actor: St.Widget;
    readonly isSeparator: boolean;

    static resolve(entry: Entry): ResolvedShortcut | null {
        return resolveShortcut(entry);
    }

    constructor(entry: Entry, host: ShortcutHost, opts: ShortcutOptions = {}) {
        const scope = opts.scope;
        this.isSeparator = entry.id === ShortcutId.SEPARATOR || entry.id === 'ArcMenu_Separator';
        if (this.isSeparator) {
            this.actor = new St.Widget({style_class: 'spawn-separator', x_expand: true});
            return;
        }

        const resolved = resolveShortcut(entry);
        const button = makeItemButton('spawn-shortcut-row');
        this.actor = button;

        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        // iconSize 0 (icon-size-shortcuts = 0) hides the icon: the row keeps its height (the face's min-height)
        if (opts.iconSize !== 0) {
            const icon = new St.Icon({
                style_class: 'spawn-shortcut-icon',
                icon_size: opts.iconSize ?? 16,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const gicon = resolved?.icon;
            if (typeof gicon === 'string') {
                if (gicon.startsWith('/'))
                    icon.gicon = Gio.FileIcon.new(Gio.File.new_for_path(gicon));
                else
                    icon.icon_name = gicon;
            } else if (gicon) {
                icon.gicon = opts.symbolic ? symbolicGIcon(gicon) : gicon;
            }
            box.add_child(icon);
        }
        const label = new St.Label({
            text: resolved?.name ?? entry.name ?? entry.id,
            style_class: 'spawn-shortcut-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(label);
        button.set_child(makeFace('spawn-row-surface', box));

        nameItem(button, label.text, {label, listItem: true});
        host.tooltips?.attach(button, label);
        wireItem(button, {activate: () => resolved?.run(host, scope as Scope)});
    }

    destroy(): void {
        this.actor.destroy();
    }
}
