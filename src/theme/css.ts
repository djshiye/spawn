// Pure CSS generation for the theme (no gi:// imports, so it runs under gjs -m tests).
// Re-exported from theme/theme.ts, which documents the selectors being styled.

export interface ThemeColors {
    background: string;
    foreground: string;
    border: string;
    borderWidth: number;
    borderRadius: number;
    fontSize: number;
    separator: string;
    itemHoverBg: string;
    itemHoverFg: string;
    itemActiveBg: string;
    itemActiveFg: string;
}

/** Each override is `[enabled, value]`, mirroring the (bs)/(bi) settings. */
export interface ButtonColors {
    fg: [boolean, string];
    bg: [boolean, string];
    borderRadius: [boolean, number];
    borderWidth: [boolean, number];
    borderColor: [boolean, string];
    hoverBg: [boolean, string];
    hoverFg: [boolean, string];
    activeBg: [boolean, string];
    activeFg: [boolean, string];
}

export interface ThemeInput {
    accent: string;
    override: boolean;
    colors: ThemeColors;
    buttonColors: ButtonColors;
    /** `search-entry-border-radius` (bi); omitted = leave the stylesheet.css value alone. */
    searchEntryRadius?: [boolean, number];
    /** `menu-arrow-rise` (bi): the main popup's distance from the panel (0..50: a negative rise would pull the menu over the panel and off the screen edge); omitted / disabled = the shell theme's. */
    arrowRise?: [boolean, number];
}

// ---- pure helpers ----

/** GNOME's accent palette (libadwaita accent_bg_color values). */
export const ACCENT_COLORS: Readonly<Record<string, string>> = {
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
};

export const ACCENT_FG = '#ffffff';
const WHITE_MIN_CONTRAST = 3.5;
const ACCENT_FG_DARK = 'rgba(0,0,0,0.87)';

function linear(c: number): number {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Text colour for a selected / checked accent background: white or dark, whichever contrasts more (WCAG). */
export function accentForeground(hex: string): string {
    const m = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
    if (!m)
        return ACCENT_FG;
    let h = m[1] as string;
    if (h.length === 3)
        h = [...h].map(c => c + c).join('');
    const lum = 0.2126 * linear(parseInt(h.slice(0, 2), 16)) + 0.7152 * linear(parseInt(h.slice(2, 4), 16)) + 0.0722 * linear(parseInt(h.slice(4, 6), 16));
    // Pure "higher contrast wins" would pick dark on GNOME's blue; keep white (the platform look)
    // while it still reaches 3.5:1, and switch to dark where it does not (yellow 3.0, orange 3.4).
    return 1.05 / (lum + 0.05) >= WHITE_MIN_CONTRAST ? ACCENT_FG : ACCENT_FG_DARK;
}

export function accentColor(name: string): string {
    return ACCENT_COLORS[name] ?? ACCENT_COLORS['blue'] as string;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/-]+\)$/i;
const NAME_RE = /^[a-zA-Z]{3,30}$/;

/** Returns the trimmed colour if it is safe to embed in CSS, else null. */
export function sanitizeColor(value: unknown): string | null {
    if (typeof value !== 'string')
        return null;
    const v = value.trim();
    if (v.length === 0 || v.length > 64)
        return null;
    if (HEX_RE.test(v) || FUNC_RE.test(v) || NAME_RE.test(v))
        return v;
    return null;
}

