// Preferences page "Menu": what the menu opens on, search, what it shows, and rows that open the Quick links,
// Hidden apps and Search sources sub-pages. Sizes, icons and scrollbars live on the Appearance page.
//
// Public API:
//   createMenuPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';

import {CategoryLink} from '../../core/constants.js';
import type {SettingKey} from '../../core/settings.js';
import {hiddenAppsGroup} from '../hiddenApps.js';
import type {PrefsContext} from '../context.js';
import {toggleListGroup} from '../toggleList.js';
import {enumRow, group, spinRow, subpageGroup, subpageRow, switchRow, watch} from '../widgets.js';

const LINKS: ReadonlyArray<readonly [number, string, string]> = [
    [CategoryLink.FAVORITES, 'Favourites', 'emote-love-symbolic'],
    [CategoryLink.FREQUENT, 'Frequent Apps', 'user-bookmarks-symbolic'],
    [CategoryLink.ALL_PROGRAMS, 'All Apps', 'view-app-grid-symbolic'],
    [CategoryLink.PINNED, 'Pinned Apps', 'view-pin-symbolic'],
    [CategoryLink.RECENT_FILES, 'Recent Files', 'document-open-recent-symbolic'],
];

/**
 * One switch for the two description keys (app lists and search results used to be separate switches that
 * read like duplicates). On when either is on, which is also what the menu shows (ui/util.ts showDescriptions);
 * flipping it writes both.
 */
function descriptionsRow(ctx: PrefsContext): Adw.SwitchRow {
    const keys = ['apps-show-extra-details', 'show-search-result-details'] as const;
    const read = (): boolean => keys.some(k => ctx.settings.get(k));
    const row = new Adw.SwitchRow({title: 'Show descriptions', subtitle: 'A dimmed line below app names and search results', active: read()});
    let writing = false; // the first write must not flip the switch back before the second one lands
    row.connect('notify::active', () => {
        writing = true;
        for (const k of keys) {
            if (ctx.settings.get(k) !== row.active)
                ctx.settings.set(k, row.active);
        }
        writing = false;
    });
    watch(ctx, row, [...keys], () => {
        if (!writing && row.active !== read())
            row.set_active(read());
    });
    return row;
}

/** "None" / "3 apps", for the Hidden apps row. */
function hiddenSummary(ctx: PrefsContext): string {
    const n = ctx.settings.get('hidden-apps').length;
    return n === 0 ? 'None. Right-click an app in the menu to hide it' : `${n} ${n === 1 ? 'app' : 'apps'} hidden`;
}

/** "Off" / "Favourites, All Apps", for the Quick links row. */
function quickLinksSummary(ctx: PrefsContext): string {
    const on = ctx.settings.get('arcmenu-extra-categories-links')
        .filter(([, enabled]) => enabled)
        .map(([id]) => LINKS.find(([linkId]) => linkId === id)?.[1])
        .filter((name): name is string => name !== undefined);
    return on.length === 0 ? 'Off' : on.join(', ');
}

function searchSourceGroups(ctx: PrefsContext): Adw.PreferencesGroup[] {
    const providerKeys: SettingKey[] = [
        'search-provider-open-windows', 'search-provider-recent-files', 'search-provider-shell', 'show-hidden-recent-files',
        'search-calculator', 'search-unit-conversion', 'search-settings-panels', 'search-app-actions', 'max-search-results',
    ];
    const hiddenRecent = switchRow(ctx, 'show-hidden-recent-files', 'Include hidden recent files');
    const syncHiddenRecent = (): void => hiddenRecent.set_visible(ctx.settings.get('search-provider-recent-files'));
    syncHiddenRecent();
    watch(ctx, hiddenRecent, ['search-provider-recent-files'], syncHiddenRecent);
    return [group(ctx, 'Search sources', [
        switchRow(ctx, 'search-provider-open-windows', 'Open windows'),
        switchRow(ctx, 'search-provider-recent-files', 'Recent files'),
        hiddenRecent,
        switchRow(ctx, 'search-provider-shell', 'GNOME Shell search providers', 'Results from Calculator, Settings, Characters and other providers'),
        switchRow(ctx, 'search-calculator', 'Calculator', 'Type a sum such as 2+2 or 15% of 80; Return copies the answer'),
        switchRow(ctx, 'search-unit-conversion', 'Unit conversion', 'Type 5 km in miles or 100 f in c; Return copies the answer'),
        switchRow(ctx, 'search-settings-panels', 'Settings panels', 'Find Wi-Fi, Bluetooth, Display and other panels of GNOME Settings'),
        switchRow(ctx, 'search-app-actions', 'App actions', 'For example “firefox private” for New Private Window'),
        spinRow(ctx, 'max-search-results', 'Results per source', 1, 20),
    ], {reset: providerKeys, description: 'Apps are always searched. Choose what else shows up.'})];
}

