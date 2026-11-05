// DesktopMemory: the pure decision logic of "Show Desktop" (no GObject, unit-tested in
// tests/core-showdesktop.test.js; the Meta glue is ui/showDesktop.ts).
//
// The memory is a flat set of window stable-sequence ids (never a window wrapper, so nothing
// GObject is held and the set survives disable/enable, a lock/unlock cycle and attacher rebuilds).
// It is owned by the SpawnExtension instance. Per workspace behaviour needs no keying: a toggle only
// looks at the windows of the workspace it runs on, so another workspace's ids stay untouched.
//
// Public API:
//   new DesktopMemory()
//   memory.plan(windows: DesktopWindow[], live: Iterable<number>): {hide: number[]; restore: number[]}
//       `windows`: the windows of the active workspace; `live`: every existing window's sequence id.
//       hide:    some toggleable window is showing -> minimize exactly those (and remember them)
//       restore: nothing is showing -> unminimize the remembered ones that are still minimized
//   memory.size: number                  remembered ids (diagnostics / tests)

export interface DesktopWindow {
    /** Meta.Window.get_stable_sequence(). */
    seq: number;
    minimized: boolean;
    /** Showing on its workspace (not hidden by something else). */
    showing: boolean;
    /** A normal window Show Desktop may touch (not a desktop, dock, splash, skip-taskbar one). */
    toggleable: boolean;
}

export interface DesktopPlan {
    hide: number[];
    restore: number[];
}

export class DesktopMemory {
    private readonly _ids = new Set<number>();

    get size(): number {
        return this._ids.size;
    }

    plan(windows: DesktopWindow[], live: Iterable<number>): DesktopPlan {
        const alive = new Set(live);
        for (const id of [...this._ids]) {
            if (!alive.has(id))
                this._ids.delete(id);
        }
        // Restored by hand since: no longer ours to restore.
        for (const w of windows) {
            if (!w.minimized)
                this._ids.delete(w.seq);
        }

        // Anything the user is looking at wins: a stale memory never restores over a visible window.
        const showing = windows.filter(w => w.toggleable && !w.minimized && w.showing);
        if (showing.length > 0) {
            for (const w of showing)
                this._ids.add(w.seq);
            return {hide: showing.map(w => w.seq), restore: []};
        }

        const restore = windows.filter(w => w.minimized && this._ids.has(w.seq)).map(w => w.seq);
        for (const id of restore)
            this._ids.delete(id);
        return {hide: [], restore};
    }
}
