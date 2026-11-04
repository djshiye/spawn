// Editable lists of aa{ss} entries (pinned apps, shortcuts, folder contents) for the prefs UI.
//
// Public API:
//   EntrySource                   {get(): Entry[], set(v: Entry[]): void, keys: SettingKey[] | null, folder?: FolderSettings}
//   createEntryList(ctx, opts)    Adw.PreferencesGroup with one row per entry: reorder (up/down),
//                                 delete, folder rename / contents; an "Add" menu depending on `kind`
//   describeEntry(entry)          {title, subtitle?, icon: Gio.Icon | string}
//   kinds: 'pinned' | 'folder' | 'directory' | 'application'

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix?version=2.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {ShortcutId} from '../core/constants.js';
import type {Entry, FolderSettings, SettingKey} from '../core/settings.js';
import type {PrefsContext} from './context.js';
import {toast} from './widgets.js';

export type ListKind = 'pinned' | 'folder' | 'directory' | 'application';

export interface EntrySource {
    get(): Entry[];
    set(value: Entry[]): void;
    /** Main-schema keys to watch, or null to watch `folder`. */
    keys: SettingKey[] | null;
    folder?: FolderSettings;
}

export interface EntryListOptions {
    title: string;
    description?: string;
    kind: ListKind;
    source: EntrySource;
    /** Adds a Reset button that restores the schema default of the (single) watched key. */
    reset?: boolean;
}

interface Builtin {
    id: string;
    title: string;
    icon: string;
}

const DIRECTORIES: readonly Builtin[] = [
    {id: ShortcutId.HOME, title: 'Home', icon: 'user-home-symbolic'},
    {id: ShortcutId.DOCUMENTS, title: 'Documents', icon: 'folder-documents-symbolic'},
    {id: ShortcutId.DOWNLOADS, title: 'Downloads', icon: 'folder-download-symbolic'},
    {id: ShortcutId.MUSIC, title: 'Music', icon: 'folder-music-symbolic'},
    {id: ShortcutId.PICTURES, title: 'Pictures', icon: 'folder-pictures-symbolic'},
    {id: ShortcutId.VIDEOS, title: 'Videos', icon: 'folder-videos-symbolic'},
    {id: ShortcutId.COMPUTER, title: 'Computer', icon: 'computer-symbolic'},
    {id: ShortcutId.NETWORK, title: 'Network', icon: 'network-workgroup-symbolic'},
    {id: ShortcutId.RECENT, title: 'Recent', icon: 'document-open-recent-symbolic'},
];

const ACTIONS: readonly Builtin[] = [
    {id: ShortcutId.SOFTWARE, title: 'Software', icon: 'org.gnome.Software-symbolic'},
    {id: ShortcutId.ACTIVITIES_OVERVIEW, title: 'Activities Overview', icon: 'view-fullscreen-symbolic'},
    {id: ShortcutId.SHOW_ALL_APPS, title: 'Show All Applications', icon: 'view-app-grid-symbolic'},
    {id: ShortcutId.RUN_COMMAND, title: 'Run Command', icon: 'system-run-symbolic'},
    {id: ShortcutId.SHOW_DESKTOP, title: 'Show Desktop', icon: 'user-desktop-symbolic'},
];

const BUILTINS = new Map<string, Builtin>([
    ...DIRECTORIES,
    ...ACTIONS,
    {id: ShortcutId.SEPARATOR, title: 'Separator', icon: 'list-remove-symbolic'},
    {id: ShortcutId.SPACER, title: 'Spacer', icon: 'list-remove-symbolic'},
    {id: ShortcutId.POWER_OPTIONS, title: 'Power Options', icon: 'system-shutdown-symbolic'},
].map((b): [string, Builtin] => [b.id, b]));

export function describeEntry(entry: Entry): {title: string; subtitle?: string; icon: Gio.Icon | string} {
    if (entry.isFolder === 'true')
        return {title: entry.name || 'Folder', subtitle: 'Folder', icon: 'folder-symbolic'};
    const builtin = BUILTINS.get(entry.id);
    if (builtin)
        return {title: entry.name || builtin.title, subtitle: builtin.id === ShortcutId.SEPARATOR ? undefined : 'Built-in', icon: builtin.icon};
    if (entry.id.endsWith('.desktop')) {
        const info = GioUnix.DesktopAppInfo.new(entry.id);
        if (info)
            return {title: entry.name || info.get_display_name(), subtitle: entry.id, icon: info.get_icon() ?? 'application-x-executable'};
        return {title: entry.name || entry.id, subtitle: 'Not installed', icon: 'dialog-question-symbolic'};
    }
    return {title: entry.name || entry.id, subtitle: entry.id, icon: entry.icon && !entry.icon.startsWith('Spawn_') ? entry.icon : 'application-x-executable-symbolic'};
}

