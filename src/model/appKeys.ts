// Pure helpers for app search keys. No gi:// imports, so they run under `gjs -m` tests.
//
// Public API:
//   normalize(s)    lower-case + diacritics folded (NFD, combining marks stripped) + trimmed
//   appKeys(parts)  deduplicated, normalised, non-empty strings to match a query against

export interface AppKeyParts {
    name?: string | null;
    genericName?: string | null;
    keywords?: readonly string[] | null;
    /** Executable name or full path; only the basename is used. */
    executable?: string | null;
    /** Desktop id, with or without the ".desktop" suffix. */
    id?: string | null;
}

export function normalize(s: string | null | undefined): string {
    if (!s)
        return '';
    return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function basename(path: string): string {
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(i + 1) : path;
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
    add(parts.genericName);
    for (const kw of parts.keywords ?? [])
        add(kw);
    if (parts.executable)
        add(basename(parts.executable));
    if (parts.id) {
        add(parts.id);
        add(parts.id.replace(/\.desktop$/, ''));
    }
    return out;
}
