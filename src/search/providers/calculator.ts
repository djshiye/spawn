// CalculatorProvider ('calculator') and UnitConversionProvider ('conversion'): answers typed into the search box.
//
// "2+2", "15% of 80", "sqrt(16)" show one result "= 4" (title: the answer, description: the expression);
// "5 km in miles" shows "= 3.106856 mi". Return / click copies the answer to the clipboard (CLIPBOARD, not
// PRIMARY) and, like every result, closes the menu. The maths is src/search/calc.ts and units.ts (pure, no
// eval). Both providers are in memory, cheap and answer on every keystroke; each is switched off by its
// setting (search-calculator / search-unit-conversion, on by default). A plain number, a constant or a
// name never triggers the calculator, so "2048" still finds apps.
//
// Public API:
//   new CalculatorProvider(settings: SpawnSettings)        implements SearchProvider
//   new UnitConversionProvider(settings: SpawnSettings)    implements SearchProvider
//   copyToClipboard(text)                                  St.Clipboard CLIPBOARD

import Gio from 'gi://Gio';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {SpawnSettings} from '../../core/settings.js';
import {calculate} from '../calc.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {convertText} from '../units.js';

const ANSWER_SCORE = 1000;

export function copyToClipboard(text: string): void {
    try {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    } catch (e) {
        error('copying to the clipboard failed', e);
    }
}

function answer(providerId: string, id: string, shown: string, copied: string, description: string, iconName: string): SearchResult[] {
    return [{
        id,
        providerId,
        title: `= ${shown}`,
        description,
        alwaysShowDescription: true,
        plainTitle: true,
        icon: new Gio.ThemedIcon({name: iconName}),
        score: ANSWER_SCORE,
        activate: () => copyToClipboard(copied),
    }];
}

export class CalculatorProvider implements SearchProvider {
    readonly id = 'calculator';
    readonly title = _('Calculator');
    readonly immediate = true;

    constructor(private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-calculator');
    }

    search(query: string, _token: CancelToken): SearchResult[] {
        const r = calculate(query.trim());
        if (!r)
            return [];
        return answer(this.id, 'calc', r.text, r.text, query.trim(), 'accessories-calculator-symbolic');
    }
}

export class UnitConversionProvider implements SearchProvider {
    readonly id = 'conversion';
    readonly title = _('Conversion');
    readonly immediate = true;

    constructor(private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-unit-conversion');
    }

    search(query: string, _token: CancelToken): SearchResult[] {
        const r = convertText(query);
        if (!r)
            return [];
        return answer(this.id, 'convert', r.text, r.text, `${r.from} \u2192 ${r.unit}`, 'accessories-calculator-symbolic');
    }
}