function clearGroup(group: Adw.PreferencesGroup, rows: Gtk.Widget[]): void {
    for (const row of rows.splice(0))
        group.remove(row);
}

function iconWidget(icon: Gio.Icon | string): Gtk.Image {
    return typeof icon === 'string' ? new Gtk.Image({icon_name: icon}) : new Gtk.Image({gicon: icon});
}

function flatButton(icon: string, tooltip: string): Gtk.Button {
    return new Gtk.Button({icon_name: icon, tooltip_text: tooltip, valign: Gtk.Align.CENTER, css_classes: ['flat']});
}

/** Asks for one line of text. */
export function promptText(ctx: PrefsContext, heading: string, initial: string, accept: string, cb: (text: string) => void): void {
    const dialog = new Adw.AlertDialog({heading});
    const entry = new Gtk.Entry({text: initial, activates_default: true});
    dialog.set_extra_child(entry);
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('ok', accept);
    dialog.set_response_appearance('ok', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('ok');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_d: Adw.AlertDialog, id: string) => {
        const text = entry.text.trim();
        if (id === 'ok' && text !== '')
            cb(text);
    });
    dialog.present(ctx.window);
}

function confirm(ctx: PrefsContext, heading: string, body: string, accept: string, cb: () => void): void {
    const dialog = new Adw.AlertDialog({heading, body});
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('ok', accept);
    dialog.set_response_appearance('ok', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_close_response('cancel');
    dialog.connect('response', (_d: Adw.AlertDialog, id: string) => {
        if (id === 'ok')
            cb();
    });
    dialog.present(ctx.window);
}

/** Searchable list of installed applications. */
export function chooseApplication(ctx: PrefsContext, exclude: ReadonlySet<string>, cb: (id: string) => void): void {
    const dialog = new Adw.Dialog({title: 'Add Application', content_width: 440, content_height: 560});
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());
    const search = new Gtk.SearchEntry({placeholder_text: 'Search applications', margin_start: 12, margin_end: 12, margin_top: 6, margin_bottom: 6});
    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list'], margin_start: 12, margin_end: 12, margin_bottom: 12});
    const apps = Gio.AppInfo.get_all()
        .filter(app => app.should_show() && app.get_id() && !exclude.has(app.get_id() as string))
        .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
    const rows = new Map<Gtk.Widget, string>();
    for (const app of apps) {
        const row = new Adw.ActionRow({title: GLib.markup_escape_text(app.get_display_name(), -1), activatable: true});
        const desc = app.get_description();
        if (desc)
            row.set_subtitle(GLib.markup_escape_text(desc, -1));
        row.set_subtitle_lines(1);
        const icon = app.get_icon();
        row.add_prefix(icon ? new Gtk.Image({gicon: icon, pixel_size: 32}) : new Gtk.Image({icon_name: 'application-x-executable', pixel_size: 32}));
        row.connect('activated', () => {
            dialog.close();
            cb(app.get_id() as string);
        });
        list.append(row);
        rows.set(row, `${app.get_display_name()} ${app.get_id()}`.toLowerCase());
    }
    list.set_filter_func(row => {
        const q = search.text.trim().toLowerCase();
        return q === '' || (rows.get(row) ?? '').includes(q);
    });
    search.connect('search-changed', () => list.invalidate_filter());
    const scroller = new Gtk.ScrolledWindow({vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER, child: list});
    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    body.append(search);
    body.append(scroller);
    toolbar.set_content(body);
    dialog.set_child(toolbar);
    dialog.set_focus(search);
    dialog.present(ctx.window);
}

function chooseFolderPath(ctx: PrefsContext, cb: (path: string) => void): void {
    const chooser = new Gtk.FileDialog({title: 'Choose a folder'});
    chooser.select_folder(ctx.window, null, (_d: Gtk.FileDialog | null, res: Gio.AsyncResult) => {
        try {
            const path = chooser.select_folder_finish(res)?.get_path();
            if (path)
                cb(path);
        } catch (e) {
            if (!(e instanceof GLib.Error) || !e.matches(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED))
                toast(ctx, `Could not use that folder: ${(e as Error).message}`);
        }
    });
}

