// Icon picker for the panel button: a virtualised grid of the bundled icons (data/icons) and of the system
// icon theme, plus a file chooser. A picked bundled icon is stored as its file name, a system icon as its
// themed name, a chosen file as its absolute path (see core/icons.ts resolveButtonIcon).
//
// Public API:
//   iconImage(ctx, value, size): Gtk.Image      renders a `menu-button-icon` value
//   openIconPicker(ctx): IconPicker  opens the icon dialog (source filter All/Spawn/Distros/System, style filter,
//                                    debounced search, current icon shown); returns its widgets for tests
//   createIconRow(ctx): Adw.ActionRow            current icon + "Choose" button, bound to menu-button-icon

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import type GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

import {resolveButtonIcon} from '../core/icons.js';
import type {PrefsContext} from './context.js';
import {label, toast, watch} from './widgets.js';

type Source = 'all' | 'spawn' | 'distro' | 'system';
type Style = 'all' | 'symbolic' | 'colour';

const SOURCES: readonly Source[] = ['all', 'spawn', 'distro', 'system'];
const STYLES: readonly Style[] = ['all', 'symbolic', 'colour'];
const SEARCH_DELAY_MS = 150;

/** What openIconPicker returns: the live widgets, so the dev-prefs test can drive the dialog like a user. */
export interface IconPicker {
    dialog: Adw.Dialog;
    search: Gtk.SearchEntry;
    sourceBox: Gtk.DropDown;
    styleBox: Gtk.DropDown;
    grid: Gtk.GridView;
    /** The filtered list the grid shows (Gtk.StringObject items whose `string` is the setting value). */
    model: Gtk.FilterListModel;
}

/** Sets an image from a `menu-button-icon` value (bundled file, absolute path or themed name). */
function setImage(image: Gtk.Image, extensionDir: string, value: string): void {
    const resolved = resolveButtonIcon(value, `${extensionDir}/data/icons`);
    if (resolved.kind === 'file')
        image.set_from_gicon(Gio.FileIcon.new(Gio.File.new_for_path(resolved.path)));
    else
        image.set_from_icon_name(resolved.name);
}

export function iconImage(ctx: PrefsContext, value: string, size: number): Gtk.Image {
    const image = new Gtk.Image({pixel_size: size});
    setImage(image, ctx.extensionDir, value);
    return image;
}

function bundledIcons(ctx: PrefsContext): string[] {
    const names: string[] = [];
    try {
        const dir = Gio.File.new_for_path(`${ctx.extensionDir}/data/icons`);
        const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = en.next_file(null); info !== null; info = en.next_file(null)) {
            const name = info.get_name();
            if (name.endsWith('.svg'))
                names.push(name);
        }
    } catch (e) {
        console.error(`[spawn] cannot list bundled icons: ${e}`);
    }
    return names.sort((a, b) => a.localeCompare(b));
}

function systemIcons(): string[] {
    const display = Gdk.Display.get_default();
    if (!display)
        return [];
    return Gtk.IconTheme.get_for_display(display).get_icon_names().sort((a, b) => a.localeCompare(b));
}

/** Which source a setting value belongs to: bundled files end in .svg, theme names never do. */
function sourceOf(value: string): Exclude<Source, 'all'> {
    if (!value.endsWith('.svg'))
        return 'system';
    return value.startsWith('distro-') ? 'distro' : 'spawn';
}

function displayName(value: string): string {
    return value.startsWith('/') ? value : value.replace(/\.svg$/, '');
}

