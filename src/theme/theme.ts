// Theme: accent colour + optional custom colours -> a stylesheet. STUB: signatures are final.
//
// Responsibility: default look = shell theme (Orchis) classes plus the GNOME accent colour
// (org.gnome.desktop.interface accent-color, read-only). When `override-menu-theme` is true
// the colour keys are layered on top. The CSS is written SYNCHRONOUSLY to
// $XDG_RUNTIME_DIR/spawn-menu/theme.css, loaded with St.ThemeContext theme.load_stylesheet and
// unloaded (and the file removed) on dispose. Re-generated on settings changes, debounced.
//
// Public API:
//   new Theme(scope, settings)
//   theme.start(): void            write + load; idempotent; follows settings live
//   theme.cssPath: string | null   path of the generated file once written
//   buildCss(input: ThemeInput): string   PURE; unit-tested (tests/theme.test.js)
//   ThemeInput: {accent: string, override: boolean, colors: ThemeColors, buttonColors: ButtonColors}

import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';

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
}

export function buildCss(_input: ThemeInput): string {
    // TODO(theme owner)
    return '';
}

export class Theme {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private _cssPath: string | null = null;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._scope = scope;
        this._settings = settings;
    }

    get cssPath(): string | null {
        return this._cssPath;
    }

    start(): void {
        // TODO(theme owner)
        void this._scope;
        void this._settings;
    }
}
