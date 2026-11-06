// Theme: accent colour + optional custom colours -> a stylesheet.
//
// Responsibility: default look = shell theme (Orchis) classes plus the GNOME accent colour
// (org.gnome.desktop.interface accent-color, read-only). When `override-menu-theme` is true
// the colour keys are layered on top. The CSS is written SYNCHRONOUSLY to
// $XDG_RUNTIME_DIR/spawn/<token>/theme.css (a fresh <token> directory per Theme instance,
// i.e. per enable, so a late unload of a previous instance can never touch our file), loaded
// with St.ThemeContext theme.load_stylesheet and unloaded (and the file removed) before every
// reload and on dispose. Re-generated on settings changes, debounced. No async file creation
// anywhere, so dispose cannot race a pending write.
//
// Public API:
//   new Theme(scope, settings)
//   theme.start(): void            write + load; idempotent; follows settings live
//   theme.cssPath: string | null   path of the generated file once written
//                                  (start() also sweeps theme dirs left behind by crashed sessions)
//   buildCss(input: ThemeInput): string   PURE; unit-tested (tests/theme.test.js, implemented in theme/css.ts)
//   accentColor(name: string): string     PURE; GNOME accent name -> css colour (blue default)
//   sanitizeColor(value: string): string | null   PURE; null when `value` is not a safe colour
//   withAlpha(color: string, alpha: number): string  PURE; best effort alpha for #hex/rgb()/rgba()
//   ThemeInput: {accent, override, colors, buttonColors, searchEntryRadius?, arrowRise?}
//   (presets.ts, imported directly: pure helpers for the `menu-themes` presets)
//
// Selectors styled (all through generated rules; stylesheet.css stays structural):
//   Always (accent only):
//     .spawn-row (folder header) / the faces of every other item (.spawn-tile:focus .spawn-tile-surface, .spawn-pinned-row:focus .spawn-row-surface,
//     likewise list / category / result / shortcut rows, user card, nav and power buttons)
//        :focus  -> accent at 25 % alpha;  :active / :selected / :checked -> accent + white text
//     .spawn-search-box:focus -> accent border
//     .spawn-drop-target      -> accent border + accent 20 % background (drag & drop)
//     .spawn-accent           -> accent text colour (small indicators, "new" dots, ...)
//   Panel button (each only when its (bs)/(bi) tuple is enabled, independent of override):
//     #panel .panel-button.spawn-button            fg, bg, border radius/width/colour
//     #panel .panel-button.spawn-button:hover, :focus   hover bg / fg
//     #panel .panel-button.spawn-button:active, :checked (+ :hover)  active bg / fg
//     (the `#panel` prefix is needed to outrank the shell theme, and matches both GNOME's panel
//     and Dash to Panel's panels; hover/active backgrounds replace the theme's inset box-shadow)
//   Only when `override-menu-theme` is true:
//     .spawn-popup                          arrow colours, font size, foreground
//     .spawn-popup .popup-menu-content      background, border, radius
//     .spawn-popup .spawn-folder-popup      background, foreground, border colour (the folder popup card)
//     the item selectors above                   hover/focus + active colours
//     .spawn-popup StEntry / .hint-text     foreground, separator colour as border
//     .spawn-separator, .spawn-popup .popup-separator-menu-item-separator  separators
//   Optional (`searchEntryRadius` enabled): .spawn-search-box border-radius.
//   Optional (`arrowRise` enabled, independent of override): .spawn-menu-popup { -arrow-rise } (the main
//   popup only; ui/menu.ts adds the class), which moves the menu away from / towards the panel.
//   Colour values from settings are validated by sanitizeColor; an invalid colour drops its
//   rule instead of breaking the stylesheet.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {debounce} from '../core/debounce.js';
import {error, log, warn} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SettingKey, SpawnSettings} from '../core/settings.js';
import {accentColor, buildCss, type ThemeInput} from './css.js';

export {
    ACCENT_COLORS, ACCENT_FG, accentColor, buildCss, sanitizeColor, withAlpha,
    type ButtonColors, type ThemeColors, type ThemeInput,
} from './css.js';

// ---- runtime ----

const THEME_KEYS: SettingKey[] = [
    'override-menu-theme', 'menu-background-color', 'menu-foreground-color', 'menu-border-color',
    'menu-border-width', 'menu-border-radius', 'menu-font-size', 'menu-separator-color',
    'menu-item-hover-bg-color', 'menu-item-hover-fg-color', 'menu-item-active-bg-color',
    'menu-item-active-fg-color', 'menu-arrow-rise', 'menu-button-fg-color', 'menu-button-bg-color',
    'menu-button-border-radius', 'menu-button-border-width', 'menu-button-border-color',
    'menu-button-hover-bg-color', 'menu-button-hover-fg-color', 'menu-button-active-bg-color',
    'menu-button-active-fg-color', 'search-entry-border-radius',
];

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const REGEN_DEBOUNCE_MS = 100;