export function openIconPicker(ctx: PrefsContext): IconPicker {
    const dialog = new Adw.Dialog({title: 'Choose Icon', content_width: 600, content_height: 600});
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());

    const search = new Gtk.SearchEntry({placeholder_text: 'Search icons', hexpand: true});
    const sourceBox = new Gtk.DropDown({
        model: Gtk.StringList.new(['All icons', 'Spawn', 'Distros', 'System']),
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Where to look for icons',
    });
    const styleBox = new Gtk.DropDown({
        model: Gtk.StringList.new(['Any style', 'Symbolic', 'Full colour']),
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Symbolic icons follow the panel colour',
    });
    label(sourceBox, 'Icon source');
    label(styleBox, 'Icon style');
    const bar = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, margin_start: 12, margin_end: 12, margin_top: 6});
    bar.append(search);
    bar.append(sourceBox);
    bar.append(styleBox);

    // The currently chosen icon, so the user sees what they would replace.
    const currentImage = new Gtk.Image({pixel_size: 24});
    const currentLabel = new Gtk.Label({xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END});
    const currentBar = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, margin_start: 12, margin_end: 12, margin_top: 6});
    currentBar.append(currentImage);
    currentBar.append(currentLabel);
    const showCurrent = (): string => {
        const value = ctx.settings.get('menu-button-icon');
        setImage(currentImage, ctx.extensionDir, value);
        currentLabel.set_label(`Current: ${displayName(value)}`);
        return value;
    };
    let current = showCurrent();

    // One list holds every candidate value; the system theme (thousands of names) is added the first time
    // a source that includes it is shown. The grid only builds widgets for the rows on screen.
    const store = Gtk.StringList.new(bundledIcons(ctx));
    let systemLoaded = false;
    const loadSystem = (): void => {
        if (systemLoaded)
            return;
        systemLoaded = true;
        store.splice(store.get_n_items(), 0, systemIcons());
    };

    const matches = (value: string): boolean => {
        const source = SOURCES[sourceBox.selected] ?? 'all';
        if (source !== 'all' && sourceOf(value) !== source)
            return false;
        const style = STYLES[styleBox.selected] ?? 'all';
        const symbolic = value.includes('-symbolic');
        if (style === 'symbolic' && !symbolic)
            return false;
        if (style === 'colour' && symbolic)
            return false;
        const q = search.text.trim().toLowerCase();
        return q === '' || displayName(value).toLowerCase().includes(q);
    };
    const filter = Gtk.CustomFilter.new(item => matches((item as Gtk.StringObject).string));
    const model = Gtk.FilterListModel.new(store, filter);
    const selection = Gtk.SingleSelection.new(model);
    selection.autoselect = false;
    selection.can_unselect = true;

    // Highlights the current icon when it is in the filtered list.
    const markCurrent = (): void => {
        let position = Gtk.INVALID_LIST_POSITION;
        for (let i = 0, n = model.get_n_items(); i < n; i++) {
            if ((model.get_item(i) as Gtk.StringObject).string === current) {
                position = i;
                break;
            }
        }
        selection.set_selected(position);
    };

    const factory = new Gtk.SignalListItemFactory();
    factory.connect('setup', (_f: Gtk.SignalListItemFactory, obj: GObject.Object) => {
        const item = obj as Gtk.ListItem;
        item.set_child(new Gtk.Image({pixel_size: 32, margin_top: 10, margin_bottom: 10, margin_start: 10, margin_end: 10}));
    });
    factory.connect('bind', (_f: Gtk.SignalListItemFactory, obj: GObject.Object) => {
        const item = obj as Gtk.ListItem;
        const value = (item.get_item() as Gtk.StringObject).string;
        const image = item.get_child() as Gtk.Image;
        setImage(image, ctx.extensionDir, value);
        image.set_tooltip_text(displayName(value));
        label(image, displayName(value));
    });

    const grid = new Gtk.GridView({
        model: selection,
        factory,
        single_click_activate: true,
        min_columns: 4,
        max_columns: 9,
        margin_start: 6,
        margin_end: 6,
        margin_top: 6,
        margin_bottom: 6,
    });
    grid.connect('activate', (_g: Gtk.GridView, position: number) => {
        const item = model.get_item(position) as Gtk.StringObject | null;
        if (!item)
            return;
        ctx.settings.set('menu-button-icon', item.string);
        dialog.close();
    });

    const empty = new Gtk.Label({label: 'No icons match', css_classes: ['dim-label'], margin_top: 24, visible: false});
    // The filter's own items-changed fires when it is re-evaluated or when the system names arrive.
    model.connect('items-changed', () => {
        markCurrent();
        empty.set_visible(model.get_n_items() === 0);
    });
    const refresh = (): void => {
        const source = SOURCES[sourceBox.selected] ?? 'all';
        if (source === 'all' || source === 'system')
            loadSystem();
        filter.changed(Gtk.FilterChange.DIFFERENT);
        markCurrent();
        empty.set_visible(model.get_n_items() === 0);
    };

    let timer = 0;
    const cancelTimer = (): void => {
        if (timer !== 0)
            GLib.source_remove(timer);
        timer = 0;
    };
    search.connect('search-changed', () => {
        cancelTimer();
        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DELAY_MS, () => {
            timer = 0;
            refresh();
            return GLib.SOURCE_REMOVE;
        });
    });
    sourceBox.connect('notify::selected', refresh);
    styleBox.connect('notify::selected', refresh);
    const settingsId = ctx.settings.raw.connect('changed::menu-button-icon', () => {
        current = showCurrent();
        markCurrent();
    });
    dialog.connect('closed', () => {
        cancelTimer();
        ctx.settings.raw.disconnect(settingsId);
    });

    const scroller = new Gtk.ScrolledWindow({vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER, child: grid});
    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    body.append(bar);
    body.append(currentBar);
    body.append(empty);
    body.append(scroller);
    toolbar.set_content(body);
    dialog.set_child(toolbar);
    // Start on the source that holds the current icon, so it is visible (and highlighted) straight away.
    sourceBox.set_selected(current === '' ? 0 : Math.max(0, SOURCES.indexOf(sourceOf(current))));
    refresh();
    dialog.present(ctx.window);
    return {dialog, search, sourceBox, styleBox, grid, model};
}

