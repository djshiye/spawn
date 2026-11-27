// Which removal action a mount's button performs: eject when GIO can eject it (safe removal, as Files and
// GNOME's Places extension do), else unmount, else none. One answer for the label, the action and the
// failure message. Pure (no shell imports) so unit tests can load it.
//
// Public API:
//   mountAction(mount): 'eject' | 'unmount' | null

export type MountAction = 'eject' | 'unmount' | null;

export function mountAction(mount: {can_eject(): boolean; can_unmount(): boolean}): MountAction {
    if (mount.can_eject())
        return 'eject';
    if (mount.can_unmount())
        return 'unmount';
    return null;
}
