// The shape every offline answer module (src/search/answers/*.ts) returns. No imports.
//
// An Answer is one result row: `title` is what the user reads, `copy` what Return / a click puts on the
// clipboard (often the title without decoration), `description` the second line (what the value is).
// The row shows the symbolic `icon`, unless `swatch` (a colour sample) or `glyph` (an emoji / character drawn
// as the icon) is set.

export interface Answer {
    /** Unique within the answers of one query (row reuse while typing): "netmask", "hex", "sha256"... */
    id: string;
    title: string;
    copy: string;
    description: string;
    /** A symbolic icon name of the Adwaita icon theme. */
    icon: string;
    /** "#rrggbb": show a sample of this colour instead of the icon. */
    swatch?: string;
    /** Show this text (an emoji or a character) instead of the icon. */
    glyph?: string;
    /** Only for the ranked tools (text tools, characters): 1..1000 on the bands of search/rank.ts. */
    score?: number;
}
