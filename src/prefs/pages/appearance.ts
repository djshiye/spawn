// Preferences page "Appearance": follow the shell theme or use custom colours (with presets, see
// prefs/presets.ts), the menu's distance from the panel, and the panel button's colours.
//
// Public API:
//   createAppearancePage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import type {SettingKey} from '../../core/settings.js';
import type {PrefsContext} from '../context.js';
import {createPresetsGroup} from '../presets.js';
import {BORDER_RADIUS_RANGE, BORDER_WIDTH_RANGE, FONT_SIZE_RANGE} from '../../theme/presets.js';
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
    page.add(createPresetsGroup(ctx));

    const colourKeys: SettingKey[] = [
        'menu-background-color', 'menu-foreground-color', 'menu-border-color', 'menu-separator-color',
        'menu-item-hover-bg-color', 'menu-item-hover-fg-color', 'menu-item-active-bg-color', 'menu-item-active-fg-color',
    ];
    const menu = group(ctx, 'Menu colours', [
        colorRow(ctx, 'menu-background-color', 'Background', undefined, 'Menu'),
        colorRow(ctx, 'menu-foreground-color', 'Text', undefined, 'Menu'),
        colorRow(ctx, 'menu-border-color', 'Border', undefined, 'Menu'),
        colorRow(ctx, 'menu-separator-color', 'Separators', undefined, 'Menu'),
        colorRow(ctx, 'menu-item-hover-bg-color', 'Item hover background', undefined, 'Menu'),
        colorRow(ctx, 'menu-item-hover-fg-color', 'Item hover text', undefined, 'Menu'),
        colorRow(ctx, 'menu-item-active-bg-color', 'Item pressed background', undefined, 'Menu'),
        colorRow(ctx, 'menu-item-active-fg-color', 'Item pressed text', undefined, 'Menu'),
    ], {reset: colourKeys, description: 'Applied only while custom colours are enabled.'});
    page.add(menu);

    const shape = group(ctx, 'Menu shape', [
        spinRow(ctx, 'menu-border-width', 'Border width', ...BORDER_WIDTH_RANGE),
        spinRow(ctx, 'menu-border-radius', 'Corner radius', ...BORDER_RADIUS_RANGE),
        spinRow(ctx, 'menu-font-size', 'Font size', ...FONT_SIZE_RANGE),
    ], {reset: ['menu-border-width', 'menu-border-radius', 'menu-font-size']});
    page.add(shape);

    // Colours and shape only make sense with the override on.
    ctx.settings.raw.bind('override-menu-theme', menu, 'sensitive', Gio.SettingsBindFlags.GET);
    ctx.settings.raw.bind('override-menu-theme', shape, 'sensitive', Gio.SettingsBindFlags.GET);

    // Independent of the custom colours: moves the popup away from (or towards) the panel.
    page.add(group(ctx, 'Menu placement', [
        optionalSpinRow(ctx, 'menu-arrow-rise', 'Distance from the panel', 0, 50, 'Distance'),
    ], {
        reset: ['menu-arrow-rise'],
        description: 'The space between the panel and the menu.',
    }));

    const buttonKeys: SettingKey[] = [
        'menu-button-fg-color', 'menu-button-bg-color', 'menu-button-border-color', 'menu-button-hover-bg-color',
        'menu-button-hover-fg-color', 'menu-button-active-bg-color', 'menu-button-active-fg-color',
        'menu-button-border-radius', 'menu-button-border-width',
    ];
    page.add(group(ctx, 'Panel button', [
        optionalColorRow(ctx, 'menu-button-fg-color', 'Icon and text colour', 'Panel button'),
        optionalColorRow(ctx, 'menu-button-bg-color', 'Background', 'Panel button'),
        optionalColorRow(ctx, 'menu-button-hover-fg-color', 'Hover text', 'Panel button'),
        optionalColorRow(ctx, 'menu-button-hover-bg-color', 'Hover background', 'Panel button'),
        optionalColorRow(ctx, 'menu-button-active-fg-color', 'Pressed text', 'Panel button'),
        optionalColorRow(ctx, 'menu-button-active-bg-color', 'Pressed background', 'Panel button'),
        optionalColorRow(ctx, 'menu-button-border-color', 'Border colour', 'Panel button'),
        optionalSpinRow(ctx, 'menu-button-border-width', 'Border width', 0, 5, 'Width'),
        optionalSpinRow(ctx, 'menu-button-border-radius', 'Corner radius', 0, 25, 'Radius'),
    ], {
        reset: buttonKeys,
        description: 'Turn on an item to override the theme. Results may vary with third-party themes.',
    }));
    return page;
}
