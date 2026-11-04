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

const ITEM = ['.spawn-menu-tile', '.spawn-menu-row', '.spawn-menu-shortcut-row', '.spawn-menu-folder-tile'];
const each = (suffix: string, scope = ''): string[] => ITEM.map(s => `${scope}${s}${suffix}`);

// The shell theme nests panel-button rules under `#panel` (specificity 1,1,0 and up), and both
// GNOME's panel and Dash to Panel's panels are named 'panel', so our rules must carry the
// same prefix to win. Hover/active feedback in the theme is an inset box-shadow overlay, not a
// background colour, so those states override box-shadow (a solid colour covers the overlay).
const BUTTON = '#panel .panel-button.spawn-menu-button';

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
        rule(each(':focus'), [
            ['background-color', withAlpha(a, 0.25)],
        ]),
        rule([...each(':active'), ...each(':selected'), ...each(':checked')], [
            ['background-color', a],
            ['color', ACCENT_FG],
        ]),
        rule('.spawn-menu-search-box:focus', [['border-color', a]]),
        rule('.spawn-menu-drop-target', [
            ['background-color', withAlpha(a, 0.2)],
            ['border', `2px solid ${a}`],
        ]),
        rule('.spawn-menu-accent', [['color', a]]),
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
    const popup = '.spawn-menu-popup';
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
        rule(each(':hover', `${popup} `), [['background-color', hoverBg], ['color', hoverFg]]),
        rule(each(':focus', `${popup} `), [['background-color', hoverBg], ['color', hoverFg]]),
        rule([...each(':active', `${popup} `), ...each(':selected', `${popup} `), ...each(':checked', `${popup} `)], [
            ['background-color', activeBg],
            ['color', activeFg],
        ]),
        rule(`${popup} StEntry`, [['color', fg], ['caret-color', fg], ['border-color', sep]]),
        rule(`${popup} .hint-text`, [['color', fg === null ? null : withAlpha(fg, 0.55)]]),
        rule([`${popup} .spawn-menu-separator`, `${popup} .popup-separator-menu-item-separator`], [
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
    const sr = input.searchEntryRadius;
    if (sr && sr[0])
        parts.push(rule('.spawn-menu-search-box', [['border-radius', `${num(sr[1], 0, 60, 18)}px`]]));
    const css = parts.filter(p => p !== '').join('\n');
    return css === '' ? '' : `/* generated by Spawn Menu; do not edit */\n${css}`;
}
