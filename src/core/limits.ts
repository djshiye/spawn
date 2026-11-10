// Sane bounds for the numeric settings a hand-edit (dconf-editor, a script) can push to absurd values: a huge
// panel button icon or padding takes over the top bar, an enormous app icon size leaves no room for a single
// pinned row. The schema has the same bounds as <range>s (GSettings then falls back to the default for a stored
// value outside them); the code clamps as well, because a dictionary value (icon-size-grid) has no range and
// because a clamp costs nothing.
//
// This module has no imports so it is usable from unit tests under gjs -m.
//
// Public API:
//   BUTTON_ICON_SIZE / BUTTON_PADDING / ICON_SIZE / GRID_ICON_SIZE   {min, max} bounds
//   clampInt(value, min, max, fallback): number    `value` rounded and limited to [min, max]; `fallback` for NaN
//   buttonIconSize(value): number                  panel button icon size, 8 to 64 px
//   buttonPadding(value): number                   panel button horizontal padding, -1 (theme default) or 0 to 64 px
//   iconSize(value, fallback): number              an icon-size-* setting: <= 0 means `fallback`, else at most 128 px
//   gridIconSize(value, fallback): number          the pinned grid's icon size: <= 0 means `fallback`, else 16 to 128 px

export const BUTTON_ICON_SIZE = {min: 8, max: 64} as const;
export const BUTTON_PADDING = {min: -1, max: 64} as const;
export const ICON_SIZE = {min: -1, max: 128} as const;
export const GRID_ICON_SIZE = {min: 16, max: 128} as const;

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function buttonIconSize(value: unknown): number {
    return clampInt(value, BUTTON_ICON_SIZE.min, BUTTON_ICON_SIZE.max, 20);
}

export function buttonPadding(value: unknown): number {
    const v = clampInt(value, BUTTON_PADDING.min, BUTTON_PADDING.max, -1);
    return v < 0 ? -1 : v;
}

export function iconSize(value: unknown, fallback: number): number {
    const v = clampInt(value, ICON_SIZE.min, ICON_SIZE.max, -1);
    return v > 0 ? v : fallback;
}

export function gridIconSize(value: unknown, fallback: number): number {
    const v = clampInt(value, -1, GRID_ICON_SIZE.max, -1);
    return v > 0 ? Math.max(GRID_ICON_SIZE.min, v) : fallback;
}
