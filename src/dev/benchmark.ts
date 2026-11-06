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
import type {SearchBatch} from '../search/engine.js';
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

/** VmRSS of the shell process in KiB (0 when /proc is unreadable). */
function rssKiB(): number {
    try {
        const [ok, bytes] = GLib.file_get_contents('/proc/self/status');
        const m = ok ? /VmRSS:\s+(\d+)/.exec(new TextDecoder().decode(bytes)) : null;
        return m ? Number(m[1]) : 0;
    } catch {
        return 0;
    }
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