function quickLinkGroups(ctx: PrefsContext): Adw.PreferencesGroup[] {
    return [toggleListGroup(ctx, {
        key: 'arcmenu-extra-categories-links',
        title: 'Quick links',
        description: 'Shortcuts to other views on the start view. The link of the start view itself is never shown, and the category list has none.',
        items: LINKS,
        fallbackIcon: 'view-more-symbolic',
        resetKeys: ['arcmenu-extra-categories-links', 'arcmenu-extra-categories-links-location'],
        resetMessage: 'Quick links reset to defaults',
        extraRows: [
            enumRow(ctx, 'arcmenu-extra-categories-links-location', 'Position', [
                ['Bottom', 'Below the list'],
                ['Top', 'Above the list'],
            ]),
        ],
    })];
}

export function createMenuPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'menu',
        title: 'Menu',
        icon_name: 'view-list-symbolic',
    });

    const viewKeys: SettingKey[] = ['default-menu-view', 'pinned-apps-display', 'pinned-item-size', 'all-apps-button-action', 'max-frequent-apps'];
    const frequent = spinRow(ctx, 'max-frequent-apps', 'Frequent apps to show', 1, 50);
    // Only matters where frequent apps appear: the start view, the runner or a Frequent quick link.
    const syncFrequent = (): void => {
        const view = ctx.settings.get('default-menu-view');
        frequent.set_visible(view === 'Frequent_Apps' || view === 'Pinned_And_Frequent_Apps' ||
            ctx.settings.get('runner-default-view') === 'Frequent_Apps' ||
            ctx.settings.get('arcmenu-extra-categories-links').some(([id, on]) => on && id === CategoryLink.FREQUENT));
    };
    syncFrequent();
    watch(ctx, frequent, ['default-menu-view', 'runner-default-view', 'arcmenu-extra-categories-links'], syncFrequent);
    page.add(group(ctx, 'Start view', [
        enumRow(ctx, 'default-menu-view', 'Opens on', [
            ['Pinned_Apps', 'Pinned apps'],
            ['Categories_List', 'Categories'],
            ['Frequent_Apps', 'Frequent apps'],
            ['All_Programs', 'All apps'],
            ['Pinned_And_Frequent_Apps', 'Pinned and frequent apps'],
        ]),
        enumRow(ctx, 'pinned-apps-display', 'Pinned apps as', [
            ['List', 'List'],
            ['Grid', 'Grid'],
        ]),
        enumRow(ctx, 'pinned-item-size', 'Pinned item size', [
            ['Compact', 'Compact'],
            ['Comfortable', 'Comfortable'],
            ['Large', 'Large'],
        ], 'Bigger rows and tiles are easier to click'),
        enumRow(ctx, 'all-apps-button-action', '“All Apps” button shows', [
            ['Categories_List', 'Categories'],
            ['All_Programs', 'All apps in one list'],
        ]),
        frequent,
    ], {reset: viewKeys}));

    const searchKeys: SettingKey[] = ['search-entry-location', 'search-hidden', 'highlight-search-result-terms'];
    page.add(group(ctx, 'Search', [
        enumRow(ctx, 'search-entry-location', 'Search bar position', [
            ['Bottom', 'Bottom'],
            ['Top', 'Top'],
            ['Auto', 'Automatic'],
        ], 'Automatic puts it nearest the panel the menu opens from'),
        switchRow(ctx, 'search-hidden', 'Hide the search bar', 'It appears as soon as you start typing'),
        switchRow(ctx, 'highlight-search-result-terms', 'Highlight matching text'),
        subpageRow(ctx, {
            title: 'Search sources',
            subtitle: 'Calculator, unit conversion, settings panels, open windows, files and more',
            build: () => searchSourceGroups(ctx),
        }),
    ], {reset: searchKeys}));

    const displayKeys: SettingKey[] = [
        'show-user-avatar', 'avatar-style', 'multi-lined-labels', 'show-new-apps-badge',
        'apps-show-extra-details', 'show-search-result-details', 'apps-show-generic-names',
    ];
    const avatarShape = enumRow(ctx, 'avatar-style', 'Picture shape', [['Round', 'Round'], ['Square', 'Square']]);
    const syncAvatar = (): void => avatarShape.set_visible(ctx.settings.get('show-user-avatar'));
    syncAvatar();
    watch(ctx, avatarShape, ['show-user-avatar'], syncAvatar);
    page.add(group(ctx, 'Show in the menu', [
        switchRow(ctx, 'show-user-avatar', 'Your picture', 'At the top of the right pane'),
        avatarShape,
        descriptionsRow(ctx),
        switchRow(ctx, 'multi-lined-labels', 'Wrap long app names'),
        switchRow(ctx, 'apps-show-generic-names', 'Use generic app names', 'For example “Web Browser” instead of “Firefox”'),
        switchRow(ctx, 'show-new-apps-badge', 'Mark new apps', 'A “New” badge on apps installed in the last three days, until you open them'),
    ], {reset: displayKeys}));

    page.add(subpageGroup(ctx, 'More', [
        {
            title: 'Quick links',
            subtitle: () => quickLinksSummary(ctx),
            keys: ['arcmenu-extra-categories-links'],
            icon: 'view-more-symbolic',
            build: () => quickLinkGroups(ctx),
        },
        {
            title: 'Hidden apps',
            subtitle: () => hiddenSummary(ctx),
            keys: ['hidden-apps'],
            icon: 'view-conceal-symbolic',
            build: () => [hiddenAppsGroup(ctx)],
        },
    ]));
    return page;
}
