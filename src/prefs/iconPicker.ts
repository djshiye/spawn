// Icon picker for the panel button: a grid of the bundled icons (data/icons) plus a file chooser.
//
// Public API:
//   iconImage(ctx, value, size): Gtk.Image      renders a `menu-button-icon` value
//   openIconPicker(ctx)              opens the icon grid dialog
//   createIconRow(ctx): Adw.ActionRow            current icon + "Choose" button, bound to menu-button-icon

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {resolveButtonIcon} from '../core/icons.js';
import type {PrefsContext} from './context.js';
import {toast, watch} from './widgets.js';

type Filter = 'all' | 'symbolic' | 'colour';

export function iconImage(ctx: PrefsContext, value: string, size: number): Gtk.Image {
    const resolved = resolveButtonIcon(value, `${ctx.extensionDir}/data/icons`);
    const image = new Gtk.Image({pixel_size: size});
    if (resolved.kind === 'file')
        image.set_from_gicon(Gio.FileIcon.new(Gio.File.new_for_path(resolved.path)));
    else
        image.set_from_icon_name(resolved.name);
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
        console.error(`[spawn-menu] cannot list bundled icons: ${e}`);
    }
    return names.sort((a, b) => a.localeCompare(b));
}

export function openIconPicker(ctx: PrefsContext): void {
    const dialog = new Adw.Dialog({title: 'Choose Icon', content_width: 560, content_height: 560});
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());

    const search = new Gtk.SearchEntry({placeholder_text: 'Search icons', margin_start: 12, margin_end: 12, margin_top: 6, margin_bottom: 6});
    const filterModel = Gtk.StringList.new(['All icons', 'Symbolic', 'Full colour']);
    const filterBox = new Gtk.DropDown({model: filterModel, valign: Gtk.Align.CENTER});
    const bar = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, margin_start: 12, margin_end: 12, margin_top: 6});
    search.set_hexpand(true);
    search.set_margin_start(0);
    search.set_margin_end(0);
    bar.append(search);
    bar.append(filterBox);

    const flow = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        homogeneous: true,
        max_children_per_line: 9,
        min_children_per_line: 4,
        column_spacing: 6,
        row_spacing: 6,
        margin_start: 12,
        margin_end: 12,
        margin_top: 12,
        margin_bottom: 12,
    });
    const current = ctx.settings.get('menu-button-icon');
    const entries = bundledIcons(ctx).map(file => {
        const button = new Gtk.Button({
            tooltip_text: file.replace(/\.svg$/, ''),
            css_classes: file === current ? ['suggested-action'] : ['flat'],
            child: iconImage(ctx, file, 32),
        });
        button.set_size_request(52, 52);
        button.connect('clicked', () => {
            ctx.settings.set('menu-button-icon', file);
            dialog.close();
        });
        flow.append(button);
        return {file, child: flow.get_last_child() as Gtk.FlowBoxChild};
    });

    const matches = (file: string): boolean => {
        const filter: Filter = (['all', 'symbolic', 'colour'] as const)[filterBox.selected] ?? 'all';
        const symbolic = file.includes('-symbolic');
        if (filter === 'symbolic' && !symbolic)
            return false;
        if (filter === 'colour' && symbolic)
            return false;
        const q = search.text.trim().toLowerCase();
        return q === '' || file.toLowerCase().includes(q);
    };
    flow.set_filter_func(child => {
        const entry = entries.find(e => e.child === child);
        return entry ? matches(entry.file) : true;
    });
    search.connect('search-changed', () => flow.invalidate_filter());
    filterBox.connect('notify::selected', () => flow.invalidate_filter());

    const scroller = new Gtk.ScrolledWindow({vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER, child: flow});
    const body = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    body.append(bar);
    body.append(scroller);
    toolbar.set_content(body);
    dialog.set_child(toolbar);
    dialog.present(ctx.window);
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
        row.set_subtitle(value.startsWith('/') ? value : value.replace(/\.svg$/, ''));
    };
    show();
    watch(ctx, row, ['menu-button-icon'], show);

    const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
    choose.connect('clicked', () => openIconPicker(ctx));
    const custom = new Gtk.Button({
        icon_name: 'document-open-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Use your own image file',
        css_classes: ['flat'],
    });
    custom.connect('clicked', () => chooseFile(ctx));
    row.add_prefix(preview);
    row.add_suffix(choose);
    row.add_suffix(custom);
    return row;
}
