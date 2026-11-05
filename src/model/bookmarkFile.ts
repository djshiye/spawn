// Parser for the GTK / file manager bookmarks file (~/.config/gtk-3.0/bookmarks). Pure: no gi:// imports.
//
// Public API:
//   parseBookmarks(text): Array<{uri, label}>   one `uri [label]` per line; blank lines are skipped, the
//                                               label is everything after the first space ('' = none)

export function parseBookmarks(text: string): Array<{uri: string; label: string}> {
    const out: Array<{uri: string; label: string}> = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        const space = trimmed.indexOf(' ');
        const uri = space < 0 ? trimmed : trimmed.slice(0, space);
        const label = space < 0 ? '' : trimmed.slice(space + 1).trim();
        out.push({uri, label});
    }
    return out;
}
