// The "Back up and restore" group of the General page: two buttons with a file chooser each, a confirmation
// dialog before anything is replaced, and a toast with Undo afterwards. The logic and the file format live in
// backup.ts.
//
// Public API:
//   backupGroup(ctx: PrefsContext): Adw.PreferencesGroup
//   restoreFrom(ctx, file): void      read, validate, confirm and apply one backup file (also used by the dev checks)

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {
    applyBackup,
    createBackup,
    DEFAULT_BACKUP_NAME,
    describePlan,
    parseBackup,
    readBackupFile,
    type RestorePlan,
    writeBackupFile,
} from './backup.js';
import type {PrefsContext} from './context.js';
import {label, toast} from './widgets.js';

function version(ctx: PrefsContext): string {
    return String(ctx.metadata['version-name'] ?? ctx.metadata['version'] ?? '');
}

function jsonFilters(): Gio.ListStore {
    const json = new Gtk.FileFilter({name: 'Spawn settings (*.json)'});
    json.add_suffix('json');
    json.add_mime_type('application/json');
    const store = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
    store.append(json);
    return store;
}

function failure(ctx: PrefsContext, heading: string, body: string): void {
    const dialog = new Adw.AlertDialog({heading, body});
    dialog.add_response('close', 'Close');
    dialog.set_close_response('close');
    dialog.present(ctx.window);
}

function backUp(ctx: PrefsContext): void {
    const dialog = new Gtk.FileDialog({
        title: 'Back Up Settings',
        accept_label: 'Save',
        initial_name: DEFAULT_BACKUP_NAME,
        filters: jsonFilters(),
    });
    dialog.save(ctx.window, null, (_d, res) => {
        let file: Gio.File | null;
        try {
            file = dialog.save_finish(res);
        } catch {
            return; // dismissed
        }
        if (!file)
            return;
        try {
            writeBackupFile(file, createBackup(ctx.settings, version(ctx)));
            toast(ctx, 'Settings backed up');
        } catch (e) {
            failure(ctx, 'Backing Up Failed', `The file could not be written: ${(e as Error).message}`);
        }
    });
}

function confirmRestore(ctx: PrefsContext, plan: RestorePlan, apply: () => void): void {
    let body = `This replaces your current Spawn settings, pinned apps and folders.\n\n${describePlan(plan)}`;
    if (plan.ignored.length > 0) {
        const shown = plan.ignored.slice(0, 8).join(', ');
        body += `\n\nIgnored (not known to this version): ${shown}${plan.ignored.length > 8 ? `, and ${plan.ignored.length - 8} more` : ''}.`;
    }
    const dialog = new Adw.AlertDialog({heading: 'Restore Settings?', body});
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('restore', 'Restore');
    dialog.set_response_appearance('restore', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_d: Adw.AlertDialog, id: string) => {
        if (id === 'restore')
            apply();
    });
    dialog.present(ctx.window);
}

export function restoreFrom(ctx: PrefsContext, file: Gio.File): void {
    let plan: RestorePlan;
    try {
        const parsed = parseBackup(readBackupFile(file), ctx.settings);
        if (!parsed.ok) {
            failure(ctx, 'Cannot Restore', `${parsed.error} Nothing was changed.`);
            return;
        }
        plan = parsed.plan;
    } catch (e) {
        failure(ctx, 'Cannot Restore', `${(e as Error).message} Nothing was changed.`);
        return;
    }
    confirmRestore(ctx, plan, () => {
        try {
            const result = applyBackup(ctx.settings, plan);
            // The previous state is kept in memory for the Undo button of this toast.
            toast(ctx, 'Settings restored', () => {
                ctx.settings.restore(result.undo);
                toast(ctx, 'Previous settings brought back');
            });
        } catch (e) {
            failure(ctx, 'Restoring Failed', `Your previous settings were kept: ${(e as Error).message}`);
        }
    });
}

function restore(ctx: PrefsContext): void {
    const dialog = new Gtk.FileDialog({title: 'Restore Settings', accept_label: 'Open', filters: jsonFilters()});
    dialog.open(ctx.window, null, (_d, res) => {
        let file: Gio.File | null;
        try {
            file = dialog.open_finish(res);
        } catch {
            return; // dismissed
        }
        if (file)
            restoreFrom(ctx, file);
    });
}

export function backupGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const g = new Adw.PreferencesGroup({
        title: 'Back Up and Restore',
        description: 'Save your settings, pinned apps and folders to one file, for a new computer or a fresh install.',
    });
    const row = (title: string, subtitle: string, text: string, onClick: () => void): Adw.ActionRow => {
        const r = new Adw.ActionRow({title, subtitle});
        const button = new Gtk.Button({label: text, valign: Gtk.Align.CENTER});
        label(button, title);
        button.connect('clicked', onClick);
        r.add_suffix(button);
        r.set_activatable_widget(button);
        return r;
    };
    g.add(row('Back up settings', 'Writes a file only you can read', 'Back Up…', () => backUp(ctx)));
    g.add(row('Restore settings', 'Replaces the current settings; you can undo it afterwards', 'Restore…', () => restore(ctx)));
    return g;
}
