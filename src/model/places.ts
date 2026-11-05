// Places: the external devices / network locations and the file manager bookmarks shown in the right
// pane (show-external-devices, show-bookmarks; ArcMenu's PlacesManager).
//
// Devices come from Gio.VolumeMonitor (connected drives -> their volumes' mounts, volumes without a
// drive, mounts without a volume; network volumes / non-native mounts go to "network"), the same
// walk as GNOME's Places extension. Bookmarks are read from ~/.config/gtk-3.0/bookmarks (or
// ~/.gtk-bookmarks) and re-read, debounced, when the file changes (a Gio.FileMonitor that also
// notices the file being created or replaced). Nothing is watched while the matching setting is off.
//
// Public API:
//   new Places(scope: Scope, settings: SpawnSettings)
//   places.devices(): Place[]        mounted local devices
//   places.network(): Place[]        network locations
//   places.bookmarks(): Place[]      bookmarks (existing local folders, remote ones always)
//   places.onChanged(scope, cb)      cb() after any of the three lists changed
//   places.setFake(specs | null)     dev hook (Ui.SetPlaces): replaces devices / network / bookmarks by fakes
//   Place                            {kind, name, icon, ejectLabel ('' = cannot be ejected), open(), eject()}
//   FakePlace                        {kind: 'device'|'network'|'bookmark', name, icon?, ejectable?}

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {debounce} from '../core/debounce.js';
import {error, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import {parseBookmarks} from './bookmarkFile.js';

const BOOKMARK_COALESCE_MS = 100;
const MOUNT_COALESCE_MS = 50;
const MOUNT_OPERATION_MODULE = 'resource:///org/gnome/shell/ui/shellMountOperation.js';

export interface Place {
    kind: 'device' | 'network' | 'bookmark';
    name: string;
    icon: Gio.Icon;
    /** "Eject" / "Unmount", or '' when the place cannot be taken away. */
    ejectLabel: string;
    open(): void;
    eject(): void;
}

export interface FakePlace {
    kind: Place['kind'];
    name: string;
    icon?: string;
    ejectable?: boolean;
}

function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function notify(title: string, body: string): void {
    try {
        Main.notifyError(title, body);
    } catch (e) {
        error('showing a notification failed', e);
    }
}

/** The shell's mount operation (password / "device is busy" dialogs); a plain one when unavailable. */
async function mountOperation(source: {get_icon(): Gio.Icon | null}): Promise<{op: Gio.MountOperation; close(): void}> {
    try {
        const mod = await import(MOUNT_OPERATION_MODULE) as {
            ShellMountOperation: new (source: unknown) => {mountOp: Gio.MountOperation; close(): void};
        };
        const shell = new mod.ShellMountOperation(source);
        return {op: shell.mountOp, close: () => shell.close()};
    } catch (e) {
        warn(`no shell mount operation, using a plain one: ${message(e)}`);
        return {op: new Gio.MountOperation(), close: () => undefined};
    }
}

/** Open `uri` with the default handler; an unmounted remote location is mounted first (once). */
async function launchUri(uri: string, file: Gio.File | null, name: string, icon: Gio.Icon, again = true): Promise<void> {
    try {
        const context = global.create_app_launch_context(0, -1);
        Gio.AppInfo.launch_default_for_uri(uri, context);
    } catch (e) {
        if (!(e instanceof GLib.Error) || !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_MOUNTED) || !file || !again) {
            notify(_('Failed to open “%s”').replace('%s', name), message(e));
            return;
        }
        const mount = await mountOperation({get_icon: () => icon});
        try {
            await new Promise<void>((resolve, reject) => {
                file.mount_enclosing_volume(Gio.MountMountFlags.NONE, mount.op, null, (_f: Gio.File | null, res: Gio.AsyncResult) => {
                    try {
                        file.mount_enclosing_volume_finish(res);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            });
            await launchUri(uri, file, name, icon, false);
        } catch (err) {
            if (!(err instanceof GLib.Error) || !err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED_HANDLED))
                notify(_('Failed to mount volume for “%s”').replace('%s', name), message(err));
        } finally {
            mount.close();
        }
    }
}

class MountPlace implements Place {
    readonly name: string;
    readonly icon: Gio.Icon;
    readonly ejectLabel: string;

    constructor(readonly kind: 'device' | 'network', private readonly _mount: Gio.Mount) {
        this.name = _mount.get_name();
        this.icon = _mount.get_symbolic_icon();
        this.ejectLabel = _mount.can_unmount() ? _('Unmount') : _mount.can_eject() ? _('Eject') : '';
    }

    get root(): Gio.File {
        return this._mount.get_root();
    }

    open(): void {
        const root = this._mount.get_root();
        void launchUri(root.get_uri(), root, this.name, this.icon);
    }

    eject(): void {
        const mount = this._mount;
        void (async () => {
            const op = await mountOperation(mount);
            const done = (finish: () => void): void => {
                try {
                    finish();
                } catch (e) {
                    notify(_('Ejecting drive “%s” failed:').replace('%s', this.name), message(e));
                } finally {
                    op.close();
                }
            };
            if (mount.can_eject())
                mount.eject_with_operation(Gio.MountUnmountFlags.NONE, op.op, null, (_m: Gio.Mount | null, res: Gio.AsyncResult) => done(() => mount.eject_with_operation_finish(res)));
            else
                mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, op.op, null, (_m: Gio.Mount | null, res: Gio.AsyncResult) => done(() => mount.unmount_with_operation_finish(res)));
        })();
    }
}

class BookmarkPlace implements Place {
    readonly kind = 'bookmark';
    readonly ejectLabel = '';

    constructor(readonly name: string, readonly icon: Gio.Icon, private readonly _file: Gio.File) {}

    open(): void {
        void launchUri(this._file.get_uri(), this._file, this.name, this.icon);
    }

    eject(): void {
        // bookmarks cannot be ejected
    }
}

class FakeEntry implements Place {
    readonly name: string;
    readonly icon: Gio.Icon;
    readonly ejectLabel: string;
    readonly kind: Place['kind'];

    constructor(spec: FakePlace, private readonly _removed: (p: FakeEntry) => void) {
        this.kind = spec.kind;
        this.name = spec.name;
        this.icon = Gio.ThemedIcon.new(spec.icon ?? (spec.kind === 'bookmark' ? 'folder-symbolic' : spec.kind === 'network' ? 'folder-remote-symbolic' : 'drive-removable-media-symbolic'));
        this.ejectLabel = spec.ejectable ? _('Eject') : '';
    }

    open(): void {
        warn(`fake place '${this.name}' opened`);
    }

    eject(): void {
        this._removed(this);
    }
}

export class Places {
    private readonly _settings: SpawnSettings;
    private readonly _devScope: Scope;
    private readonly _bookmarkScope: Scope;
    private readonly _listeners = new Set<() => void>();
    private _devices: Place[] = [];
    private _network: Place[] = [];
    private _bookmarks: Place[] = [];
    private _fake = false;
    private _watchingDevices = false;
    private _watchingBookmarks = false;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._settings = settings;
        this._devScope = scope.child('places devices');
        this._bookmarkScope = scope.child('places bookmarks');
        settings.onChanged(scope, ['show-external-devices', 'show-bookmarks'], () => this._sync());
        scope.add(() => this._listeners.clear(), 'places listeners');
        this._sync();
    }

    devices(): Place[] {
        return this._devices;
    }

    network(): Place[] {
        return this._network;
    }

    bookmarks(): Place[] {
        return this._bookmarks;
    }

    onChanged(scope: Scope, cb: () => void): void {
        this._listeners.add(cb);
        scope.add(() => this._listeners.delete(cb), 'places listener');
    }

    /** Dev hook: a headless session has no removable media. null = the real places again. */
    setFake(specs: FakePlace[] | null): void {
        this._fake = specs !== null;
        if (specs === null) {
            this._sync(true);
            return;
        }
        const entries = specs.map(s => new FakeEntry(s, p => {
            for (const key of ['_devices', '_network', '_bookmarks'] as const)
                this[key] = this[key].filter(x => x !== p);
            this._emit();
        }));
        this._devices = entries.filter(p => p.kind === 'device');
        this._network = entries.filter(p => p.kind === 'network');
        this._bookmarks = entries.filter(p => p.kind === 'bookmark');
        this._emit();
    }

    private _emit(): void {
        for (const cb of [...this._listeners]) {
            try {
                cb();
            } catch (e) {
                error('places listener failed', e);
            }
        }
    }

    private _sync(force = false): void {
        if (this._fake)
            return;
        const wantDevices = this._settings.get('show-external-devices');
        if (wantDevices && (!this._watchingDevices || force)) {
            this._watchingDevices = true;
            this._watchDevices();
        } else if (!wantDevices && this._watchingDevices) {
            this._watchingDevices = false;
            this._devScope.dispose();
            this._devices = [];
            this._network = [];
            this._emit();
        }
        const wantBookmarks = this._settings.get('show-bookmarks');
        if (wantBookmarks && (!this._watchingBookmarks || force)) {
            this._watchingBookmarks = true;
            this._watchBookmarks();
        } else if (!wantBookmarks && this._watchingBookmarks) {
            this._watchingBookmarks = false;
            this._bookmarkScope.dispose();
            this._bookmarks = [];
            this._emit();
        }
    }

    // ---- devices ----

    private _watchDevices(): void {
        const scope = this._devScope;
        scope.dispose();
        const monitor = Gio.VolumeMonitor.get();
        const update = debounce(scope, MOUNT_COALESCE_MS, () => this._readMounts(monitor));
        for (const signal of ['volume-added', 'volume-removed', 'volume-changed', 'mount-added', 'mount-removed', 'mount-changed',
            'drive-connected', 'drive-disconnected', 'drive-changed'])
            scope.connect(monitor, signal, () => update.call());
        this._readMounts(monitor);
    }

    private _readMounts(monitor: Gio.VolumeMonitor): void {
        const devices: Place[] = [];
        const network: Place[] = [];
        const seen = new Set<Gio.Mount>();
        const add = (list: Place[], mount: Gio.Mount | null, kind: 'device' | 'network'): void => {
            if (!mount || seen.has(mount))
                return;
            seen.add(mount);
            try {
                list.push(new MountPlace(kind, mount));
            } catch (e) {
                warn(`skipping mount: ${message(e)}`);
            }
        };
        const isNetwork = (volume: Gio.Volume): boolean => Boolean(volume.get_identifier('class')?.includes('network'));
        const networkVolumes: Gio.Volume[] = [];

        for (const drive of monitor.get_connected_drives()) {
            for (const volume of drive.get_volumes()) {
                if (isNetwork(volume))
                    networkVolumes.push(volume);
                else
                    add(devices, volume.get_mount(), 'device');
            }
        }
        for (const volume of monitor.get_volumes()) {
            if (volume.get_drive())
                continue;
            if (isNetwork(volume))
                networkVolumes.push(volume);
            else
                add(devices, volume.get_mount(), 'device');
        }
        // mounts without a volume (/etc/mtab mounts, ftp, sftp, ...)
        for (const mount of monitor.get_mounts()) {
            if (mount.is_shadowed() || mount.get_volume())
                continue;
            if (!mount.get_default_location().is_native())
                add(network, mount, 'network');
            else
                add(devices, mount, 'device');
        }
        for (const volume of networkVolumes)
            add(network, volume.get_mount(), 'network');

        this._devices = devices;
        this._network = network;
        this._emit();
    }

    // ---- bookmarks ----

    private _bookmarksPath(): string | null {
        const candidates = [
            GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-3.0', 'bookmarks']),
            GLib.build_filenamev([GLib.get_home_dir(), '.gtk-bookmarks']),
        ];
        return candidates.find(p => GLib.file_test(p, GLib.FileTest.EXISTS)) ?? null;
    }

    private _watchBookmarks(): void {
        const scope = this._bookmarkScope;
        scope.dispose();
        const reload = debounce(scope, BOOKMARK_COALESCE_MS, () => this._readBookmarks());
        // Watch the config directory's file path even before it exists (the monitor reports its creation).
        const paths = new Set<string>([
            GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-3.0', 'bookmarks']),
            GLib.build_filenamev([GLib.get_home_dir(), '.gtk-bookmarks']),
        ]);
        for (const path of paths) {
            try {
                const monitor = Gio.File.new_for_path(path).monitor_file(Gio.FileMonitorFlags.NONE, null);
                scope.connect(monitor, 'changed', () => reload.call());
                scope.add(() => monitor.cancel(), 'bookmarks monitor');
            } catch (e) {
                warn(`cannot watch ${path}: ${message(e)}`);
            }
        }
        this._readBookmarks();
    }

    private _readBookmarks(): void {
        const path = this._bookmarksPath();
        let entries: Array<{uri: string; label: string}> = [];
        if (path) {
            try {
                const [ok, bytes] = GLib.file_get_contents(path);
                if (ok)
                    entries = parseBookmarks(new TextDecoder().decode(bytes));
            } catch (e) {
                warn(`cannot read ${path}: ${message(e)}`);
            }
        }
        const out: Place[] = [];
        const seen = new Set<string>();
        for (const {uri, label} of entries) {
            if (seen.has(uri))
                continue;
            seen.add(uri);
            try {
                const file = Gio.File.new_for_uri(uri);
                let name = label;
                let icon: Gio.Icon;
                if (file.is_native()) {
                    let info: Gio.FileInfo;
                    try {
                        info = file.query_info('standard::display-name,standard::symbolic-icon', Gio.FileQueryInfoFlags.NONE, null);
                    } catch {
                        continue; // gone: skip it like the file manager's sidebar greys it out
                    }
                    name = name || info.get_display_name();
                    icon = info.get_symbolic_icon() ?? Gio.ThemedIcon.new('folder-symbolic');
                } else {
                    name = name || file.get_basename() || uri;
                    icon = Gio.ThemedIcon.new('folder-remote-symbolic');
                }
                out.push(new BookmarkPlace(name, icon, file));
            } catch (e) {
                warn(`skipping bookmark ${uri}: ${message(e)}`);
            }
        }
        this._bookmarks = out;
        this._emit();
    }
}