export class Theme {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _token = GLib.uuid_string_random().slice(0, 8);
    private _cssPath: string | null = null;
    private _loadedFile: Gio.File | null = null;
    private _interface: Gio.Settings | null = null;
    private _started = false;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._scope = scope;
        this._settings = settings;
        scope.add(() => this._dispose(), 'Theme');
    }

    get cssPath(): string | null {
        return this._cssPath;
    }

    start(): void {
        if (this._started)
            return;
        this._started = true;

        const regen = debounce(this._scope, REGEN_DEBOUNCE_MS, () => this._reload());
        this._settings.onChanged(this._scope, THEME_KEYS, () => regen.call());

        try {
            const source = Gio.SettingsSchemaSource.get_default();
            if (source?.lookup(INTERFACE_SCHEMA, true)?.has_key('accent-color')) {
                this._interface = new Gio.Settings({schema_id: INTERFACE_SCHEMA});
                this._scope.connect(this._interface, 'changed::accent-color', () => regen.call());
            }
        } catch (e) {
            warn('cannot watch the GNOME accent colour', e);
        }

        this._sweepStale();
        this._reload();
    }

    /**
     * Removes `$XDG_RUNTIME_DIR/spawn/<other token>/theme.css` leftovers of a shell that crashed
     * before its dispose ran. Every normal path removes its own dir, and the previous instance of
     * this session is already disposed when a new Theme starts, so any other token is stale.
     */
    private _sweepStale(): void {
        try {
            const parent = GLib.path_get_dirname(this._dir());
            const dir = Gio.File.new_for_path(parent);
            if (!dir.query_exists(null))
                return;
            const children = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            for (let info = children.next_file(null); info; info = children.next_file(null)) {
                const name = info.get_name();
                if (name === this._token || info.get_file_type() !== Gio.FileType.DIRECTORY)
                    continue;
                const stale = GLib.build_filenamev([parent, name]);
                GLib.unlink(GLib.build_filenamev([stale, 'theme.css']));
                GLib.rmdir(stale);
            }
            children.close(null);
        } catch (e) {
            warn('cannot sweep stale theme directories', e);
        }
    }

    private _input(): ThemeInput {
        const s = this._settings;
        let accent = 'blue';
        try {
            accent = this._interface?.get_string('accent-color') ?? 'blue';
        } catch {
            accent = 'blue';
        }
        return {
            accent: accentColor(accent),
            override: s.get('override-menu-theme'),
            colors: {
                background: s.get('menu-background-color'),
                foreground: s.get('menu-foreground-color'),
                border: s.get('menu-border-color'),
                borderWidth: s.get('menu-border-width'),
                borderRadius: s.get('menu-border-radius'),
                fontSize: s.get('menu-font-size'),
                separator: s.get('menu-separator-color'),
                itemHoverBg: s.get('menu-item-hover-bg-color'),
                itemHoverFg: s.get('menu-item-hover-fg-color'),
                itemActiveBg: s.get('menu-item-active-bg-color'),
                itemActiveFg: s.get('menu-item-active-fg-color'),
            },
            buttonColors: {
                fg: s.get('menu-button-fg-color'),
                bg: s.get('menu-button-bg-color'),
                borderRadius: s.get('menu-button-border-radius'),
                borderWidth: s.get('menu-button-border-width'),
                borderColor: s.get('menu-button-border-color'),
                hoverBg: s.get('menu-button-hover-bg-color'),
                hoverFg: s.get('menu-button-hover-fg-color'),
                activeBg: s.get('menu-button-active-bg-color'),
                activeFg: s.get('menu-button-active-fg-color'),
            },
            searchEntryRadius: s.get('search-entry-border-radius'),
            arrowRise: s.get('menu-arrow-rise'),
        };
    }

    private _dir(): string {
        return GLib.build_filenamev([GLib.get_user_runtime_dir(), 'spawn', this._token]);
    }

    private _theme(): St.Theme | null {
        return St.ThemeContext.get_for_stage(global.stage as never).get_theme();
    }

    /** Unload the current stylesheet and delete its file. Never throws. */
    private _unload(): void {
        const file = this._loadedFile;
        this._loadedFile = null;
        if (file) {
            try {
                this._theme()?.unload_stylesheet(file);
            } catch (e) {
                warn('unload_stylesheet failed', e);
            }
        }
        const path = this._cssPath;
        this._cssPath = null;
        if (path) {
            try {
                GLib.unlink(path);
            } catch {
                // already gone
            }
        }
    }

    private _reload(): void {
        try {
            this._unload();
            const css = buildCss(this._input());
            if (css === '')
                return;
            const dir = this._dir();
            GLib.mkdir_with_parents(dir, 0o700);
            const path = GLib.build_filenamev([dir, 'theme.css']);
            GLib.file_set_contents(path, css);
            this._cssPath = path;
            const file = Gio.File.new_for_path(path);
            const theme = this._theme();
            if (!theme)
                throw new Error('no St theme');
            theme.load_stylesheet(file);
            this._loadedFile = file;
            log(`theme loaded: ${path}`);
        } catch (e) {
            error('theme reload failed', e);
        }
    }

    private _dispose(): void {
        this._started = false;
        this._unload();
        // Remove our (now empty) directory and the parent if nobody else uses it.
        const dir = this._dir();
        GLib.rmdir(dir);
        GLib.rmdir(GLib.path_get_dirname(dir));
        log('theme unloaded');
    }
}