function expandHex(hex: string): [number, number, number] | null {
    let h = hex.slice(1);
    if (h.length === 3 || h.length === 4)
        h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8)
        return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `rgba()` of `color` with the given alpha; unknown formats are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
    const a = Math.max(0, Math.min(1, alpha));
    const c = color.trim();
    if (c.startsWith('#')) {
        const rgb = expandHex(c);
        return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})` : c;
    }
    const m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*[0-9.]+\s*)?\)$/i.exec(c);
    if (m)
        return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
    return c;
}

/** `[r, g, b, a]` of a hex or rgb()/rgba() colour (0..255, alpha 0..1); null for other formats. */
export function parseColor(color: string): [number, number, number, number] | null {
    const c = color.trim();
    if (c.startsWith('#')) {
        const rgb = expandHex(c);
        if (!rgb)
            return null;
        const h = c.slice(1);
        const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : h.length === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1;
        return [...rgb, a];
    }
    const m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(c);
    if (!m)
        return null;
    const ch = (v: string | undefined) => Math.max(0, Math.min(255, Number(v)));
    return [ch(m[1]), ch(m[2]), ch(m[3]), m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4])))];
}

function flatten(background: string): {flat: [number, number, number]; base: number} | null {
    const bg = parseColor(background);
    if (!bg)
        return null;
    const [r, g, b, a] = bg;
    const lum = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const base = lum > 0.4 ? 255 : 0;
    return {flat: [r, g, b].map(v => v * a + base * (1 - a)) as [number, number, number], base};
}

/**
 * The folder popup's card, dark menus: an opaque, slightly raised copy of the menu background. A see-through
 * menu colour (custom colours with alpha < 1) would let the rows under the card show through it, so the colour
 * is flattened onto black (dark menus) or white (light menus) and then lifted 7 % towards the text colour.
 * Null when the colour is not one we can parse (the stylesheet's card colour then stays).
 */
export function raisedSurface(background: string, foreground: string | null): string | null {
    const f = flatten(background);
    if (!f)
        return null;
    const {flat, base} = f;
    const fg = (foreground ? parseColor(foreground) : null) ?? (base ? [0, 0, 0, 1] : [255, 255, 255, 1]);
    const lift = 0.07;
    const out = flat.map((v, i) => Math.round(v + ((fg[i] as number) - v) * lift));
    return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}

/**
 * The card's colour for any menu background: dark menus use raisedSurface (a little lighter than the menu);
 * light menus get the menu colour opened 60 % towards white, so the card stays the brightest thing on the
 * dimmed menu instead of turning grey. Always opaque; null when the colour cannot be parsed.
 */
export function cardSurface(background: string, foreground: string | null): string | null {
    const f = flatten(background);
    if (!f)
        return null;
    if (f.base === 0)
        return raisedSurface(background, foreground);
    const out = f.flat.map(v => Math.round(v + (255 - v) * 0.6));
    return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

type Decl = [property: string, value: string | null];

/** One CSS rule; declarations with a null value are dropped, an empty rule is omitted. */
function rule(selectors: string | string[], decls: Decl[]): string {
    const body = decls.filter((d): d is [string, string] => d[1] !== null).map(([p, v]) => `    ${p}: ${v};`);
    if (body.length === 0)
        return '';
    const sel = Array.isArray(selectors) ? selectors.join(',\n') : selectors;
    return `${sel} {\n${body.join('\n')}\n}\n`;
}

// The folder header's buttons draw themselves; every other item (list row, tile, user card, nav / power
// button) is a transparent St.Button (the hit area, gap included) around a visible .spawn-surface
// child, so the state of the button styles its face (ui/widgets/interact.ts).
const ITEM = ['.spawn-row'];
const ROW_FACE = '.spawn-row-surface';
const FACES: Array<[button: string, face: string]> = [
    ['.spawn-pinned-row', ROW_FACE], ['.spawn-list-row', ROW_FACE], ['.spawn-category-row', ROW_FACE],
    ['.spawn-result-row', ROW_FACE], ['.spawn-shortcut-row', ROW_FACE],
    ['.spawn-tile', '.spawn-tile-surface'], ['.spawn-user-card', '.spawn-card-surface'],
    ['.spawn-nav-button', '.spawn-nav-surface'], ['.spawn-power-button', '.spawn-power-surface'],
];
const FACE = (suffix: string, scope: string): string[] => FACES.map(([button, face]) => `${scope}${button}${suffix} ${face}`);
const each = (suffix: string, scope = ''): string[] => [...ITEM.map(s => `${scope}${s}${suffix}`), ...FACE(suffix, scope)];

// The shell theme nests panel-button rules under `#panel` (specificity 1,1,0 and up), and both
// GNOME's panel and Dash to Panel's panels are named 'panel', so our rules must carry the
// same prefix to win. Hover/active feedback in the theme is an inset box-shadow overlay, not a
// background colour, so those states override box-shadow (a solid colour covers the overlay).
const BUTTON = '#panel .panel-button.spawn-button';
/** The panel button's popup (the runner shares .spawn-popup but must keep its own arrow-rise of 0). */
const MENU_POPUP = '.spawn-menu-popup';

function buttonRules(b: ButtonColors): string[] {
    const on = <T>(t: [boolean, T] | undefined): T | null => (t && t[0] ? t[1] : null);
    const col = (t: [boolean, string] | undefined): string | null => {
        const v = on(t);
        return v === null ? null : sanitizeColor(v);
    };
    const overlay = (c: string | null): string | null => (c === null ? null : `inset 0 0 0 100px ${c}`);
    const bw = on(b.borderWidth);
    const br = on(b.borderRadius);
    const out: string[] = [];
    out.push(rule(BUTTON, [
        ['color', col(b.fg)],
        ['background-color', col(b.bg)],
        ['border-radius', br === null ? null : `${num(br, 0, 100, 0)}px`],
        ['border-width', bw === null ? null : `${num(bw, 0, 20, 0)}px`],
        ['border-style', bw === null ? null : 'solid'],
        ['border-color', col(b.borderColor) ?? (bw === null ? null : 'transparent')],
    ]));
    out.push(rule([`${BUTTON}:hover`, `${BUTTON}:focus`], [
        ['color', col(b.hoverFg)],
        ['box-shadow', overlay(col(b.hoverBg))],
    ]));
    out.push(rule([`${BUTTON}:active`, `${BUTTON}:checked`, `${BUTTON}:active:hover`, `${BUTTON}:checked:hover`], [
        ['color', col(b.activeFg)],
        ['box-shadow', overlay(col(b.activeBg))],
    ]));
    return out;
}

