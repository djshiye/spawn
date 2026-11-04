// Path policy for the Dev interface's Screenshot(path). Pure helper (only GLib), unit-tested
// in tests/core-paths.test.js.
//
// Public API:
//   screenshotPath(path, runtimeDir): string | null
//     The lexically canonical absolute path when it is allowed, else null. Allowed: inside
//     `runtimeDir` ($XDG_RUNTIME_DIR), or inside a directory component named '.dev' (the dev
//     sandbox's output tree). Relative paths, '..' escapes and empty strings are rejected.

import GLib from 'gi://GLib';

export function screenshotPath(path: string, runtimeDir: string): string | null {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0'))
        return null;
    // Resolve '.' / '..' / duplicate slashes first, so the checks below cannot be dodged.
    const canonical = GLib.canonicalize_filename(path, null);
    if (canonical === '/')
        return null;
    const runtime = runtimeDir === '' ? '' : GLib.canonicalize_filename(runtimeDir, null).replace(/\/+$/, '');
    if (runtime !== '' && runtime !== '/' && canonical.startsWith(`${runtime}/`))
        return canonical;
    // A '.dev' directory component with something below it.
    if (canonical.includes('/.dev/'))
        return canonical;
    return null;
}
