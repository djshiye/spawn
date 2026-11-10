// In-shell benchmark behind the dev D-Bus method io.github.djshiye.Spawn.Dev.Benchmark(s sections).
// Only reachable while `dev-mode` is true. Times everything with GLib.get_monotonic_time() inside
// the shell process, so D-Bus / gdbus latency is not part of any number.
//
//   sections: comma separated subset of  enable,index,open,search   ("all" = every section)
//     enable  enable() duration (measured by extension.ts, passed in) plus per-subsystem split
//     index   AppIndex.build() on a FRESH instance: first (cold) build and the median of 5 more, without
//             and with the search keys (searchEntries(), which build() defers to an idle)
//     open    popup open -> actor mapped (the synchronous open() call) and -> first frame painted
//             ('after-paint' on the stage): the first open of the session as it is (layout
//             prebuilt on idle), 3 opens with the layout dropped and rebuilt (the lazy path;
//             AppIndex / PinnedStore stay warm), then 20 steady-state opens
//     search  engine.search(q, ..., {immediate: true}) for ~10 queries x 5 repetitions: time from
//             the call to the apps batch (= apps only) and to the last provider batch (= all
//             enabled providers); the 80 ms keystroke debounce is bypassed (it is a fixed cost)
//     leaks   (only when named, not part of "all") open the menu, type a query letter by letter, close;
//             LEAK_CYCLES times after LEAK_WARMUP warm-up cycles. Reports the stage's actor count and
//             the shell's RSS (after a GC) before and after, so a growing actor tree or memory shows up
//   The sections below are also only run when named (tools/dev/scenarios/bench.sh names them):
//     allapps the All Apps view on a fresh layout: its first show (showView('all') -> painted), later shows in
//             the same open and after a close / reopen, a visit of every category, a refresh (AppIndex rebuilt
//             as after an app install, All Apps showing), and the popup's actor count / the shell's RSS
//             (after a GC) with the menu open, after All Apps, after every category and a few seconds after
//             the close
//     typing  open the menu and type words letter by letter (TYPING_GAP_MS apart, a quick typist): per key the
//             time from the keystroke (popup.search(prefix)) to the frame painted after the apps results
//             reached the list, debounce included (end to end, what the user waits for)
//     recent  the recent-files provider (search-provider-recent-files on, a large recently-used.xbel): per menu
//             open the first key and two later keys, keystroke -> recent-files rows painted (debounce
//             included), plus the provider's own time (its search() call until its results are ready)
//     mem     the stage's actor count and the shell's RSS after a GC (bench.sh samples it around a
//             disable / enable soak)
//
// Public API:
//   runBenchmark(ctx: BenchContext, sections: string): Promise<BenchResult>

import type Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import type St from 'gi://St';
import System from 'system';

import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import {AppIndex} from '../model/appIndex.js';
import type {SearchBatch, SearchEngine} from '../search/engine.js';
import type {SpawnPopup} from '../ui/menu.js';

export interface BenchContext {
    scope: Scope;
    services: Services;
    popup: SpawnPopup;
    anchor(): St.Widget | null;
    /** enable() duration and its per-subsystem split, in ms (recorded by extension.ts). */
    enable: {totalMs: number; subsystems: Record<string, number>};
}

export type BenchResult = Record<string, unknown>;

export interface Stats {
    n: number;
    median: number;
    p95: number;
    min: number;
    max: number;
    mean: number;
}

const QUERIES = ['f', 'fi', 'fir', 'fire', 'vsc', 'term', 'set', 'st', 'zz', 'doc'];
const SEARCH_REPS = 5;
const OPEN_REPS = 20;
const REBUILD_REPS = 3;
const TIMEOUT_MS = 3000;
const LEAK_WARMUP = 5;
const LEAK_CYCLES = 30;
const LEAK_QUERY = 'firefox';
const SHOW_REPS = 5;
const REFRESH_REPS = 3;
const TYPING_WORDS = ['firefox', 'terminal', 'settings', 'calculator'];
const TYPING_GAP_MS = 150;
const RECENT_OPENS = 5;
const RECENT_QUERY = 'report';

