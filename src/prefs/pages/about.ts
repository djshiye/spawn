// Preferences page "About": version, licence, links and credits (incl. ArcMenu).
//
// Public API:
//   createAboutPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

import type {PrefsContext} from '../context.js';
import {group, watch} from '../widgets.js';

function linkRow(ctx: PrefsContext, title: string, url: string, subtitle?: string): Adw.ActionRow {
    const row = new Adw.ActionRow({title, activatable: true});
    row.set_subtitle(subtitle ?? url);
    row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    row.connect('activated', () => {
        new Gtk.UriLauncher({uri: url}).launch(ctx.window, null, null);
    });
    return row;
}

function infoRow(title: string, value: string): Adw.ActionRow {
    const row = new Adw.ActionRow({title});
    const label = new Gtk.Label({label: value, css_classes: ['dim-label'], selectable: true, valign: Gtk.Align.CENTER});
    row.add_suffix(label);
    return row;
}

type Shortcut = readonly [title: string, accelerator: string, subtitle?: string];

/** Row with the title on the left and keycap-style shortcut labels (Gtk.ShortcutLabel) on the right. */
function shortcutRow([title, accelerator, subtitle]: Shortcut): Adw.ActionRow {
    const row = new Adw.ActionRow({title});
    if (subtitle)
        row.set_subtitle(subtitle);
    row.add_suffix(new Gtk.ShortcutLabel({accelerator, valign: Gtk.Align.CENTER}));
    return row;
}

/** The keys the menu answers to while it is open. The first row follows the `spawn-hotkey` setting. */
export function createShortcutsGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const open = new Adw.ActionRow({title: 'Open or close the menu'});
    let openKeys: Gtk.ShortcutLabel | null = null;
    const showOpen = (): void => {
        const custom = (ctx.settings.get('spawn-hotkey') as string[]).filter(k => k.trim() !== '');
        if (openKeys)
            open.remove(openKeys);
        openKeys = new Gtk.ShortcutLabel({accelerator: custom.length > 0 ? custom.join(' ') : 'Super_L', valign: Gtk.Align.CENTER});
        open.add_suffix(openKeys);
        open.set_subtitle(custom.length > 0 ? 'Your own shortcut, set under General' : 'Tap the Super key');
    };
    showOpen();

    const search = new Adw.ActionRow({title: 'Search', subtitle: 'Just start typing'});
    search.add_suffix(new Gtk.Label({label: 'Any letter', css_classes: ['dim-label'], valign: Gtk.Align.CENTER}));

    const g = group(ctx, 'Keyboard shortcuts', [
        open,
        search,
        ...([
            ['Move between items', 'Up Down Left Right'],
            ['Open the selected item', 'Return'],
            ['Open and keep the menu open', '<Control>Return', 'Ctrl+click on an item does the same'],
            ['Open an item\u2019s menu', 'Menu <Shift>F10'],
            ['Reorder pinned apps', '<Control>Up <Control>Down'],
            ['Rename a folder', 'F2'],
            ['Unpin an app', 'Delete'],
            ['Undo', '<Control>z'],
            ['Jump to the first or last item', 'Home End'],
            ['Jump a page at a time', 'Prior Next'],
            ['Step back, then close the menu', 'Escape'],
        ] as readonly Shortcut[]).map(shortcutRow),
    ], {description: 'These work while the menu is open.'});
    watch(ctx, g, ['spawn-hotkey'], showOpen);
    return g;
}

export function createAboutPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'about',
        title: 'About',
        icon_name: 'help-about-symbolic',
    });

    const meta = ctx.metadata;
    const name = String(meta['name'] ?? 'Spawn');
    const url = String(meta['url'] ?? 'https://github.com/djshiye/spawn').replace(/\/+$/, '');
    const version = String(meta['version-name'] ?? meta['version'] ?? '');

    const head = new Adw.PreferencesGroup();
    const title = new Gtk.Label({label: name, css_classes: ['title-1'], margin_top: 12});
    const tagline = new Gtk.Label({
        label: 'A fast, resilient application menu for GNOME Shell',
        css_classes: ['dim-label'],
        wrap: true,
        justify: Gtk.Justification.CENTER,
        margin_bottom: 6,
    });
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
    box.append(new Gtk.Image({icon_name: 'view-app-grid-symbolic', pixel_size: 64, margin_top: 12}));
    box.append(title);
    box.append(tagline);
    head.add(box);
    page.add(head);

    page.add(group(ctx, 'Details', [
        infoRow('Version', version),
        infoRow('Licence', 'GPL-2.0-or-later'),
        infoRow('Extension UUID', String(meta['uuid'] ?? '')),
    ]));

    page.add(createShortcutsGroup(ctx));

    page.add(group(ctx, 'Links', [
        linkRow(ctx, 'Source code', url),
        linkRow(ctx, 'Report an issue', `${url}/issues`),
    ]));

    page.add(group(ctx, 'Credits', [
        linkRow(
            ctx,
            'ArcMenu',
            'https://gitlab.com/arcmenu/ArcMenu',
            'Spawn is a derivative work of ArcMenu (GPL-2.0-or-later) and keeps its layout, settings names and icon set. Thanks to the ArcMenu authors and contributors.',
        ),
        linkRow(ctx, 'Dash to Panel', 'https://github.com/home-sweet-gnome/dash-to-panel', 'Supported as a panel host'),
    ]));
    return page;
}
