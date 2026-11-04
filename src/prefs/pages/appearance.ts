// Preferences page "Appearance": follow the shell theme or use custom colours.
//
// Public API:
//   createAppearancePage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import type {SettingKey} from '../../core/settings.js';
import type {PrefsContext} from '../context.js';
import {colorRow, group, optionalColorRow, optionalSpinRow, spinRow, switchRow} from '../widgets.js';

export function createAppearancePage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'appearance',
        title: 'Appearance',
        icon_name: 'applications-graphics-symbolic',
    });

    const override = switchRow(
        ctx,
        'override-menu-theme',
        'Use custom menu colours',
        'Off: the menu follows the shell theme and the GNOME accent colour',
    );
    page.add(group(ctx, 'Theme', [override], {reset: ['override-menu-theme']}));

    const colourKeys: SettingKey[] = [
        'menu-background-color', 'menu-foreground-color', 'menu-border-color', 'menu-separator-color',
        'menu-item-hover-bg-color', 'menu-item-hover-fg-color', 'menu-item-active-bg-color', 'menu-item-active-fg-color',
    ];
    const menu = group(ctx, 'Menu colours', [
        colorRow(ctx, 'menu-background-color', 'Background'),
        colorRow(ctx, 'menu-foreground-color', 'Text'),
        colorRow(ctx, 'menu-border-color', 'Border'),
        colorRow(ctx, 'menu-separator-color', 'Separators'),
        colorRow(ctx, 'menu-item-hover-bg-color', 'Item hover background'),
        colorRow(ctx, 'menu-item-hover-fg-color', 'Item hover text'),
        colorRow(ctx, 'menu-item-active-bg-color', 'Item pressed background'),
        colorRow(ctx, 'menu-item-active-fg-color', 'Item pressed text'),
    ], {reset: colourKeys, description: 'Applied only while custom colours are enabled.'});
    page.add(menu);

    const shape = group(ctx, 'Menu shape', [
        spinRow(ctx, 'menu-border-width', 'Border width', 0, 5),
        spinRow(ctx, 'menu-border-radius', 'Corner radius', 0, 25),
        spinRow(ctx, 'menu-font-size', 'Font size', 8, 18),
    ], {reset: ['menu-border-width', 'menu-border-radius', 'menu-font-size']});
    page.add(shape);

    // Colours and shape only make sense with the override on.
    ctx.settings.raw.bind('override-menu-theme', menu, 'sensitive', Gio.SettingsBindFlags.GET);
    ctx.settings.raw.bind('override-menu-theme', shape, 'sensitive', Gio.SettingsBindFlags.GET);

    const buttonKeys: SettingKey[] = [
        'menu-button-fg-color', 'menu-button-bg-color', 'menu-button-border-color', 'menu-button-hover-bg-color',
        'menu-button-hover-fg-color', 'menu-button-active-bg-color', 'menu-button-active-fg-color',
        'menu-button-border-radius', 'menu-button-border-width',
    ];
    page.add(group(ctx, 'Panel button', [
        optionalColorRow(ctx, 'menu-button-fg-color', 'Icon and text colour'),
        optionalColorRow(ctx, 'menu-button-bg-color', 'Background'),
        optionalColorRow(ctx, 'menu-button-hover-fg-color', 'Hover text'),
        optionalColorRow(ctx, 'menu-button-hover-bg-color', 'Hover background'),
        optionalColorRow(ctx, 'menu-button-active-fg-color', 'Pressed text'),
        optionalColorRow(ctx, 'menu-button-active-bg-color', 'Pressed background'),
        optionalColorRow(ctx, 'menu-button-border-color', 'Border colour'),
        optionalSpinRow(ctx, 'menu-button-border-width', 'Border width', 0, 5),
        optionalSpinRow(ctx, 'menu-button-border-radius', 'Corner radius', 0, 25),
    ], {
        reset: buttonKeys,
        description: 'Each override is used only while its switch is on. Results may vary with third-party themes.',
    }));
    return page;
}
