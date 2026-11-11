// SearchSession: the glue between the search box and a ResultList that the menu layout and the runner share.
//
// Responsibility: run one query at a time against `Services.search` and feed its batches to a ResultList
// (a stale batch of a superseded query is dropped), flush the debounced query on demand, and remember
// "Return was pressed before the first row arrived" so that the result is activated as soon as it
// arrives. What each caller does around that (views, key handling, the empty-query case) stays with the
// caller; only the parts that were identical in SpawnLayout and SpawnRunner live here.
//
// Public API:
//   new SearchSession(scope, search, {activateWaitMs, isDead, logPrefix?})
//   session.cancel()                       drop the running query (its late batches are ignored)
//   session.start(query, results)          run `query`, batches go to `results.addBatch`
//   session.flush()                        run the pending (debounced) query now; never throws
//   session.activate(results, ctrl?)      Return: flush, activate the highlighted result, else arm the wait
//   session.arm(on, ctrl?)                 arm / disarm "activate when the first row arrives"
//   - activateWaitMs: how long an armed Return waits (a provider answering long after "No results" showed
//     must not launch something the user never saw)
//   - isDead(): the owner is gone (destroyed / disposed): batches are ignored
//   - logPrefix: prepended to the log messages ('runner ' in the runner)

import type {Scope} from '../core/scope.js';
import {error} from '../core/log.js';
import type {Services} from '../core/services.js';
import type {SearchHandle} from '../search/engine.js';
import type {ResultList} from './widgets/resultList.js';

export interface SearchSessionOptions {
    activateWaitMs: number;
    isDead(): boolean;
    logPrefix?: string;
}

export class SearchSession {
    private readonly _scope: Scope;
    private readonly _search: Services['search'];
    private readonly _opts: SearchSessionOptions;
    private _handle: SearchHandle | null = null;
    private _token = 0;
    /** Return was pressed before the first batch of the query arrived: activate it when it does. */
    private _activateWhenReady = false;
    /** ... and it was Ctrl+Return. */
    private _activateCtrl = false;
    private _cancelWait: (() => void) | null = null;

    constructor(scope: Scope, search: Services['search'], opts: SearchSessionOptions) {
        this._scope = scope;
        this._search = search;
        this._opts = opts;
    }

    cancel(): void {
        this._token++;
        this._handle?.cancel();
        this._handle = null;
    }

    start(query: string, results: ResultList): void {
        const token = this._token;
        try {
            this._handle = this._search.search(query, batch => {
                if (token !== this._token || this._opts.isDead())
                    return;
                results.addBatch(batch);
                if (this._activateWhenReady && results.first()) {
                    const ctrl = this._activateCtrl;
                    this.arm(false);
                    results.activateSelected(ctrl);
                }
            });
        } catch (e) {
            error(`${this._opts.logPrefix ?? ''}search failed`, e);
        }
    }

    flush(): void {
        try {
            this._handle?.flush();
        } catch (e) {
            error(`${this._opts.logPrefix ?? ''}search flush failed`, e);
        }
    }

    /**
     * Return: activate the highlighted result of the CURRENT query (the first one until a key / the pointer
     * moved the highlight). Typing and pressing Return inside the debounce window must not do nothing:
     * flush the pending query (synchronous providers deliver before flush() returns); if slower providers
     * still owe the first row, activate it as soon as it arrives. `ctrl`: as a Ctrl+click on the row.
     */
    activate(results: ResultList, ctrl = false): void {
        this.flush();
        if (!results.activateSelected(ctrl))
            this.arm(true, ctrl);
    }

    /** "Return was pressed before the first row arrived". Expires after `activateWaitMs`. */
    arm(on: boolean, ctrl = false): void {
        this._cancelWait?.();
        this._cancelWait = null;
        this._activateWhenReady = on;
        this._activateCtrl = on && ctrl;
        if (on) {
            this._cancelWait = this._scope.timeout(this._opts.activateWaitMs, () => {
                this._cancelWait = null;
                this._activateWhenReady = false;
            });
        }
    }
}
