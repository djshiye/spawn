// Shell.App -> its desktop entry, typed the same under the 49, 50 and 51 typings (49 declares
// `Shell.App.get_app_info()` as `never` and the constructor's `app_info` property as `undefined`).
//
// Public API:
//   appInfoOf(app | null): GioUnix.DesktopAppInfo | null
//   newShellApp(info): Shell.App                 `new Shell.App({app_info})`; throws like the constructor

import type Gio from 'gi://Gio';
import type GioUnix from 'gi://GioUnix';
import Shell from 'gi://Shell';

export function appInfoOf(app: Shell.App | null | undefined): GioUnix.DesktopAppInfo | null {
    return (app?.get_app_info() as unknown as GioUnix.DesktopAppInfo | null) ?? null;
}

export function newShellApp(info: Gio.AppInfo | null): Shell.App {
    return new Shell.App({app_info: info} as unknown as ConstructorParameters<typeof Shell.App>[0]);
}