function accentRules(accent: string): string[] {
    const a = sanitizeColor(accent) ?? ACCENT_COLORS['blue'] as string;
    return [
        // Focus: the 25 % tint alone is 1.4:1 against the popup, so every focusable item also gets
        // a 2 px accent ring (4.3:1, WCAG 1.4.11).
        rule(each(':focus'), [
            ['background-color', withAlpha(a, 0.25)],
            ['box-shadow', `inset 0 0 0 2px ${a}`],
        ]),
        // Pressed is momentary: a 55 % accent keeps white text above 4.5:1 (solid accent is 3.8:1).
        rule(each(':active'), [
            ['background-color', withAlpha(a, 0.55)],
            ['color', ACCENT_FG],
        ]),
        rule([...each(':selected'), ...each(':checked')], [
            ['background-color', a],
            ['color', accentForeground(a)],
        ]),
        // The entry has a border instead of a face: accent border plus a 1 px inner ring (2 px in all).
        rule('.spawn-search-box:focus', [['border-color', a], ['box-shadow', `inset 0 0 0 1px ${a}`]]),
        rule('.spawn-drop-target', [
            ['background-color', withAlpha(a, 0.2)],
            ['border', `2px solid ${a}`],
        ]),
        rule('.spawn-accent', [['color', a]]),
    ];
}

function overrideRules(c: ThemeColors): string[] {
    const bg = sanitizeColor(c.background);
    const fg = sanitizeColor(c.foreground);
    const border = sanitizeColor(c.border);
    const sep = sanitizeColor(c.separator);
    const hoverBg = sanitizeColor(c.itemHoverBg);
    const hoverFg = sanitizeColor(c.itemHoverFg);
    const activeBg = sanitizeColor(c.itemActiveBg);
    const activeFg = sanitizeColor(c.itemActiveFg);
    const bw = `${num(c.borderWidth, 0, 20, 1)}px`;
    const radius = `${num(c.borderRadius, 0, 60, 14)}px`;
    const font = c.fontSize > 0 ? `${num(c.fontSize, 6, 30, 11)}pt` : null;
    const popup = '.spawn-popup';
    return [
        rule(popup, [
            ['-arrow-background-color', bg],
            ['-arrow-border-color', border],
            ['-arrow-border-width', bw],
            ['-arrow-border-radius', radius],
            ['color', fg],
            ['font-size', font],
        ]),
        rule(`${popup} .popup-menu-content`, [
            ['background-color', bg],
            ['color', fg],
            ['border-color', border],
            ['border-width', bw],
            ['border-style', 'solid'],
            ['border-radius', radius],
        ]),
        // The folder popup card is a raised copy of the menu background (opaque-ish over the scrim).
        // Always opaque (see cardSurface), with a hairline in the text colour: a custom border colour is
        // often the menu colour itself, which would leave the card without an edge.
        rule([`${popup} .spawn-folder-popup`, `${popup} .spawn-grid-card`], [
            ['background-color', bg === null ? null : cardSurface(bg, fg) ?? bg],
            ['color', fg],
            ['border-color', fg === null ? border : withAlpha(fg, 0.12)],
        ]),
        rule(each(':hover', `${popup} `), [['background-color', hoverBg], ['color', hoverFg]]),
        // Custom colours: the accent ring would not be checked against the custom background, so the ring
        // takes the item's own hover text colour, which is chosen to read on the hover background.
        rule(each(':focus', `${popup} `), [
            ['background-color', hoverBg],
            ['color', hoverFg],
            ['box-shadow', hoverFg === null ? null : `inset 0 0 0 2px ${hoverFg}`],
        ]),
        rule([...each(':active', `${popup} `), ...each(':selected', `${popup} `), ...each(':checked', `${popup} `)], [
            ['background-color', activeBg],
            ['color', activeFg],
        ]),
        rule(`${popup} StEntry`, [['color', fg], ['caret-color', fg], ['border-color', sep]]),
        rule(`${popup} .hint-text`, [['color', fg === null ? null : withAlpha(fg, 0.6)]]),
        rule([`${popup} .spawn-separator`, `${popup} .popup-separator-menu-item-separator`], [
            ['background-color', sep],
            ['color', sep],
        ]),
    ];
}

export function buildCss(input: ThemeInput): string {
    const parts: string[] = [];
    parts.push(...accentRules(input.accent));
    parts.push(...buttonRules(input.buttonColors));
    if (input.override)
        parts.push(...overrideRules(input.colors));
    const rise = input.arrowRise;
    if (rise && rise[0])
        parts.push(rule(MENU_POPUP, [['-arrow-rise', `${num(rise[1], 0, 50, 4)}px`]]));
    const sr = input.searchEntryRadius;
    if (sr && sr[0])
        parts.push(rule('.spawn-search-box', [['border-radius', `${num(sr[1], 0, 60, 18)}px`]]));
    const css = parts.filter(p => p !== '').join('\n');
    return css === '' ? '' : `/* generated by Spawn; do not edit */\n${css}`;
}