function promptCommand(ctx: PrefsContext, cb: (name: string, command: string) => void): void {
    const dialog = new Adw.AlertDialog({heading: 'Add Command'});
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
    const name = new Gtk.Entry({placeholder_text: 'Name'});
    const command = new Gtk.Entry({placeholder_text: 'Command, e.g. gnome-calculator', activates_default: true});
    box.append(name);
    box.append(command);
    dialog.set_extra_child(box);
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('ok', 'Add');
    dialog.set_response_appearance('ok', Adw.ResponseAppearance.SUGGESTED);
    dialog.set_default_response('ok');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_d: Adw.AlertDialog, id: string) => {
        if (id === 'ok' && command.text.trim() !== '')
            cb(name.text.trim() || command.text.trim(), command.text.trim());
    });
    dialog.present(ctx.window);
}

function menuModel(kind: ListKind): Gio.Menu {
    const menu = new Gio.Menu();
    const addBuiltins = (label: string, items: readonly Builtin[]): void => {
        const sub = new Gio.Menu();
        for (const b of items)
            sub.append(b.title, `list.builtin('${b.id}')`);
        menu.append_submenu(label, sub);
    };
    if (kind !== 'directory')
        menu.append('Application…', 'list.app');
    if (kind === 'pinned')
        menu.append('New folder…', 'list.folder');
    if (kind === 'directory') {
        addBuiltins('Standard folders', DIRECTORIES);
        menu.append('Other folder…', 'list.path');
    }
    if (kind === 'application') {
        addBuiltins('Built-in items', ACTIONS);
        menu.append('Command…', 'list.command');
        menu.append('Separator', `list.builtin('${ShortcutId.SEPARATOR}')`);
    }
    return menu;
}

