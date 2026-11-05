// Preferences page "Menu": views, sizes, search, display options and icon sizes.
//
// Public API:
//   createMenuPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';

import type {SettingKey} from '../../core/settings.js';
import type {PrefsContext} from '../context.js';
import {
    enumRow,
    group,
    type Option,
    optionalSpinRow,
    spinAdjustment,
    spinRow,
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
            subtitle: '-1 uses the default',
            adjustment: spinAdjustment(read(), -1, 256),
        });
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

export function createMenuPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'menu',
        title: 'Menu',
        icon_name: 'view-list-symbolic',
    });

    const viewKeys: SettingKey[] = ['default-menu-view', 'pinned-apps-display', 'pinned-item-size', 'all-apps-button-action', 'max-frequent-apps'];
    page.add(group(ctx, 'Start view', [
        enumRow(ctx, 'default-menu-view', 'Default view', [
            ['Pinned_Apps', 'Pinned apps'],
            ['Categories_List', 'Categories'],
            ['Frequent_Apps', 'Frequent apps'],
            ['All_Programs', 'All apps'],
            ['Pinned_And_Frequent_Apps', 'Pinned and frequent apps'],
        ]),
        enumRow(ctx, 'pinned-apps-display', 'Pinned apps view', [
            ['List', 'List'],
            ['Grid', 'Grid'],
        ], 'Pinned apps and folders as rows (like ArcMenu) or as an icon grid'),
        enumRow(ctx, 'pinned-item-size', 'Pinned item size', [
            ['Compact', 'Compact'],
            ['Comfortable', 'Comfortable'],
            ['Large', 'Large'],
        ], 'Bigger rows and tiles are easier to hit; the space between items is always clickable'),
        enumRow(ctx, 'all-apps-button-action', '"All Apps" button shows', [
            ['Categories_List', 'Categories'],
            ['All_Programs', 'All apps in one list'],
        ]),
        spinRow(ctx, 'max-frequent-apps', 'Frequent apps to show', 1, 50),
    ], {reset: viewKeys}));

    const sizeKeys: SettingKey[] = ['menu-height', 'left-panel-width', 'right-panel-width', 'menu-width-adjustment'];
    page.add(group(ctx, 'Size', [
        spinRow(ctx, 'menu-height', 'Menu height', 360, 1600, {step: 10}),
        spinRow(ctx, 'left-panel-width', 'Left pane width', 420, 1200, {step: 5}),
        spinRow(ctx, 'right-panel-width', 'Right pane width', 180, 600, {step: 5}),
        spinRow(ctx, 'menu-width-adjustment', 'Extra width', -350, 800, {
            step: 5,
            subtitle: 'Added on top of the pane widths',
        }),
    ], {reset: sizeKeys}));

    const searchKeys: SettingKey[] = [
        'search-hidden', 'search-entry-location', 'max-search-results', 'highlight-search-result-terms',
        'show-search-result-details', 'search-entry-border-radius',
    ];
    page.add(group(ctx, 'Search', [
        switchRow(ctx, 'search-hidden', 'Hide the search bar', 'It appears as soon as you start typing'),
        enumRow(ctx, 'search-entry-location', 'Search bar position', [
            ['Bottom', 'Bottom'],
            ['Top', 'Top'],
            ['Auto', 'Automatic'],
        ], 'Automatic puts it nearest the panel the menu opens from'),
        spinRow(ctx, 'max-search-results', 'Results per source', 1, 20),
        switchRow(ctx, 'highlight-search-result-terms', 'Highlight matching text'),
        switchRow(ctx, 'show-search-result-details', 'Show result descriptions'),
        optionalSpinRow(ctx, 'search-entry-border-radius', 'Custom search bar corner radius', 0, 25),
    ], {reset: searchKeys}));

    const providerKeys: SettingKey[] = [
        'search-provider-open-windows', 'search-provider-recent-files', 'search-provider-shell', 'show-hidden-recent-files',
        'apps-show-extra-details', 'apps-show-generic-names',
    ];
    page.add(group(ctx, 'Search sources', [
        switchRow(ctx, 'search-provider-open-windows', 'Open windows'),
        switchRow(ctx, 'search-provider-recent-files', 'Recent files'),
        switchRow(ctx, 'show-hidden-recent-files', 'Include hidden recent files'),
        switchRow(ctx, 'search-provider-shell', 'GNOME Shell search providers', 'Results from Calculator, Settings, Characters and other providers'),
        switchRow(ctx, 'apps-show-extra-details', 'Show app descriptions'),
        switchRow(ctx, 'apps-show-generic-names', 'Show generic app names', 'For example "Web Browser" below Firefox'),
    ], {reset: providerKeys}));

    const displayKeys: SettingKey[] = [
        'show-user-avatar', 'avatar-style', 'vert-separator', 'multi-lined-labels', 'scrollbars-visible',
        'scrollbars-overlay', 'scrollview-fade-effect',
    ];
    page.add(group(ctx, 'Display', [
        switchRow(ctx, 'show-user-avatar', 'Show user avatar'),
        enumRow(ctx, 'avatar-style', 'Avatar shape', [['Round', 'Round'], ['Square', 'Square']]),
        switchRow(ctx, 'vert-separator', 'Separator between the panes'),
        switchRow(ctx, 'multi-lined-labels', 'Wrap long app names'),
        switchRow(ctx, 'scrollbars-visible', 'Show scrollbars'),
        switchRow(ctx, 'scrollbars-overlay', 'Overlay scrollbars'),
        switchRow(ctx, 'scrollview-fade-effect', 'Fade the edges of scrolled lists'),
    ], {reset: displayKeys}));

    const iconKeys: SettingKey[] = [
        'icon-size-apps', 'icon-size-shortcuts', 'icon-size-categories', 'icon-size-buttons', 'icon-size-misc',
        'icon-size-grid',
    ];
    const hint = '-1 uses the default, 0 hides the icons';
    page.add(group(ctx, 'Icon sizes', [
        spinRow(ctx, 'icon-size-apps', 'App list icons', -1, 64, {subtitle: hint}),
        spinRow(ctx, 'icon-size-shortcuts', 'Shortcut icons', -1, 64, {subtitle: hint}),
        spinRow(ctx, 'icon-size-categories', 'Category icons', -1, 64, {subtitle: hint}),
        spinRow(ctx, 'icon-size-buttons', 'Power button icons', -1, 64, {subtitle: hint}),
        spinRow(ctx, 'icon-size-misc', 'Other icons', -1, 64, {subtitle: hint}),
        ...gridRows(ctx),
    ], {reset: iconKeys, description: 'Pinned app tiles use the last three values.'}));

    const styleKeys: SettingKey[] = ['icon-style-categories', 'icon-style-shortcuts', 'icon-style-buttons'];
    page.add(group(ctx, 'Icon style', [
        enumRow(ctx, 'icon-style-categories', 'Category icons', ICON_STYLE),
        enumRow(ctx, 'icon-style-shortcuts', 'Shortcut icons', ICON_STYLE),
        enumRow(ctx, 'icon-style-buttons', 'Power button icons', ICON_STYLE),
    ], {reset: styleKeys}));
    return page;
}
