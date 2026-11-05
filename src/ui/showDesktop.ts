// Show Desktop, shared by the panel button's context menu (buttonMenu.ts) and the right-pane
// shortcut (widgets/shortcutRow.ts): minimize the normal windows of the active workspace; activating
// it again restores exactly those windows.
//
// The memory (core/desktopToggle.ts DesktopMemory) lives on the SpawnExtension instance, which GNOME
// keeps across disable/enable (lock screen, panel rebuilds), and is found through
// Extension.lookupByUUID, so nothing here is module state.
//
// Public API:
//   toggleShowDesktop(): void       never throws
//   isDesktopToggleable(w): boolean windows Show Desktop touches

import Meta from 'gi://Meta';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {UUID} from '../core/constants.js';
import {DesktopMemory, type DesktopWindow} from '../core/desktopToggle.js';
import {error, warn} from '../core/log.js';

export function isDesktopToggleable(w: Meta.Window): boolean {
    if (w.skip_taskbar)
        return false;
    const type = w.window_type;
    return type !== Meta.WindowType.DESKTOP && type !== Meta.WindowType.DOCK && type !== Meta.WindowType.SPLASHSCREEN;
}

function memory(): DesktopMemory {
    const owner = Extension.lookupByUUID(UUID) as unknown as {desktopMemory?: DesktopMemory} | null;
    if (owner?.desktopMemory)
        return owner.desktopMemory;
    warn('Show Desktop: extension instance not found; the restore memory will not persist');
    return new DesktopMemory();
}

export function toggleShowDesktop(): void {
    try {
        const workspace = global.workspace_manager.get_active_workspace();
        const bySeq = new Map<number, Meta.Window>();
        const windows: DesktopWindow[] = [];
        for (const w of workspace.list_windows()) {
            const seq = w.get_stable_sequence();
            bySeq.set(seq, w);
            windows.push({
                seq,
                minimized: w.minimized,
                showing: w.showing_on_its_workspace(),
                toggleable: isDesktopToggleable(w),
            });
        }
        const live = global.display.list_all_windows().map(w => w.get_stable_sequence());
        const plan = memory().plan(windows, live);

        const pick = (seqs: number[]) => global.display.sort_windows_by_stacking(
            seqs.map(s => bySeq.get(s)).filter((w): w is Meta.Window => w !== undefined));
        // Bottom of the stack first, so the stacking order the user had comes back.
        for (const w of pick(plan.restore))
            w.unminimize();
        for (const w of pick(plan.hide))
            w.minimize();
    } catch (e) {
        error('Show Desktop failed', e);
    }
}
