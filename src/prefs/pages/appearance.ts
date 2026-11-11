// Preferences page "Appearance": follow the shell theme or use custom colours (presets, colours and shape appear
// only while that is on; see prefs/presets.ts), the menu's size, and rows that open the Icons, Panel button
// colours and Advanced sub-pages.
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
import {
    colorRow,
    enumRow,
    group,
    type Option,
    optionalColorRow,
    optionalSpinRow,
    showSpecialValues,
    spinAdjustment,
    spinRow,
    subpageGroup,
    switchRow,
    watch,
} from '../widgets.js';

const ICON_STYLE: readonly Option[] = [['Symbolic', 'Symbolic'], ['Full_Color', 'Full colour']];

const GRID_PARTS = [
    ['size', 'Icon size'],
    ['width', 'Tile width'],
    ['height', 'Tile height'],
] as const;

/** `icon-size-grid` is an a{si} dictionary: one SpinRow per entry, written back as a whole. */
function gridRows(ctx: PrefsContext): Adw.SpinRow[] {
    return GRID_PARTS.map(([part, title]) => {
        const read = (): number => ctx.settings.get('icon-size-grid')[part] ?? -1;
        const row = new Adw.SpinRow({
            title,
            subtitle: 'In pixels',
            adjustment: spinAdjustment(read(), -1, 256),
        });
        showSpecialValues(row, [{value: -1, label: 'Default'}]);
        row.connect('notify::value', () => {
            const value = Math.round(row.value);
            if (value === read())
                return;
            ctx.settings.set('icon-size-grid', {...ctx.settings.get('icon-size-grid'), [part]: value});
        });
        watch(ctx, row, ['icon-size-grid'], () => {
            if (Math.round(row.value) !== read())
                row.set_value(read());
        });
        return row;
    });
}

function iconGroups(ctx: PrefsContext): Adw.PreferencesGroup[] {
    const hint = {subtitle: 'In pixels', special: [{value: -1, label: 'Default'}]};
    const hintHide = {subtitle: 'In pixels', special: [{value: -1, label: 'Default'}, {value: 0, label: 'Hidden'}]};
    const iconKeys: SettingKey[] = ['icon-size-apps', 'icon-size-shortcuts', 'icon-size-categories', 'icon-size-buttons', 'icon-size-misc'];
    const styleKeys: SettingKey[] = ['icon-style-categories', 'icon-style-shortcuts', 'icon-style-buttons'];
    return [
        group(ctx, 'Icon sizes', [
            spinRow(ctx, 'icon-size-apps', 'App list icons', -1, 64, hint),
            spinRow(ctx, 'icon-size-shortcuts', 'Shortcut icons', -1, 64, hintHide),
            spinRow(ctx, 'icon-size-categories', 'Category icons', -1, 64, hintHide),
            spinRow(ctx, 'icon-size-buttons', 'Power button icons', -1, 64, hint),
            spinRow(ctx, 'icon-size-misc', 'Search and Back / All Apps icons', -1, 64, hint),
        ], {reset: iconKeys}),
        group(ctx, 'Pinned tiles', gridRows(ctx), {reset: ['icon-size-grid'], description: 'Used when pinned apps are shown as a grid.'}),
        group(ctx, 'Icon style', [
            enumRow(ctx, 'icon-style-categories', 'Category icons', ICON_STYLE),
            enumRow(ctx, 'icon-style-shortcuts', 'Shortcut icons', ICON_STYLE),
            enumRow(ctx, 'icon-style-buttons', 'Power button icons', ICON_STYLE),
        ], {reset: styleKeys}),
    ];
}

function panelButtonColourGroups(ctx: PrefsContext): Adw.PreferencesGroup[] {
    const buttonKeys: SettingKey[] = [
        'menu-button-fg-color', 'menu-button-bg-color', 'menu-button-border-color', 'menu-button-hover-bg-color',
        'menu-button-hover-fg-color', 'menu-button-active-bg-color', 'menu-button-active-fg-color',
        'menu-button-border-radius', 'menu-button-border-width',
    ];
    return [group(ctx, 'Panel button', [
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
    })];
}

