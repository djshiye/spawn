// Preferences page "Import from ArcMenu": ArcMenu status (installed / enabled / release), preview of
// what the migration will do, the Import buttons (also "Import and disable ArcMenu") with an Undo
// toast, and the optional "Disable ArcMenu" action.
//
// Public API:
//   createImportPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import GioUnix from 'gi://GioUnix?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    applyMigration,
    type ArcMenuStatus,
    BUNDLED_ARCMENU_VERSION,
    describeValue,
    disableArcMenu,
    type DisableResult,
    iconInstalled,
    type MigrationPlan,
    planMigration,
    queryArcMenu,
    readArcMenuSnapshot,
    spawnDefaults,
} from '../../migrate/arcmenu.js';
import type {PrefsContext} from '../context.js';
import {toast} from '../widgets.js';

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

const DISABLE_MESSAGE: Readonly<Record<DisableResult, string>> = {
    'disabled': 'ArcMenu has been disabled',
    'not-installed': 'ArcMenu is not installed',
    'already-disabled': 'ArcMenu is already disabled',
    'failed': 'GNOME Shell could not disable ArcMenu',
};

export function createImportPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'import',
        title: 'Import from ArcMenu',
        icon_name: 'document-open-symbolic',
    });
    let groups: Adw.PreferencesGroup[] = [];
    let imported = false;
    let arcStatus: ArcMenuStatus | null = null;
    let checking = false;

    const addGroup = (g: Adw.PreferencesGroup): void => {
        groups.push(g);
        page.add(g);
    };

    /** Asks the shell about ArcMenu, then redraws the page. */
    const refreshStatus = (): void => {
        if (checking)
            return;
        checking = true;
        void queryArcMenu().then(status => {
            checking = false;
            arcStatus = status;
            build();
        });
    };

    const statusRows = (): Adw.ActionRow[] => {
        const rows: Adw.ActionRow[] = [];
        if (!arcStatus) {
            rows.push(plainRow('Looking for ArcMenu…', undefined, 'content-loading-symbolic'));
        } else if (arcStatus.unknown) {
            rows.push(plainRow('ArcMenu status unknown', 'GNOME Shell did not answer; the settings below are still read from your configuration.', 'dialog-question-symbolic'));
        } else if (!arcStatus.installed) {
            rows.push(plainRow('ArcMenu is not installed', 'Settings it left behind can still be imported.', 'dialog-information-symbolic'));
        } else {
            const name = arcStatus.versionName ? `ArcMenu ${arcStatus.versionName}` : 'ArcMenu';
            const release = arcStatus.version !== null ? ` (release ${arcStatus.version})` : '';
            rows.push(plainRow(`${name}${release}`, arcStatus.enabled ? 'Installed and enabled' : 'Installed, currently disabled', 'emblem-ok-symbolic'));
            if (arcStatus.version !== null && arcStatus.version > BUNDLED_ARCMENU_VERSION) {
                const warn = plainRow(
                    'This ArcMenu is newer than the one Spawn knows',
                    `Spawn reads the settings of ArcMenu release ${BUNDLED_ARCMENU_VERSION}; options added since then are not imported.`,
                    'dialog-warning-symbolic',
                );
                warn.set_subtitle_lines(0);
                rows.push(warn);
            }
        }
        return rows;
    };

    const disableGroup = (): Adw.PreferencesGroup => {
        const g = new Adw.PreferencesGroup({
            title: 'Switch off ArcMenu',
            description: 'Two menus at once is confusing. Disabling only turns the extension off; its settings stay untouched, and you can enable it again any time.',
        });
        const enabled = arcStatus?.enabled ?? true;
        const row = new Adw.ActionRow({
            title: 'Disable ArcMenu',
            subtitle: arcStatus && !arcStatus.unknown && !enabled ? 'ArcMenu is already disabled' : undefined,
        });
        const button = new Gtk.Button({label: 'Disable', valign: Gtk.Align.CENTER, css_classes: ['destructive-action'], sensitive: enabled});
        button.connect('clicked', () => {
            button.set_sensitive(false);
            void disableArcMenu().then(result => {
                toast(ctx, DISABLE_MESSAGE[result]);
                if (result === 'failed')
                    button.set_sensitive(true);
                else
                    refreshStatus();
            });
        });
        row.add_suffix(button);
        g.add(row);
        return g;
    };

    const runImport = async (plan: MigrationPlan, alsoDisable: boolean): Promise<void> => {
        let result: ReturnType<typeof applyMigration>;
        try {
            result = applyMigration(plan, ctx.settings);
        } catch (e) {
            toast(ctx, `Import failed, nothing was changed: ${(e as Error).message}`);
            return;
        }
        imported = true;
        let message = `Imported ${result.written + result.reset} settings and ${plan.folders.length} folders`;
        if (result.failed.length > 0)
            message += `; ${result.failed.length} could not be applied (${result.failed.join(', ')})`;
        if (alsoDisable) {
            const disabled = await disableArcMenu();
            message += disabled === 'disabled' ? '. ArcMenu has been disabled' : `. ${DISABLE_MESSAGE[disabled]}`;
        }
        build();
        toast(ctx, message, () => {
            ctx.settings.restore(result.undo);
            imported = false;
            build();
        });
        refreshStatus();
    };

    const build = (): void => {
        for (const g of groups)
            page.remove(g);
        groups = [];

        const snapshot = readArcMenuSnapshot(ctx.extensionDir);
        const head = new Adw.PreferencesGroup({title: 'Import from ArcMenu'});
        const rescan = new Gtk.Button({label: 'Rescan', valign: Gtk.Align.CENTER, css_classes: ['flat']});
        rescan.connect('clicked', () => {
            build();
            refreshStatus();
        });
        head.set_header_suffix(rescan);
        addGroup(head);
        for (const row of statusRows())
            head.add(row);

        const offerDisable = (): void => {
            if (arcStatus?.installed || (arcStatus?.unknown && (imported || ctx.settings.get('migration-done'))))
                addGroup(disableGroup());
        };

        // ArcMenu hides the Activities button by default, so even an untouched but enabled ArcMenu has
        // something to import (hide-activities-button); without ArcMenu and without stored values it has not.
        const hasValues = snapshot !== null && Object.keys(snapshot.values).length > 0;
        if (!snapshot || (!hasValues && !arcStatus?.enabled)) {
            const status = new Adw.StatusPage({
                icon_name: 'emblem-important-symbolic',
                title: snapshot ? 'ArcMenu has no custom settings' : 'ArcMenu settings could not be read',
                description: snapshot ?
                    'ArcMenu is either not installed or still uses its defaults, so there is nothing to import.' :
                    'The bundled ArcMenu schema could not be loaded.',
            });
            status.add_css_class('compact');
            head.add(status);
            offerDisable();
            return;
        }

        const defaults = spawnDefaults(ctx.settings);
        const plan: MigrationPlan = planMigration(snapshot, defaults, {iconExists: v => iconInstalled(ctx.extensionDir, v)});
        const changed = plan.items.filter(i => i.differsFromDefault);
        const same = plan.items.filter(i => !i.differsFromDefault);

        head.set_description(
            `Found ${Object.keys(snapshot.values).length} customised ArcMenu settings. ` +
            'Nothing is changed until you press Import, and ArcMenu itself is never modified. An Undo button appears afterwards.',
        );
        const doImport = new Adw.ActionRow({
            title: imported ? 'Imported' : 'Import settings',
            subtitle: ctx.settings.get('migration-done') && !imported ?
                'You imported before; importing again replaces the listed settings, pinned apps and folders.' :
                `${changed.length} settings and ${plan.folders.length} folders`,
        });
        const importButton = new Gtk.Button({
            label: imported ? 'Import Again' : 'Import',
            valign: Gtk.Align.CENTER,
            css_classes: imported || arcStatus?.enabled ? [] : ['suggested-action'],
        });
        importButton.connect('clicked', () => void runImport(plan, false));
        if (arcStatus?.enabled) {
            const both = new Gtk.Button({
                label: 'Import and Disable ArcMenu',
                valign: Gtk.Align.CENTER,
                css_classes: ['suggested-action'],
                tooltip_text: 'Import, then turn the ArcMenu extension off (its settings stay untouched)',
            });
            both.connect('clicked', () => void runImport(plan, true));
            doImport.add_suffix(importButton);
            doImport.add_suffix(both);
        } else {
            doImport.add_suffix(importButton);
        }
        head.add(doImport);

        offerDisable();

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
            const expander = new Adw.ExpanderRow({
                title: `Same as the defaults (${same.length})`,
                subtitle: 'Not written: Spawn keeps following its own defaults for these',
            });
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
    refreshStatus();
    return page;
}
