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