export function createEntryList(ctx: PrefsContext, opts: EntryListOptions): Adw.PreferencesGroup {
    const {source, kind} = opts;
    const group = new Adw.PreferencesGroup({title: opts.title});
    if (opts.description)
        group.set_description(opts.description);
    const rows: Gtk.Widget[] = [];

    const items = (): Entry[] => source.get();
    const put = (list: Entry[]): void => source.set(list);
    const has = (id: string): boolean => {
        if (items().some(e => e.id === id))
            return true;
        if (kind !== 'pinned')
            return false;
        return items().some(e => e.isFolder === 'true' && ctx.settings.folder(e.id).pinnedApps.some(a => a.id === id));
    };
    const add = (entry: Entry): void => {
        if (entry.id !== ShortcutId.SEPARATOR && has(entry.id)) {
            toast(ctx, 'Already in the list');
            return;
        }
        put([...items(), entry]);
    };
    const move = (index: number, delta: number): void => {
        const list = items();
        const target = index + delta;
        if (target < 0 || target >= list.length)
            return;
        const [entry] = list.splice(index, 1);
        list.splice(target, 0, entry as Entry);
        put(list);
    };
    const remove = (index: number): void => {
        const list = items();
        const [entry] = list.splice(index, 1);
        if (entry?.isFolder === 'true')
            ctx.settings.deleteFolder(entry.id);
        put(list);
    };

    const build = (): void => {
        clearGroup(group, rows);
        const list = items();
        if (list.length === 0) {
            const empty = new Adw.ActionRow({title: 'Nothing here yet', sensitive: false});
            group.add(empty);
            rows.push(empty);
            return;
        }
        list.forEach((entry, index) => {
            const d = describeEntry(entry);
            const row = new Adw.ActionRow({title: GLib.markup_escape_text(d.title, -1)});
            if (d.subtitle)
                row.set_subtitle(GLib.markup_escape_text(d.subtitle, -1));
            const icon = iconWidget(d.icon);
            icon.set_pixel_size(24);
            row.add_prefix(icon);

            if (entry.isFolder === 'true') {
                const contents = flatButton('view-list-symbolic', 'Edit apps in this folder');
                contents.connect('clicked', () => openFolderEditor(ctx, entry.id, entry.name ?? ''));
                const rename = flatButton('document-edit-symbolic', 'Rename folder');
                rename.connect('clicked', () => promptText(ctx, 'Rename Folder', entry.name ?? '', 'Rename', name => {
                    const next = items();
                    const target = next.find(e => e.id === entry.id);
                    if (target) {
                        target.name = name;
                        ctx.settings.folder(entry.id).name = name;
                        put(next);
                    }
                }));
                row.add_suffix(contents);
                row.add_suffix(rename);
                const count = ctx.settings.folder(entry.id).pinnedApps.length;
                row.set_subtitle(`Folder, ${count} ${count === 1 ? 'app' : 'apps'}`);
            }

            const up = flatButton('go-up-symbolic', 'Move up');
            up.set_sensitive(index > 0);
            up.connect('clicked', () => move(index, -1));
            const down = flatButton('go-down-symbolic', 'Move down');
            down.set_sensitive(index < list.length - 1);
            down.connect('clicked', () => move(index, 1));
            const del = flatButton('user-trash-symbolic', 'Remove');
            del.connect('clicked', () => {
                if (entry.isFolder === 'true') {
                    confirm(ctx, `Delete folder "${entry.name ?? ''}"?`, 'The apps inside it are unpinned.', 'Delete', () => remove(index));
                } else {
                    remove(index);
                }
            });
            row.add_suffix(up);
            row.add_suffix(down);
            row.add_suffix(del);
            group.add(row);
            rows.push(row);
        });
    };
    build();

    // Observe the settings behind the list so edits made elsewhere show up.
    const raw = source.folder ? source.folder.raw : ctx.settings.raw;
    const watchKeys = source.keys ?? ['pinned-apps'];
    const ids = source.folder ? [raw.connect('changed', build)] : watchKeys.map(k => raw.connect(`changed::${k}`, build));
    group.connect('destroy', () => ids.forEach(id => raw.disconnect(id)));

    // "Add" menu.
    const actions = new Gio.SimpleActionGroup();
    const act = (name: string, cb: (param: GLib.Variant | null) => void, withParam = false): void => {
        const a = withParam ? new Gio.SimpleAction({name, parameter_type: GLib.VariantType.new('s')}) : new Gio.SimpleAction({name});
        a.connect('activate', (_a: Gio.SimpleAction, param: GLib.Variant | null) => cb(param));
        actions.add_action(a);
    };
    act('app', () => {
        const exclude = new Set<string>(items().map(e => e.id));
        if (kind === 'pinned') {
            for (const e of items()) {
                if (e.isFolder === 'true')
                    ctx.settings.folder(e.id).pinnedApps.forEach(a => exclude.add(a.id));
            }
        }
        chooseApplication(ctx, exclude, id => add({id}));
    });
    act('folder', () => promptText(ctx, 'New Folder', '', 'Create', name => {
        const uuid = GLib.uuid_string_random();
        const folder = ctx.settings.folder(uuid);
        folder.name = name;
        folder.pinnedApps = [];
        put([...items(), {id: uuid, name, isFolder: 'true'}]);
    }));
    act('builtin', param => {
        const id = param?.get_string()[0] ?? '';
        const b = BUILTINS.get(id);
        if (!b)
            return;
        if (id === ShortcutId.SEPARATOR)
            add({id, name: 'Separator', icon: 'list-remove-symbolic'});
        else if (kind === 'directory')
            add({id, name: b.title, icon: id});
        else
            add({id, name: b.title});
    }, true);
    act('path', () => chooseFolderPath(ctx, path => add({id: path, name: GLib.path_get_basename(path), icon: 'folder-symbolic'})));
    act('command', () => promptCommand(ctx, (name, command) => add({id: command, name, icon: 'utilities-terminal-symbolic'})));
    group.insert_action_group('list', actions);

    const addButton = new Gtk.MenuButton({
        icon_name: 'list-add-symbolic',
        tooltip_text: 'Add',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        menu_model: menuModel(kind),
    });
    if (opts.reset && source.keys?.length === 1) {
        const key = source.keys[0] as SettingKey;
        const reset = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['flat'], tooltip_text: 'Restore the default list'});
        reset.connect('clicked', () => {
            if (kind === 'pinned') {
                for (const e of items()) {
                    if (e.isFolder === 'true')
                        ctx.settings.deleteFolder(e.id);
                }
            }
            ctx.settings.reset(key);
            toast(ctx, `${opts.title} reset to defaults`);
        });
        const box = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 6});
        box.append(reset);
        box.append(addButton);
        group.set_header_suffix(box);
    } else {
        group.set_header_suffix(addButton);
    }
    return group;
}

export function openFolderEditor(ctx: PrefsContext, uuid: string, name: string): void {
    const folder = ctx.settings.folder(uuid);
    const dialog = new Adw.Dialog({title: name || 'Folder', content_width: 520, content_height: 520});
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());
    const page = new Adw.PreferencesPage();
    page.add(createEntryList(ctx, {
        title: 'Apps in this folder',
        kind: 'folder',
        source: {get: () => folder.pinnedApps, set: v => { folder.pinnedApps = v; }, keys: null, folder},
    }));
    toolbar.set_content(page);
    dialog.set_child(toolbar);
    dialog.present(ctx.window);
}
