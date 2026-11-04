// Preferences page "About": version, licence, links and credits (incl. ArcMenu).
//
// Public API:
//   createAboutPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

import type {PrefsContext} from '../context.js';
import {group} from '../widgets.js';

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

export function createAboutPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'about',
        title: 'About',
        icon_name: 'help-about-symbolic',
    });

    const meta = ctx.metadata;
    const name = String(meta['name'] ?? 'Spawn Menu');
    const url = String(meta['url'] ?? 'https://github.com/djshiye/spawn-menu');
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

    page.add(group(ctx, 'Links', [
        linkRow(ctx, 'Source code', url),
        linkRow(ctx, 'Report an issue', `${url}/issues`),
    ]));

    page.add(group(ctx, 'Credits', [
        linkRow(
            ctx,
            'ArcMenu',
            'https://gitlab.com/arcmenu/ArcMenu',
            'Spawn Menu is a derivative work of ArcMenu (GPL-2.0-or-later) and keeps its layout, settings names and icon set. Thanks to the ArcMenu authors and contributors.',
        ),
        linkRow(ctx, 'Dash to Panel', 'https://github.com/home-sweet-gnome/dash-to-panel', 'Supported as a panel host'),
    ]));
    return page;
}
