// SmartAnswersProvider ('answers'): offline answers typed into the search box, next to the calculator and the
// unit conversion (providers/calculator.ts), plus the helpers every answer-like provider shares.
//
// One query is offered to the answer modules in turn and the first that recognises it wins (each rejects
// ordinary text in well under a microsecond; see src/search/answers/*.ts for the accepted text):
//   network     "192.168.1.0/24", "10.0.0.5 255.255.255.0", "/26", "2001:db8::/48", an address, a MAC address
//   bases       "0xFF", "255 in binary", "hex 255", "ascii A"
//   colours     "#3584e4", "rgb(53, 132, 228)", "colour rebeccapurple" (the row icon is a sample of the colour)
//   time zones  "time in tokyo", "3pm london in tokyo" (12 / 24 hour follows the desktop's clock format)
//   dates       "days until 25 dec", "today + 90 days", "week number", "unix time"
// An answer can be several rows (a subnet: network, host range, mask, broadcast, host count, wildcard), at most
// ANSWER_ROWS (search/bestMatch.ts). Return / click copies the row's value to the clipboard and closes the menu, as for the calculator.
// Everything is computed in memory from the typed text and the computer's own clock and time zone data: no
// network access, no subprocess. Answers keep the top of the list (search/bestMatch.ts ANSWER_PROVIDERS).
//
// On by default: search-smart-answers. Immediate.
//
// Public API:
//   new SmartAnswersProvider(settings: SpawnSettings)        implements SearchProvider
//   answerResults(providerId, answers, score?): SearchResult[]   rows for Answer[] (copy on activate; a colour
//                                                            sample or a glyph as the icon)
//   themedIcon(name): Gio.Icon                               one shared Gio.ThemedIcon per name

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import {baseAnswers} from '../answers/bases.js';
import {colourAnswers} from '../answers/colours.js';
import {dateAnswers} from '../answers/dates.js';
import {networkAnswers} from '../answers/network.js';
import {timeAnswers} from '../answers/timezones.js';
import type {Answer} from '../answers/types.js';
import {ANSWER_ROWS} from '../bestMatch.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {copyToClipboard} from './calculator.js';

const ANSWER_SCORE = 1000;

const icons = new Map<string, Gio.Icon>();

export function themedIcon(name: string): Gio.Icon {
    let icon = icons.get(name);
    if (!icon) {
        icon = new Gio.ThemedIcon({name});
        icons.set(name, icon);
    }
    return icon;
}

/** A rounded sample of `colour` ("#rrggbb", validated by the colour module) the size of a row icon. */
function swatchIcon(colour: string, size: number): St.Widget {
    const safe = /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#808080';
    return new St.Widget({
        style_class: 'spawn-answer-swatch',
        style: `background-color: ${safe}; width: ${size}px; height: ${size}px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/** An emoji or a character drawn where the row icon goes. */
function glyphIcon(glyph: string, size: number): St.Widget {
    return new St.Label({
        style_class: 'spawn-answer-glyph',
        style: `font-size: ${Math.round(size * 0.72)}px; width: ${size}px; height: ${size}px;`,
        text: glyph,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

export function answerResults(providerId: string, answers: readonly Answer[], score = ANSWER_SCORE): SearchResult[] {
    const out: SearchResult[] = [];
    for (const a of answers) {
        const result: SearchResult = {
            id: a.id,
            providerId,
            title: a.title,
            description: a.description,
            alwaysShowDescription: true,
            plainTitle: true,
            icon: themedIcon(a.icon),
            score: a.score ?? score,
            activate: () => {
                if (a.copy)
                    copyToClipboard(a.copy);
            },
        };
        const {swatch, glyph} = a;
        if (swatch)
            result.createIcon = size => swatchIcon(swatch, size);
        else if (glyph)
            result.createIcon = size => glyphIcon(glyph, size);
        out.push(result);
    }
    return out;
}

export class SmartAnswersProvider implements SearchProvider {
    readonly id = 'answers';
    readonly title = _('Answers');
    readonly immediate = true;

    private _clock: Gio.Settings | null | undefined;

    constructor(private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-smart-answers');
    }

    search(query: string, _token: CancelToken): SearchResult[] {
        const text = query.trim();
        let answers = networkAnswers(text);
        if (answers.length === 0)
            answers = baseAnswers(text);
        if (answers.length === 0)
            answers = colourAnswers(text);
        if (answers.length === 0)
            answers = timeAnswers(text, {hour12: this._hour12()});
        if (answers.length === 0)
            answers = dateAnswers(text);
        if (answers.length === 0)
            return [];
        return answerResults(this.id, answers.slice(0, ANSWER_ROWS));
    }

    /** The desktop's clock format; read only when a time is about to be shown. */
    private _hour12(): boolean {
        if (this._clock === undefined) {
            try {
                this._clock = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            } catch (e) {
                error('cannot read the clock format', e);
                this._clock = null;
            }
        }
        try {
            return this._clock?.get_string('clock-format') === '12h';
        } catch {
            return false;
        }
    }
}