function chooseFile(ctx: PrefsContext): void {
    const filter = new Gtk.FileFilter({name: 'Images'});
    filter.add_pixbuf_formats();
    const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
    filters.append(filter);
    const chooser = new Gtk.FileDialog({title: 'Choose an icon file', filters, default_filter: filter});
    chooser.open(ctx.window, null, (_d: Gtk.FileDialog | null, res: Gio.AsyncResult) => {
        try {
            const file = chooser.open_finish(res);
            const path = file?.get_path();
            if (path)
                ctx.settings.set('menu-button-icon', path);
        } catch (e) {
            if (!(e instanceof GLib.Error) || !e.matches(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED))
                toast(ctx, `Could not use that file: ${(e as Error).message}`);
        }
    });
}

export function createIconRow(ctx: PrefsContext): Adw.ActionRow {
    const row = new Adw.ActionRow({title: 'Icon'});
    const preview = new Gtk.Box({valign: Gtk.Align.CENTER});
    const show = (): void => {
        const value = ctx.settings.get('menu-button-icon');
        let child = preview.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            preview.remove(child);
            child = next;
        }
        preview.append(iconImage(ctx, value, 28));
        row.set_subtitle(GLib.markup_escape_text(value.startsWith('/') ? value : value.replace(/\.svg$/, ''), -1));
    };
    show();
    watch(ctx, row, ['menu-button-icon'], show);

    const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
    choose.connect('clicked', () => {
        openIconPicker(ctx);
    });
    const custom = new Gtk.Button({
        icon_name: 'document-open-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Use your own image file',
        css_classes: ['flat'],
    });
    label(custom, 'Use your own image file');
    custom.connect('clicked', () => chooseFile(ctx));
    row.add_prefix(preview);
    row.add_suffix(choose);
    row.add_suffix(custom);
    return row;
}
