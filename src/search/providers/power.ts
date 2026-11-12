// PowerActionsProvider ('power'): the power actions of the power bar, found by typing their name or a synonym.
//
// "lock", "log out" / "logout" / "sign out", "suspend" / "sleep", "restart" / "reboot", "power off" / "shut down",
// "switch user", "hibernate", "hybrid sleep", "firmware" show the matching actions with the names and symbolic icons
// of the power buttons (ui/widgets/powerActions.ts POWER_INFO). The match is on word prefixes of the name and of
// the synonyms with at least 3 typed characters (search/powerKeywords.ts), so "re" shows nothing and "res" shows
// Restart. Activating a result runs runPowerAction(), the very function the power bar's buttons call, so the
// confirmation (the shell's end-session dialog, Spawn's firmware dialog) is the one of the button and nothing is
// bypassed; the menu / runner has already closed by then (ResultList), which runPowerAction's own close
// is then a no-op for.
//
// Only the actions the system allows are offered, whichever buttons the user shows in the bar: the same checks
// as the power bar (SystemActions can-* and the one-off logind probe for hibernate, hybrid sleep and firmware;
// dev builds with their test switch on show them all, as the bar does in the headless test shell). The logind probe runs on
// the first query and again after the menu was closed (clear()), so a query typed before its answer simply
// does not offer those three yet.
//
// Off by default: search-power-actions. Immediate (in memory). Takes part in the best match (search/bestMatch.ts).
//
// Public API:
//   new PowerActionsProvider(scope: Scope, settings: SpawnSettings)   implements SearchProvider

import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PowerType} from '../../core/constants.js';
import {isDevMode} from '../../core/flavour.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import {isPowerAvailable, type LogindInfo, POWER_INFO, POWER_RANK, probeLogind, runPowerAction} from '../../ui/widgets/powerActions.js';
import type {CancelToken, SearchProvider, SearchResult} from '../engine.js';
import {maxSearchResults} from '../limit.js';
import {matchPower, POWER_SYNONYMS} from '../powerKeywords.js';

const KEYS: Record<number, string> = {
    [PowerType.LOCK]: 'lock',
    [PowerType.LOGOUT]: 'logout',
    [PowerType.RESTART]: 'restart',
    [PowerType.POWER_OFF]: 'poweroff',
    [PowerType.SUSPEND]: 'suspend',
    [PowerType.HYBRID_SLEEP]: 'hybridSleep',
    [PowerType.HIBERNATE]: 'hibernate',
    [PowerType.SWITCH_USER]: 'switchUser',
    [PowerType.FIRMWARE]: 'firmware',
};

/** English names, matched even when the interface is translated. */
const ENGLISH: Record<number, string> = {
    [PowerType.LOCK]: 'lock',
    [PowerType.LOGOUT]: 'log out',
    [PowerType.RESTART]: 'restart',
    [PowerType.POWER_OFF]: 'power off',
    [PowerType.SUSPEND]: 'suspend',
    [PowerType.HYBRID_SLEEP]: 'hybrid sleep',
    [PowerType.HIBERNATE]: 'hibernate',
    [PowerType.SWITCH_USER]: 'switch user',
    [PowerType.FIRMWARE]: 'restart to firmware setup',
};

interface Entry {
    type: number;
    name: string;
    synonyms: readonly string[];
}

export class PowerActionsProvider implements SearchProvider {
    readonly id = 'power';
    readonly title = _('Power');
    readonly immediate = true;

    private _logind: LogindInfo | null = null;
    private _probing = false;

    constructor(private readonly _scope: Scope, private readonly _settings: SpawnSettings) {}

    isEnabled(): boolean {
        return this._settings.get('search-power-actions');
    }

    clear(): void {
        this._logind = null;
    }

    search(query: string, token: CancelToken): SearchResult[] {
        this._probe();
        const dev = isDevMode(this._settings);
        const entries: Entry[] = POWER_RANK.filter(t => POWER_INFO[t] && KEYS[t] && (dev || isPowerAvailable(t, this._logind)))
            .map(type => ({type, name: POWER_INFO[type].name, synonyms: [ENGLISH[type], ...(POWER_SYNONYMS[KEYS[type]] ?? [])]}));
        const matches = matchPower(query, entries).slice(0, maxSearchResults(this._settings));
        if (token.cancelled)
            return [];
        return matches.map(({item, score}) => ({
            id: KEYS[item.type],
            providerId: this.id,
            title: item.name,
            icon: new Gio.ThemedIcon({name: POWER_INFO[item.type].icon}),
            plainTitle: false,
            score,
            activate: () => runPowerAction(item.type, {close: () => {}}, this._scope),
        }));
    }

    private _probe(): void {
        if (this._logind || this._probing)
            return;
        this._probing = true;
        probeLogind().then(info => {
            this._logind = info;
        }).catch(e => error('logind probe failed', e)).finally(() => {
            this._probing = false;
        });
    }
}
