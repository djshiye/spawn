// Pure helpers for app search keys. No gi:// imports, so they run under `gjs -m` tests.
//
// Public API:
//   normalize(s)    lower-case + diacritics folded (NFD, combining marks stripped) + trimmed
//   appKeys(parts)  deduplicated, normalised, non-empty strings to match a query against
//   descriptionKey(s)  the normalised app description (Comment=), matched word by word only
//   idKey(id)       the search key derived from a desktop id: no ".desktop" suffix, and for
//                   reverse-DNS ids (org.gnome.Nautilus, com.spotify.Client, io.github.u.App,
//                   page.codeberg.Foo: a known TLD or any lower-case first segment with >= 3
//                   segments) only the LAST segment, so vendor tokens ("org", "gnome", "com",
//                   "desktop") never match or form acronyms.

export interface AppKeyParts {
    name?: string | null;
    genericName?: string | null;
    keywords?: readonly string[] | null;
    /** Executable name or full path; only the basename is used (not for generic launchers such as flatpak, env, gapplication, python3.x or *.AppImage). */
    executable?: string | null;
    /** X-GNOME-FullName, e.g. "GNOME Terminal". */
    fullName?: string | null;
    /** Desktop id, with or without the ".desktop" suffix. */
    id?: string | null;
}

export function normalize(s: string | null | undefined): string {
    if (!s)
        return '';
    return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Last path component without the quotes a quoted Exec= path leaves behind (`/opt/x/launcher.sh"`). */
function basename(path: string): string {
    const i = path.lastIndexOf('/');
    return (i >= 0 ? path.slice(i + 1) : path).replace(/^["']+|["']+$/g, '');
}

const REVERSE_DNS_TLDS = new Set([
    'org', 'com', 'net', 'io', 'edu', 'gov', 'info', 'dev', 'app', 'me', 'co', 'us', 'uk',
    'de', 'fr', 'es', 'it', 'nl', 'se', 'ch', 'at', 'ru', 'cn', 'jp', 'kr', 'br', 'ca', 'eu',
    'pl', 'cz', 'fi', 'no', 'dk', 'be', 'pt', 'au', 'nz', 'in', 'tv', 'xyz',
    'page', 'chat', 'one', 'sh', 'md', 'im', 'tech', 'cc', 'is', 'garden', 'ai', 'cloud', 'studio',
    'run', 'to', 'link', 'social', 'gg', 'fm', 'so', 'site', 'space', 'online', 'pro', 'systems',
    'software', 'games', 'game', 'ink', 'codes', 'works', 'tools', 'network',
]);

/** Reverse-DNS: a known TLD first, or any id of >= 3 segments whose first segment is all lower-case letters. */
export function idKey(id: string): string {
    const bare = id.replace(/\.desktop$/, '');
    const parts = bare.split('.');
    if (parts.length >= 3 && (REVERSE_DNS_TLDS.has(parts[0].toLowerCase()) || /^[a-z]+$/.test(parts[0])))
        return parts[parts.length - 1];
    return bare;
}

/** The description is not part of appKeys(): it is scored per word (rank.ts scoreDescription). */
export function descriptionKey(description: string | null | undefined): string {
    return normalize(description).replace(/\s+/g, ' ');
}

/** Executables that only wrap the real program (every Flatpak app runs /usr/bin/flatpak): not a search key. */
const GENERIC_LAUNCHERS = new Set([
    'flatpak', 'snap', 'env', 'sh', 'bash', 'dash', 'zsh', 'python', 'python3', 'gjs', 'java', 'wine',
    'gio', 'xdg-open', 'dbus-launch', 'dbus-run-session', 'sudo', 'pkexec', 'toolbox', 'distrobox', 'steam',
    'gapplication', 'gtk-launch', 'nohup', 'uwsm', 'electron', 'node', 'perl', 'ruby', 'systemd-run',
    'gamemoderun', 'prime-run', 'setsid', 'nice', 'xdg-terminal-exec',
]);

/** Wrapper programs by pattern: python3.12, AppImage files (their name is no search term). */
function isGenericLauncher(exe: string): boolean {
    const lower = exe.toLowerCase();
    return GENERIC_LAUNCHERS.has(lower) || /^python[\d.]+$/.test(lower) || lower.endsWith('.appimage');
}

export function appKeys(parts: AppKeyParts): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string | null | undefined) => {
        const key = normalize(raw);
        if (key && !seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    };

    add(parts.name);
    add(parts.fullName);
    add(parts.genericName);
    for (const kw of parts.keywords ?? [])
        add(kw);
    if (parts.executable) {
        const exe = basename(parts.executable);
        if (exe && !isGenericLauncher(exe))
            add(exe);
    }
    if (parts.id)
        add(idKey(parts.id));
    return out;
}