function advancedGroups(ctx: PrefsContext): Adw.PreferencesGroup[] {
    const overlay = switchRow(ctx, 'scrollbars-overlay', 'Overlay scrollbars', 'Drawn over the list instead of beside it');
    const sync = (): void => overlay.set_sensitive(ctx.settings.get('scrollbars-visible'));
    sync();
    watch(ctx, overlay, ['scrollbars-visible'], sync);
    return [
        group(ctx, 'Lists', [
            switchRow(ctx, 'scrollbars-visible', 'Show scrollbars'),
            overlay,
            switchRow(ctx, 'scrollview-fade-effect', 'Fade the edges of scrolled lists'),
            switchRow(ctx, 'vert-separator', 'Separator between the panes'),
        ], {reset: ['scrollbars-visible', 'scrollbars-overlay', 'scrollview-fade-effect', 'vert-separator']}),
        group(ctx, 'Fine-tuning', [
            spinRow(ctx, 'menu-width-adjustment', 'Extra width', -350, 800, {step: 5, subtitle: 'Added on top of the pane widths'}),
            optionalSpinRow(ctx, 'search-entry-border-radius', 'Search bar corner radius', 0, 25, 'Radius'),
        ], {reset: ['menu-width-adjustment', 'search-entry-border-radius']}),
    ];
}

export function createAppearancePage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'appearance',
        title: 'Appearance',
        icon_name: 'applications-graphics-symbolic',
    });

    const override = switchRow(
        ctx,
        'override-menu-theme',
        'Use custom colours',
        'Off: the menu follows the shell theme and the GNOME accent colour',
    );
    page.add(group(ctx, 'Theme', [override], {reset: ['override-menu-theme']}));

    // Presets, colours and shape apply only with custom colours on, so they appear only then.
    const presets = createPresetsGroup(ctx);
    page.add(presets);

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
    ], {reset: colourKeys});
    page.add(menu);

    const shape = group(ctx, 'Menu shape', [
        spinRow(ctx, 'menu-border-width', 'Border width', ...BORDER_WIDTH_RANGE),
        spinRow(ctx, 'menu-border-radius', 'Corner radius', ...BORDER_RADIUS_RANGE),
        spinRow(ctx, 'menu-font-size', 'Font size', ...FONT_SIZE_RANGE),
    ], {reset: ['menu-border-width', 'menu-border-radius', 'menu-font-size']});
    page.add(shape);

    for (const g of [presets, menu, shape])
        ctx.settings.raw.bind('override-menu-theme', g, 'visible', Gio.SettingsBindFlags.GET);

    const sizeKeys: SettingKey[] = ['menu-height', 'left-panel-width', 'right-panel-width', 'menu-arrow-rise'];
    page.add(group(ctx, 'Size', [
        spinRow(ctx, 'menu-height', 'Menu height', 360, 1600, {step: 10, subtitle: 'In pixels'}),
        spinRow(ctx, 'left-panel-width', 'Left pane width', 420, 1200, {step: 5, subtitle: 'Apps and search results'}),
        spinRow(ctx, 'right-panel-width', 'Right pane width', 180, 600, {step: 5, subtitle: 'Shortcuts and places'}),
        optionalSpinRow(ctx, 'menu-arrow-rise', 'Distance from the panel', 0, 50, 'Distance'),
    ], {reset: sizeKeys}));

    page.add(subpageGroup(ctx, 'More', [
        {
            title: 'Icons',
            subtitle: 'Sizes and styles of the icons in the menu',
            icon: 'image-x-generic-symbolic',
            build: () => iconGroups(ctx),
        },
        {
            title: 'Panel button colours',
            subtitle: 'Override the theme for the button in the panel',
            icon: 'applications-graphics-symbolic',
            build: () => panelButtonColourGroups(ctx),
        },
        {
            title: 'Advanced',
            subtitle: 'Scrollbars, separators, extra width and search bar corners',
            icon: 'preferences-other-symbolic',
            build: () => advancedGroups(ctx),
        },
    ]));
    return page;
}
