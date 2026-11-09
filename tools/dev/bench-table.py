#!/usr/bin/env python3
"""Prints the table for tools/dev/scenarios/bench.sh from the merged benchmark JSON (argv[1])."""
import json
import sys

d = json.load(open(sys.argv[1]))
meta = d.get("meta", {})


def row(label, st, note=""):
    if not st or not st.get("n"):
        print(f"  {label:<46} {'n/a':>9}")
        return
    print(f"  {label:<46} {st['median']:>9.2f} {st['p95']:>9.2f} {st['min']:>9.2f} {st['max']:>9.2f}  n={st['n']} {note}")


print()
print("Spawn benchmark (times in ms, measured inside the shell with GLib.get_monotonic_time())")
print(f"  renderer: {meta.get('gpu', '?')}  monitor: {meta.get('monitor', '?')}  apps in index: {d.get('appIndex', {}).get('apps', '?')}")
print("  NOTE: the headless shell renders with the real GPU (renderD128), so paint numbers are meaningful,")
print("        but a virtual monitor has no scanout/vsync, so 'painted' ends at the stage's after-paint.")
print()
print(f"  {'':<46} {'median':>9} {'p95':>9} {'min':>9} {'max':>9}")

e = d.get("enable")
if e:
    print(f"  {'enable() total':<46} {e['totalMs']:>9.2f}   split: " + ", ".join(f"{k} {v:.2f}" for k, v in e["subsystemsMs"].items()))

a = d.get("appIndex")
if a:
    print(f"  {'AppIndex.build() cold (1st fresh instance)':<46} {a['coldBuildMs']:>9.2f}   ({a['apps']} apps)")
    row("AppIndex.build() fresh instance, 5 more", a["warmBuildMs"])
    if "coldBuildWithSearchKeysMs" in a:
        print(f"  {'AppIndex.build() + search keys, cold':<46} {a['coldBuildWithSearchKeysMs']:>9.2f}")
        row("AppIndex.build() + search keys, 5 more", a["warmBuildWithSearchKeysMs"])

o = d.get("open")
if o:
    f = o["firstOpenOfSession"]
    print(f"  {'open #1 of session: open() call':<46} {f['openCallMs']:>9.2f}   (layout prebuilt on idle: {f['layoutPrebuilt']})")
    print(f"  {'open #1 of session: -> first frame painted':<46} {f['paintedMs']:>9.2f}")
    r = o["layoutRebuilt"]
    row("open, layout rebuilt lazily: open() call", r["openCallMs"])
    row("open, layout rebuilt lazily: -> painted", r["paintedMs"])
    s = o["steadyState"]
    row("open, steady state: open() call", s["openCallMs"])
    row("open, steady state: -> first frame painted", s["paintedMs"])

s = d.get("search")
if s:
    print()
    print(f"  search, providers: {', '.join(s['providers'])}   (80 ms keystroke debounce NOT included)")
    row("apps provider only, all queries", s["appsOnlyMs"])
    row("all enabled providers, all queries", s["allProvidersMs"])
    for pid, st in s["perProviderMs"].items():
        row(f"  batch delivered by {pid}", st)
    print("  per query (median / p95 for all enabled providers):")
    for q, v in s["perQuery"].items():
        st, ap = v["allProvidersMs"], v["appsOnlyMs"]
        print(f"    {q!r:<8} apps {ap['median']:>7.2f} / {ap['p95']:>7.2f}    all {st['median']:>7.2f} / {st['p95']:>7.2f}")
    if s.get("timeouts"):
        print(f"  WARNING: {s['timeouts']} query runs timed out waiting for a provider")

s2 = d.get("searchAllProviders")
if s2:
    print()
    print(f"  search, providers: {', '.join(s2['providers'])}   (GNOME Shell providers: " + ("included" if any(p.startswith("shell:") for p in s2["providers"]) else "not measured, set SPAWN_BENCH_SHELL=1") + ")")
    row("apps provider only, all queries", s2["appsOnlyMs"])
    row("all enabled providers, all queries", s2["allProvidersMs"])
    for pid, st in s2["perProviderMs"].items():
        row(f"  batch delivered by {pid}", st)
    for q, v in s2["perQuery"].items():
        st, ap = v["allProvidersMs"], v["appsOnlyMs"]
        print(f"    {q!r:<8} apps {ap['median']:>7.2f} / {ap['p95']:>7.2f}    all {st['median']:>7.2f} / {st['p95']:>7.2f}")
    if s2.get("timeouts"):
        print(f"  WARNING: {s2['timeouts']} query runs timed out waiting for a provider")

