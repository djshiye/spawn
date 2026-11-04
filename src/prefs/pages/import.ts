// Preferences page "Import from ArcMenu": preview of what the migration will do, the Import
// button and the optional "Disable ArcMenu" action.
//
// Public API:
//   createImportPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import GioUnix from 'gi://GioUnix?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import type {SettingKey} from '../../core/settings.js';
import {
    applyMigration,
    describeValue,
    disableArcMenu,
    type MigrationPlan,
    planMigration,
    readArcMenuSnapshot,
} from '../../migrate/arcmenu.js';
import type {PrefsContext} from '../context.js';
import {toast} from '../widgets.js';

function spawnDefaults(ctx: PrefsContext): Partial<Record<SettingKey, unknown>> {
    const defaults: Record<string, unknown> = {};
    const schema = ctx.settings.raw.settings_schema;
    for (const key of schema?.list_keys() ?? [])
        defaults[key] = schema?.get_key(key).get_default_value().recursiveUnpack();
    return defaults;
}

function appTitle(id: string): string {
    return GioUnix.DesktopAppInfo.new(id)?.get_display_name() ?? id;
}

/** "menu-button-icon-size" -> "Menu button icon size" (fallback when a key has no schema summary). */
function prettyKey(key: string): string {
    const words = key.replace(/[-_]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Human title for one of OUR settings: the <summary> of its key in the compiled schema. */
function settingTitle(ctx: PrefsContext, key: string): string {
    try {
        const summary = ctx.settings.raw.settings_schema?.get_key(key).get_summary();
        if (summary)
            return summary;
    } catch {
        // key not in our schema (e.g. an ArcMenu key in the skipped list)
    }
    return prettyKey(key);
}

function plainRow(title: string, subtitle?: string, icon?: string, rawKey?: string): Adw.ActionRow {
    const row = new Adw.ActionRow({title: escape(title)});
    if (subtitle)
        row.set_subtitle(escape(subtitle));
    if (rawKey)
        row.set_tooltip_text(rawKey);
    if (icon)
        row.add_prefix(new Gtk.Image({icon_name: icon}));
    return row;
}

function escape(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tooltip text: our key, plus the ArcMenu key(s) it was derived from when they differ. */
function rowKey(item: {key: string; from: string}): string {
    return item.from === item.key ? item.key : `${item.key} (from ArcMenu: ${item.from})`;
}

export function createImportPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'import',
        title: 'Import from ArcMenu',
        icon_name: 'document-open-symbolic',
    });
    let groups: Adw.PreferencesGroup[] = [];
    let imported = false;

    const addGroup = (g: Adw.PreferencesGroup): void => {
        groups.push(g);
        page.add(g);
    };

    const disableGroup = (): Adw.PreferencesGroup => {
        const g = new Adw.PreferencesGroup({
            title: 'Switch off ArcMenu',
            description: 'Two menus at once is confusing. Disabling only turns the extension off; its settings stay untouched, and you can enable it again any time.',
        });
        const row = new Adw.ActionRow({title: 'Disable ArcMenu'});
        const button = new Gtk.Button({label: 'Disable', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        button.connect('clicked', () => {
            button.set_sensitive(false);
            void disableArcMenu().then(ok => {
                toast(ctx, ok ? 'ArcMenu has been disabled' : 'ArcMenu could not be disabled (is it installed and enabled?)');
                button.set_sensitive(!ok);
            });
        });
        row.add_suffix(button);
        g.add(row);
        return g;
    };

    const build = (): void => {
        for (const g of groups)
            page.remove(g);
        groups = [];

        const snapshot = readArcMenuSnapshot(ctx.extensionDir);
        const head = new Adw.PreferencesGroup({title: 'Import from ArcMenu'});
        const rescan = new Gtk.Button({label: 'Rescan', valign: Gtk.Align.CENTER, css_classes: ['flat']});
        rescan.connect('clicked', build);
        head.set_header_suffix(rescan);
        addGroup(head);

        if (!snapshot || Object.keys(snapshot.values).length === 0) {
            const status = new Adw.StatusPage({
                icon_name: 'emblem-important-symbolic',
                title: snapshot ? 'ArcMenu has no custom settings' : 'ArcMenu settings could not be read',
                description: snapshot ?
                    'ArcMenu is either not installed or still uses its defaults, so there is nothing to import.' :
                    'The bundled ArcMenu schema could not be loaded.',
            });
            status.add_css_class('compact');
            head.add(status);
            if (imported || ctx.settings.get('migration-done'))
                addGroup(disableGroup());
            return;
        }

        const defaults = spawnDefaults(ctx);
        const plan: MigrationPlan = planMigration(snapshot, defaults);
        const changed = plan.items.filter(i => i.differsFromDefault);
        const same = plan.items.filter(i => !i.differsFromDefault);

        head.set_description(
            `Found ${Object.keys(snapshot.values).length} customised ArcMenu settings. ` +
            'Nothing is changed until you press Import, and ArcMenu itself is never modified.',
        );
        const doImport = new Adw.ActionRow({
            title: imported ? 'Imported' : 'Import settings',
            subtitle: ctx.settings.get('migration-done') && !imported ?
                'You imported before; importing again replaces the listed settings, pinned apps and folders.' :
                `${plan.items.length} settings and ${plan.folders.length} folders`,
        });
        const importButton = new Gtk.Button({
            label: imported ? 'Import Again' : 'Import',
            valign: Gtk.Align.CENTER,
            css_classes: imported ? [] : ['suggested-action'],
        });
        importButton.connect('clicked', () => {
            try {
                applyMigration(plan, ctx.settings);
                imported = true;
                toast(ctx, `Imported ${plan.items.length} settings and ${plan.folders.length} folders`);
            } catch (e) {
                toast(ctx, `Import failed: ${(e as Error).message}`);
                return;
            }
            build();
        });
        doImport.add_suffix(importButton);
        head.add(doImport);

        if (imported || ctx.settings.get('migration-done'))
            addGroup(disableGroup());

        // Will import.
        const importGroup = new Adw.PreferencesGroup({
            title: 'Will import',
            description: 'Values that differ from Spawn\'s defaults.',
        });
        if (changed.length === 0) {
            importGroup.add(plainRow('Nothing differs from the defaults'));
        } else {
            for (const item of changed)
                importGroup.add(plainRow(settingTitle(ctx, item.key), describeValue(item.value, item.key), 'object-select-symbolic', rowKey(item)));
        }
        addGroup(importGroup);

        if (same.length > 0) {
            const expander = new Adw.ExpanderRow({title: `Same as the defaults (${same.length})`, subtitle: 'Imported as well; these already match the defaults'});
            for (const item of same)
                expander.add_row(plainRow(settingTitle(ctx, item.key), describeValue(item.value, item.key), undefined, rowKey(item)));
            const g = new Adw.PreferencesGroup();
            g.add(expander);
            addGroup(g);
        }

        // Folders.
        if (plan.folders.length > 0) {
            const g = new Adw.PreferencesGroup({title: 'Pinned folders', description: 'Folders keep their apps and ids.'});
            for (const folder of plan.folders) {
                const expander = new Adw.ExpanderRow({
                    title: escape(folder.name || 'Folder'),
                    subtitle: `${folder.pinnedApps.length} ${folder.pinnedApps.length === 1 ? 'app' : 'apps'}`,
                });
                expander.add_prefix(new Gtk.Image({icon_name: 'folder-symbolic'}));
                for (const app of folder.pinnedApps)
                    expander.add_row(plainRow(appTitle(app.id), app.id));
                g.add(expander);
            }
            addGroup(g);
        }

        // Skipped.
        if (plan.skipped.length > 0) {
            const g = new Adw.PreferencesGroup({title: 'Skipped', description: 'No equivalent in Spawn.'});
            for (const s of plan.skipped)
                g.add(plainRow(prettyKey(s.key), s.reason, 'action-unavailable-symbolic', s.key));
            addGroup(g);
        }

        // Warnings.
        if (plan.warnings.length > 0) {
            const g = new Adw.PreferencesGroup({title: 'Warnings'});
            for (const w of plan.warnings) {
                const row = plainRow(w, undefined, 'dialog-warning-symbolic');
                row.set_title_lines(0);
                g.add(row);
            }
            addGroup(g);
        }
    };
    build();
    return page;
}
