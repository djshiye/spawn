// SearchBox: the search entry (search icon, clear button, hint text).
//
// The corner radius comes from the theme module (search-entry-border-radius), not from here.
// Key handling that must happen before the text widget sees it (Down/Up/Tab to leave the entry)
// is reported through `onNavigate`; Return through `onActivate`.
//
// Public API:
//   new SearchBox(scope: Scope, settings: SpawnSettings)
//   box.actor: St.Entry
//   box.text: string (get/set)
//   box.onTextChanged(scope, cb: (text: string) => void)
//   box.onActivate(scope, cb: () => void)                        Return pressed
//   box.onNavigate(scope, cb: (key: number, shift: boolean) => boolean)   Up/Down/Tab/Escape...;
//                                                                 return true when handled
//   box.focus(): void
//   box.hasFocus: boolean
//   box.insert(ch: string): void                                 insert at the cursor (type-to-search)
//   box.deleteBackward(): void
//   box.clear(): void
//   box.destroy()

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';

export class SearchBox {
    readonly actor: St.Entry;
    private readonly _textListeners = new Set<(text: string) => void>();
    private readonly _activateListeners = new Set<() => void>();
    private readonly _navListeners = new Set<(key: number, shift: boolean) => boolean>();
    private _silent = false;

    constructor(scope: Scope, _settings: SpawnSettings) {
        const clearIcon = new St.Icon({icon_name: 'edit-clear-symbolic', style_class: 'spawn-search-icon'});
        this.actor = new St.Entry({
            style_class: 'spawn-search-box',
            hint_text: 'Search apps, windows and files…',
            can_focus: true,
            track_hover: true,
            primary_icon: new St.Icon({icon_name: 'edit-find-symbolic', style_class: 'spawn-search-icon'}),
            secondary_icon: clearIcon,
            x_expand: true,
        });
        clearIcon.hide();

        const ct = this.actor.clutter_text;
        ct.connect('text-changed', () => {
            clearIcon.visible = ct.text.length > 0;
            if (this._silent)
                return;
            for (const cb of [...this._textListeners])
                cb(ct.text);
        });
        ct.connect('activate', () => {
            for (const cb of [...this._activateListeners])
                cb();
            return Clutter.EVENT_STOP;
        });
        ct.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            const key = event.get_key_symbol();
            const shift = Boolean(event.get_state() & Clutter.ModifierType.SHIFT_MASK);
            for (const cb of [...this._navListeners]) {
                if (cb(key, shift))
                    return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('secondary-icon-clicked', () => {
            this.clear();
            this.focus();
        });
        scope.add(() => this.actor.destroy(), 'SearchBox');
    }

    get text(): string {
        return this.actor.get_text();
    }

    set text(value: string) {
        this.actor.set_text(value);
    }

    get hasFocus(): boolean {
        return this.actor.clutter_text.has_key_focus();
    }

    onTextChanged(scope: Scope, cb: (text: string) => void): void {
        this._textListeners.add(cb);
        scope.add(() => this._textListeners.delete(cb), 'SearchBox text listener');
    }

    onActivate(scope: Scope, cb: () => void): void {
        this._activateListeners.add(cb);
        scope.add(() => this._activateListeners.delete(cb), 'SearchBox activate listener');
    }

    onNavigate(scope: Scope, cb: (key: number, shift: boolean) => boolean): void {
        this._navListeners.add(cb);
        scope.add(() => this._navListeners.delete(cb), 'SearchBox nav listener');
    }

    focus(): void {
        this.actor.clutter_text.grab_key_focus();
    }

    insert(ch: string): void {
        this.focus();
        const ct = this.actor.clutter_text;
        ct.insert_unichar(ch);
    }

    deleteBackward(): void {
        this.focus();
        const ct = this.actor.clutter_text;
        const len = ct.text.length;
        if (len > 0)
            ct.delete_text(len - 1, len);
    }

    /** Set the text without notifying listeners. */
    setSilently(text: string): void {
        this._silent = true;
        try {
            this.actor.set_text(text);
        } finally {
            this._silent = false;
        }
    }

    clear(): void {
        this.actor.set_text('');
    }

    destroy(): void {
        this.actor.destroy();
    }
}