lk = d.get("leaks")
if lk:
    print()
    if "error" in lk:
        print(f"  leak check: {lk['error']}")
    else:
        b, a = lk["before"], lk["after"]
        print(f"  leak check: {lk['cycles']} cycles of open, type {lk['query']!r} letter by letter, close")
        print(f"  {'stage actors before -> after':<46} {b['stageActors']:>9} -> {a['stageActors']}   (delta {lk['stageActorsDelta']:+d})")
        print(f"  {'shell RSS KiB before -> after (after GC)':<46} {b['rssKiB']:>9} -> {a['rssKiB']}   (delta {lk['rssDeltaKiB']:+d})")

aa = d.get("allApps")
if aa:
    print()
    if "error" in aa:
        print(f"  All Apps: {aa['error']}")
    else:
        print(f"  All Apps ({aa['apps']} apps, {aa.get('categories', '?')} categories; times in ms)")
        f = aa["firstShow"]
        print(f"  {'All Apps first show: blocked':<46} {f['callMs']:>9.2f}")
        print(f"  {'All Apps first show: -> painted':<46} {f['paintedMs']:>9.2f}")
        for key, label in (("laterShowSameOpen", "later show, same open"), ("laterShowAfterReopen", "later show, after close / reopen"),
                           ("categoryVisit", "category selected"), ("refreshAllAppsShowing", "refresh (app installed), showing")):
            v = aa.get(key)
            if v:
                row(f"{label}: blocked", v["openCallMs"])
                row(f"{label}: -> painted", v["paintedMs"])
        print(f"  {'popup actors / shell RSS MiB (after GC):':<46}")
        base = aa["memOpen"]["rssKiB"]
        for key, label in (("memOpen", "menu open, start view"), ("memAllApps", "after All Apps"),
                           ("memEveryCategory", "after every category"), ("memClosed", "closed, 3 s later")):
            m = aa.get(key)
            if m:
                split = ""
                if "rssAnonKiB" in m:
                    b0 = aa["memOpen"]
                    split = "   of which anon {:+.1f}, file {:+.1f}, shmem {:+.1f}".format(
                        *((m[k] - b0[k]) / 1024 for k in ("rssAnonKiB", "rssFileKiB", "rssShmemKiB")))
                print(f"    {label:<44} {m['menuActors']:>9} actors   RSS {m['rssKiB'] / 1024:>7.1f} MiB  ({(m['rssKiB'] - base) / 1024:+.1f}){split}")

ty = d.get("typing")
if ty:
    print()
    if "error" in ty:
        print(f"  typing: {ty['error']}")
    else:
        print(f"  typing: {', '.join(ty['words'])}, a key every {ty['gapMs']} ms; keystroke -> apps rows painted (debounce included)")
        row("per key, end to end", ty["keystrokeToAppsPaintedMs"])
        if ty.get("keysWithoutAppsBatch"):
            print(f"  WARNING: {ty['keysWithoutAppsBatch']} keys without an apps batch within the timeout")

rc = d.get("recent")
if rc:
    print()
    if "error" in rc:
        print(f"  recent files: {rc['error']}")
    else:
        print(f"  recent files (2000-entry recently-used.xbel), {rc['opens']} menu opens, query {rc['query']!r} typed; keystroke -> rows painted")
        row("first key after an open, end to end", rc["firstKeyToPaintedMs"])
        row("later keys, end to end", rc["laterKeyToPaintedMs"])
        row("provider search() until its results are ready", rc["providerMs"])
        if rc.get("rowsPerBatch", {}).get("n"):
            print(f"  {'rows per recent-files batch (median)':<46} {rc['rowsPerBatch']['median']:>9.0f}")
        if rc.get("keysWithoutBatch"):
            print(f"  WARNING: {rc['keysWithoutBatch']} keys without a recent-files batch within the timeout")

sk = d.get("soak")
if sk:
    b, a = sk["before"], sk["after"]
    print()
    print(f"  disable / enable soak: {sk['cycles']} cycles")
    print(f"  {'stage actors before -> after':<46} {b['stageActors']:>9} -> {a['stageActors']}   (delta {sk['stageActorsDelta']:+d})")
    print(f"  {'shell RSS KiB before -> after (after GC)':<46} {b['rssKiB']:>9} -> {a['rssKiB']}   (delta {sk['rssDeltaKiB']:+d})")