const nowMs = (): number => GLib.get_monotonic_time() / 1000;
const round = (v: number): number => Math.round(v * 1000) / 1000;

export function stats(values: number[]): Stats {
    const v = [...values].sort((a, b) => a - b);
    const n = v.length;
    if (n === 0)
        return {n: 0, median: 0, p95: 0, min: 0, max: 0, mean: 0};
    const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
    const p95 = v[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
    return {n, median: round(median), p95: round(p95), min: round(v[0]), max: round(v[n - 1]), mean: round(v.reduce((a, b) => a + b, 0) / n)};
}

function countActors(actor: Clutter.Actor): number {
    let n = 1;
    for (const child of actor.get_children())
        n += countActors(child);
    return n;
}

/** A field of /proc/self/status of the shell process in KiB (0 when /proc is unreadable). */
function statusKiB(field = 'VmRSS'): number {
    try {
        const [ok, bytes] = GLib.file_get_contents('/proc/self/status');
        const m = ok ? new RegExp(`${field}:\\s+(\\d+)`).exec(new TextDecoder().decode(bytes)) : null;
        return m ? Number(m[1]) : 0;
    } catch {
        return 0;
    }
}

const rssKiB = (): number => statusKiB('VmRSS');

/** Dev only: AppIndex's rebuild + change notification (what an app install triggers after its debounce). */
function rebuildIndex(services: Services): void {
    (services.appIndex as unknown as {_rebuildAndNotify(): void})._rebuildAndNotify();
}

function findByClass(root: Clutter.Actor, styleClass: string): St.Widget[] {
    const out: St.Widget[] = [];
    const walk = (a: Clutter.Actor) => {
        if ((a as St.Widget).has_style_class_name?.(styleClass))
            out.push(a as St.Widget);
        for (const c of a.get_children())
            walk(c);
    };
    walk(root);
    return out;
}

export async function runBenchmark(ctx: BenchContext, sections: string): Promise<BenchResult> {
    const wanted = new Set(sections.split(',').map(s => s.trim()).filter(Boolean));
    const all = wanted.size === 0 || wanted.has('all');
    const has = (name: string): boolean => all || wanted.has(name);
    const result: BenchResult = {};

    const sleep = (ms: number) => new Promise<void>(resolve => ctx.scope.timeout(ms, resolve));
    const settle = async () => {
        ctx.popup.close();
        for (let i = 0; i < 100 && ctx.popup.isOpen; i++)
            await sleep(10);
        await sleep(350); // close animation
    };

    const measureOpen = async (): Promise<{callMs: number; paintMs: number; mapped: boolean} | null> => {
        const anchor = ctx.anchor();
        if (!anchor)
            return null;
        let paintedAt = 0;
        let wake: () => void = () => {};
        const painted = new Promise<void>(resolve => {
            wake = resolve;
        });
        const own = ctx.scope.child('bench-open'); // owns the signal connection and the timeout
        own.connect(global.stage, 'after-paint', () => {
            if (!paintedAt) {
                paintedAt = nowMs();
                wake();
            }
        });
        own.timeout(TIMEOUT_MS, wake);
        const t0 = nowMs();
        ctx.popup.open(anchor);
        const t1 = nowMs();
        const mapped = ctx.popup.isOpen;
        await painted;
        own.dispose();
        return {callMs: t1 - t0, paintMs: paintedAt ? paintedAt - t0 : NaN, mapped};
    };

    const summarize = (samples: Array<{callMs: number; paintMs: number}>) => ({
        openCallMs: stats(samples.map(s => s.callMs)),
        paintedMs: stats(samples.map(s => s.paintMs).filter(Number.isFinite)),
    });

    if (has('enable'))
        result.enable = {totalMs: round(ctx.enable.totalMs), subsystemsMs: ctx.enable.subsystems};

    if (has('index')) {
        const builds: number[] = [];
        const withKeys: number[] = [];
        let apps = 0;
        for (let i = 0; i < 6; i++) {
            const scope = ctx.scope.child(`bench-index-${i}`);
            const index = new AppIndex(scope);
            const t0 = nowMs();
            index.build();
            const t1 = nowMs();
            index.searchEntries(); // the search keys (built on an idle after build(), or by the first search)
            builds.push(t1 - t0);
            withKeys.push(nowMs() - t0);
            apps = index.apps().length;
            scope.dispose();
        }
        result.appIndex = {
            apps,
            coldBuildMs: round(builds[0]),
            warmBuildMs: stats(builds.slice(1)),
            coldBuildWithSearchKeysMs: round(withKeys[0]),
            warmBuildWithSearchKeysMs: stats(withKeys.slice(1)),
        };
    }

    if (has('open')) {
        const open: Record<string, unknown> = {};
        // A first open only counts when the popup is closed, so close it (and say so) if it is not.
        open.popupWasOpenAtStart = ctx.popup.isOpen;
        if (ctx.popup.isOpen)
            await settle();
        const layoutWasBuilt = ctx.popup.layoutBuilt;
        const first = await measureOpen();
        if (first) {
            open.firstOpenOfSession = {layoutPrebuilt: layoutWasBuilt, openCallMs: round(first.callMs), paintedMs: round(first.paintMs), mapped: first.mapped};
            await settle();
        }

        const rebuilt: Array<{callMs: number; paintMs: number}> = [];
        for (let i = 0; i < REBUILD_REPS; i++) {
            ctx.popup.resetLayout();
            const s = await measureOpen();
            if (s)
                rebuilt.push(s);
            await settle();
        }
        open.layoutRebuilt = {note: 'layout dropped before each open; AppIndex and PinnedStore warm', ...summarize(rebuilt)};

        const steady: Array<{callMs: number; paintMs: number}> = [];
        for (let i = 0; i < OPEN_REPS; i++) {
            const s = await measureOpen();
            if (s)
                steady.push(s);
            await settle();
        }
        open.steadyState = summarize(steady);
        result.open = open;
    }

    if (wanted.has('leaks')) {
        const anchor = ctx.anchor();
        if (anchor) {
            if (ctx.popup.isOpen)
                await settle();
            const cycle = async () => {
                ctx.popup.open(anchor);
                await sleep(150);
                for (let i = 1; i <= LEAK_QUERY.length; i++) {
                    ctx.popup.search(LEAK_QUERY.slice(0, i));
                    await sleep(120); // past the 80 ms debounce: every prefix really runs
                }
                ctx.popup.search('');
                await settle();
            };
            const sample = async () => {
                System.gc();
                await sleep(500);
                return {stageActors: countActors(global.stage), rssKiB: rssKiB()};
            };
            for (let i = 0; i < LEAK_WARMUP; i++)
                await cycle();
            const before = await sample();
            for (let i = 0; i < LEAK_CYCLES; i++)
                await cycle();
            const after = await sample();
            result.leaks = {
                cycles: LEAK_CYCLES,
                query: LEAK_QUERY,
                before,
                after,
                stageActorsDelta: after.stageActors - before.stageActors,
                rssDeltaKiB: after.rssKiB - before.rssKiB,
            };
        } else {
            result.leaks = {error: 'no panel button to open the menu from'};
        }
    }

    // ---- sections only run when named ----

    const sample = async (actorsOf: Clutter.Actor | null = null) => {
        System.gc();
        await sleep(400);
        System.gc();
        await sleep(100);
        return {
            stageActors: countActors(global.stage),
            menuActors: actorsOf ? countActors(actorsOf) : 0,
            rssKiB: rssKiB(),
            // anonymous memory (heap: JS, GObjects, malloc) vs file / shared mappings (GPU buffers, fonts)
            rssAnonKiB: statusKiB('RssAnon'),
            rssFileKiB: statusKiB('RssFile'),
            rssShmemKiB: statusKiB('RssShmem'),
        };
    };

    /** Run `fn`, then wait for the next frame: callMs = fn's own time (blocked), paintMs = until after-paint. */
    const measure = async (fn: () => void): Promise<{callMs: number; paintMs: number}> => {
        let paintedAt = 0;
        let wake: () => void = () => {};
        const painted = new Promise<void>(resolve => {
            wake = resolve;
        });
        const own = ctx.scope.child('bench-measure');
        const t0 = nowMs();
        fn();
        const t1 = nowMs();
        own.connect(global.stage, 'after-paint', () => {
            if (!paintedAt) {
                paintedAt = nowMs();
                wake();
            }
        });
        global.stage.queue_redraw();
        own.timeout(TIMEOUT_MS, wake);
        await painted;
        own.dispose();
        return {callMs: t1 - t0, paintMs: paintedAt ? paintedAt - t0 : NaN};
    };

    const reopen = async (resetLayout: boolean): Promise<boolean> => {
        if (ctx.popup.isOpen)
            await settle();
        if (resetLayout)
            ctx.popup.resetLayout();
        if (!await measureOpen())
            return false;
        await sleep(400);
        return ctx.popup.isOpen;
    };

    if (wanted.has('allapps')) {
        const r: Record<string, unknown> = {};
        if (!await reopen(true)) {
            r.error = 'no panel button to open the menu from';
        } else {
            const menu = () => ctx.popup.menuActor;
            r.apps = ctx.services.appIndex.apps().length;
            ctx.popup.showView('pinned');
            r.memOpen = await sample(menu());
            const first = await measure(() => ctx.popup.showView('all'));
            r.firstShow = {callMs: round(first.callMs), paintedMs: round(first.paintMs)};
            await sleep(1500); // whatever is built after the first frame
            r.memAllApps = await sample(menu());

            const sameOpen: Array<{callMs: number; paintMs: number}> = [];
            for (let i = 0; i < SHOW_REPS; i++) {
                ctx.popup.showView('pinned');
                await sleep(300);
                sameOpen.push(await measure(() => ctx.popup.showView('all')));
                await sleep(600);
            }
            r.laterShowSameOpen = summarize(sameOpen);

            const reopened: Array<{callMs: number; paintMs: number}> = [];
            for (let i = 0; i < SHOW_REPS; i++) {
                await reopen(false);
                ctx.popup.showView('pinned');
                await sleep(200);
                reopened.push(await measure(() => ctx.popup.showView('all')));
                await sleep(600);
            }
            r.laterShowAfterReopen = summarize(reopened);

            // every category of the category view, one after the other (focus selects a category)
            ctx.popup.showView('categories');
            await sleep(600);
            const buttons = findByClass(menu() as Clutter.Actor, 'spawn-category-row');
            const visits: Array<{callMs: number; paintMs: number}> = [];
            for (const b of buttons) {
                visits.push(await measure(() => b.grab_key_focus()));
                await sleep(250);
            }
            r.categories = buttons.length;
            r.categoryVisit = summarize(visits);
            await sleep(1000);
            r.memEveryCategory = await sample(menu());

            // refresh with All Apps showing (an app installed / removed)
            ctx.popup.showView('all');
            await sleep(1500);
            const refresh: Array<{callMs: number; paintMs: number}> = [];
            for (let i = 0; i < REFRESH_REPS; i++) {
                refresh.push(await measure(() => rebuildIndex(ctx.services)));
                await sleep(1500);
            }
            r.refreshAllAppsShowing = summarize(refresh);

            await settle();
            await sleep(3000);
            r.memClosed = await sample(menu());
        }
        result.allApps = r;
    }

    // Dev only: spy on the engine's batches (when did a provider's results reach the list?).
    type SearchFn = SearchEngine['search'];
    const withBatchSpy = async (spy: (batch: SearchBatch) => void, body: () => Promise<void>): Promise<void> => {
        const engine = ctx.services.search;
        const original: SearchFn = engine.search;
        const patched: SearchFn = (query, onBatch, options) => original.call(engine, query, (batch: SearchBatch) => {
            onBatch(batch);
            spy(batch);
        }, options);
        (engine as {search: SearchFn}).search = patched;
        try {
            await body();
        } finally {
            delete (engine as Partial<{search: SearchFn}>).search; // the prototype's method again
        }
    };

    /** popup.search(text), then wait for the frame painted after `providerId`'s batch for `text` arrived. */
    const keyToPaint = (text: string, providerId: string, delivered: Set<string>): Promise<{ms: number; ok: boolean}> => {
        return new Promise(resolve => {
            const own = ctx.scope.child('bench-key');
            const key = `${providerId}\u0000${text}`;
            let done = false;
            const finish = (ok: boolean) => {
                if (done)
                    return;
                done = true;
                const ms = nowMs() - t0;
                own.dispose();
                resolve({ms, ok});
            };
            // after-paint of a frame that started after the batch was added (layout and paint include its rows)
            let armed = false;
            own.connect(global.stage, 'before-paint', () => {
                armed ||= delivered.has(key);
            });
            own.connect(global.stage, 'after-paint', () => {
                if (armed)
                    finish(true);
            });
            own.timeout(TIMEOUT_MS, () => finish(false));
            const t0 = nowMs();
            ctx.popup.search(text);
        });
    };

    if (wanted.has('typing')) {
        const r: Record<string, unknown> = {};
        if (!await reopen(false)) {
            r.error = 'no panel button to open the menu from';
        } else {
            const delivered = new Set<string>();
            const perKey: number[] = [];
            let missed = 0;
            await withBatchSpy(b => delivered.add(`${b.providerId}\u0000${b.query}`), async () => {
                for (const word of TYPING_WORDS) {
                    for (let i = 1; i <= word.length; i++) {
                        const k = await keyToPaint(word.slice(0, i), 'apps', delivered);
                        if (k.ok)
                            perKey.push(k.ms);
                        else
                            missed++;
                        await sleep(Math.max(1, TYPING_GAP_MS - k.ms));
                    }
                    ctx.popup.search('');
                    delivered.clear();
                    await sleep(300);
                }
            });
            r.gapMs = TYPING_GAP_MS;
            r.words = TYPING_WORDS;
            r.keystrokeToAppsPaintedMs = stats(perKey);
            r.keysWithoutAppsBatch = missed;
            await settle();
        }
        result.typing = r;
    }

    if (wanted.has('recent')) {
        const r: Record<string, unknown> = {};
        const provider = ctx.services.recentFiles;
        if (!provider.isEnabled()) {
            r.error = 'search-provider-recent-files is off';
        } else {
            const delivered = new Set<string>();
            const firstKey: number[] = [];
            const laterKey: number[] = [];
            const providerMs: number[] = [];
            const rowCounts: number[] = [];
            let missed = 0;
            type ProviderSearch = typeof provider.search;
            const original: ProviderSearch = provider.search;
            const timed: ProviderSearch = (query, token) => {
                const t0 = nowMs();
                const out = original.call(provider, query, token);
                if (out instanceof Promise)
                    out.then(() => providerMs.push(nowMs() - t0), () => {});
                else
                    providerMs.push(nowMs() - t0);
                return out;
            };
            (provider as {search: ProviderSearch}).search = timed;
            try {
                await withBatchSpy(b => {
                    delivered.add(`${b.providerId}\u0000${b.query}`);
                    if (b.providerId === 'recentFiles')
                        rowCounts.push(b.results.length);
                }, async () => {
                    for (let o = 0; o < RECENT_OPENS; o++) {
                        if (!await reopen(false))
                            break;
                        for (let i = 1; i <= 3; i++) {
                            const k = await keyToPaint(RECENT_QUERY.slice(0, i), 'recentFiles', delivered);
                            if (!k.ok)
                                missed++;
                            else if (i === 1)
                                firstKey.push(k.ms);
                            else
                                laterKey.push(k.ms);
                            await sleep(250);
                        }
                        delivered.clear();
                        ctx.popup.search('');
                        await settle();
                        await sleep(300);
                    }
                });
            } finally {
                delete (provider as Partial<{search: ProviderSearch}>).search;
            }
            r.opens = RECENT_OPENS;
            r.query = RECENT_QUERY;
            r.firstKeyToPaintedMs = stats(firstKey);
            r.firstKeySamplesMs = firstKey.map(round);
            r.laterKeySamplesMs = laterKey.map(round);
            r.laterKeyToPaintedMs = stats(laterKey);
            r.providerMs = stats(providerMs);
            r.rowsPerBatch = stats(rowCounts);
            r.keysWithoutBatch = missed;
        }
        result.recent = r;
    }

    if (wanted.has('mem')) {
        if (ctx.popup.isOpen)
            await settle();
        result.mem = await sample();
    }

    if (has('search')) {
        const engine = ctx.services.search;
        const providers = engine.enabledProviders().map(p => p.id);
        const run = async (query: string): Promise<{appsMs: number; allMs: number; timedOut: boolean; perProvider: Record<string, number>}> => {
            const expected = engine.enabledProviders().length;
            const seen: Record<string, number> = {};
            let wake: () => void = () => {};
            const done = new Promise<void>(resolve => {
                wake = resolve;
            });
            const t0 = nowMs();
            let last = t0;
            engine.search(query, (batch: SearchBatch) => {
                last = nowMs();
                seen[batch.providerId] = last - t0;
                if (Object.keys(seen).length >= expected)
                    wake();
            }, {immediate: true});
            const cancel = ctx.scope.timeout(TIMEOUT_MS, wake);
            await done;
            cancel();
            const timedOut = Object.keys(seen).length < expected;
            return {appsMs: seen['apps'] ?? NaN, allMs: last - t0, timedOut, perProvider: seen};
        };

        // Warm-up: caches (recent files, shell provider list) and the JIT.
        for (const q of ['fi', 'set', 'doc'])
            await run(q);
        if (providers.some(id => id.startsWith('shell:')) || ctx.services.settings.get('search-provider-shell'))
            await sleep(1500);
        const warmProviders = engine.enabledProviders().map(p => p.id);

        const perQuery: Record<string, unknown> = {};
        const appsAll: number[] = [];
        const allAll: number[] = [];
        const perProviderAll: Record<string, number[]> = {};
        let timeouts = 0;
        for (const q of QUERIES) {
            const apps: number[] = [];
            const total: number[] = [];
            for (let i = 0; i < SEARCH_REPS; i++) {
                const r = await run(q);
                if (r.timedOut)
                    timeouts++;
                if (Number.isFinite(r.appsMs))
                    apps.push(r.appsMs);
                total.push(r.allMs);
                for (const [id, ms] of Object.entries(r.perProvider))
                    (perProviderAll[id] ??= []).push(ms);
            }
            appsAll.push(...apps);
            allAll.push(...total);
            perQuery[q] = {appsOnlyMs: stats(apps), allProvidersMs: stats(total)};
        }
        const perProvider: Record<string, Stats> = {};
        for (const [id, v] of Object.entries(perProviderAll))
            perProvider[id] = stats(v);
        result.search = {
            providers: warmProviders,
            repsPerQuery: SEARCH_REPS,
            debounceBypassed: true,
            timeouts,
            appsOnlyMs: stats(appsAll),
            allProvidersMs: stats(allAll),
            perProviderMs: perProvider,
            perQuery,
        };
    }

    return result;
}
