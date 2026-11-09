// "Spawn was updated" helpers: the shell keeps running the OLD code after a package update (a running GNOME
// Shell cannot reload an extension's code), while the stylesheet and the settings window are read from disk anew,
// so they are the new version. The user has to log out and back in; these pure helpers decide when to say so.
//
// This module has no imports so it is usable from unit tests under gjs -m and from the prefs process.
//
// Public API:
//   RUNNING_VERSION_PROPERTY        name of the read-only D-Bus property (io.github.djshiye.Spawn) that tells the
//                                   settings window which version the shell is running
//   versionOf(metadata): string|null          `version-name` (else `version`) of a parsed metadata.json
//   parseMetadataVersion(text): string|null   the same from the text of metadata.json (null when unreadable)
//   updatePending(running, onDisk): boolean    both known and different
//   updateTitle(onDisk) / UPDATE_DETAIL        the notification's title ("Spawn was updated to 1.2.0") and text
//   updateMessage(onDisk): string              both as one sentence, for the settings window
//                                              ("Spawn was updated to 1.2.0. Log out and back in to finish the update.")

export const RUNNING_VERSION_PROPERTY = 'RunningVersion';

export function versionOf(metadata: unknown): string | null {
    if (metadata === null || typeof metadata !== 'object')
        return null;
    const m = metadata as Record<string, unknown>;
    for (const v of [m['version-name'], m['version']]) {
        if ((typeof v === 'string' && v.trim() !== '') || typeof v === 'number')
            return String(v).trim();
    }
    return null;
}

export function parseMetadataVersion(text: string): string | null {
    try {
        return versionOf(JSON.parse(text));
    } catch {
        return null;
    }
}

export function updatePending(running: string | null | undefined, onDisk: string | null | undefined): boolean {
    return Boolean(running) && Boolean(onDisk) && running !== onDisk;
}

export function updateTitle(onDisk: string): string {
    return `Spawn was updated to ${onDisk}`;
}

export const UPDATE_DETAIL = 'Log out and back in to finish the update.';

export function updateMessage(onDisk: string): string {
    return `${updateTitle(onDisk)}. ${UPDATE_DETAIL}`;
}
