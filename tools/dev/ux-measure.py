#!/usr/bin/env python3
"""UX audit numbers from a Ui.Dump JSON (see tools/dev/scenarios/ui-ux-measure.sh).

usage: ux-measure.py <dump.json> [--check]

Prints the measurements of the UX audit (pointer-target sizes, edges, gaps, avatar, folder plate,
popup/panel gap) and, with --check, exits 1 when a target of the audit is missed."""
import json
import sys

d = json.load(open(sys.argv[1]))
check = "--check" in sys.argv
items = d["items"]


def has(it, cls):
    return cls in it.get("cls", "").split()


def find(cls):
    return [i for i in items if has(i, cls)]


def first(cls):
    f = find(cls)
    return f[0] if f else None


def after(it, type_prefix, cls=None):
    k = items.index(it)
    for j in items[k + 1:]:
        if j["d"] <= it["d"]:
            return None
        if j["type"].startswith(type_prefix) and (cls is None or has(j, cls)):
            return j
    return None


def dim(it):
    return None if it is None else f'{it["w"]:g}x{it["h"]:g}'


rows = []
fails = []


def row(name, got, target, ok=True):
    rows.append((name, got, target, "ok" if ok else "FAIL"))
    if not ok:
        fails.append(name)


menu = d.get("menu")
layout = d.get("layout")
anchor = d.get("anchor")
left = first("spawn-left-pane")
right = first("spawn-right-pane")
row("popup (boxpointer) x,y / w x h", menu and f"{menu[0]:g},{menu[1]:g} / {menu[2]:g}x{menu[3]:g}", "-")
row("layout w x h", layout and f"{layout[2]:g}x{layout[3]:g}", "-")
if left and right:
    row("left / right pane width", f'{left["w"]:g} / {right["w"]:g}', ">=420 / >=180", left["w"] >= 420 and right["w"] >= 180)

# --- target sizes (>= 32 px high)
for label, cls, minh in [("shortcut row", "spawn-shortcut-row", 32), ("nav button (All Apps/Back)", "spawn-nav-button", 32),
                         ("power button", "spawn-power-button", 32), ("category row", "spawn-category-row", 32),
                         ("result row", "spawn-result-row", 32), ("user card", "spawn-user-card", 32)]:
    its = find(cls)
    if its:
        hs = sorted({i["h"] for i in its})
        ws = sorted({i["w"] for i in its})
        row(f"{label} size", f"{ws[0]:g}..{ws[-1]:g} x {hs[0]:g}..{hs[-1]:g}", f">= {minh} high", hs[0] >= minh)
# a power button is a transparent hit area (padding = the gap to its neighbours and the pane edge) around
# its visible .spawn-power-surface; the geometry below is the visible one
pbo = [i for i in find("spawn-power-button") if i["w"] > 0]
pb = [after(i, "St_", "spawn-power-surface") for i in pbo]
pb = [s for s in pb if s]
if len(pb) >= 2:
    row("power button width", f'{pb[0]["w"]:g}', ">= 40", pb[0]["w"] >= 40)
    gaps = [round(b["x"] - (a["x"] + a["w"]), 1) for a, b in zip(pb, pb[1:])]
    row("power gaps (px)", gaps, ">= 8 everywhere", all(g >= 8 for g in gaps))
    dest = [i for i in pbo if has(i, "spawn-power-destructive")]
    if dest and len(pb) > len(dest):
        far = pb[len(pb) - len(dest)]["x"] - (pb[len(pb) - len(dest) - 1]["x"] + pb[0]["w"])
        row("harmless -> destructive gap", f"{far:g}", ">= 48", far >= 48)
    if right:
        row("destructive pair flush right", f'{(right["x"] + right["w"]) - (pb[-1]["x"] + pb[-1]["w"]):g} px from pane edge',
            "= the pane's 8 px (the button's own transparent padding)", abs((right["x"] + right["w"]) - (pb[-1]["x"] + pb[-1]["w"]) - 8) <= 1)
    # no dead pixel: the hit areas touch each other (but for the flexible spacer) and reach both pane edges
    hg = [round(b["x"] - (a["x"] + a["w"]), 1) for a, b in zip(pbo, pbo[1:])]
    row("power hit areas touch (spacer excepted)", hg, "0 everywhere but at most one spacer", sum(1 for g in hg if g > 0.5) <= 1)
    if right:
        row("power hit areas reach the pane edges", f'{pbo[0]["x"] - right["x"]:g} / {(right["x"] + right["w"]) - (pbo[-1]["x"] + pbo[-1]["w"]):g}',
            "0 / 0", abs(pbo[0]["x"] - right["x"]) <= 0.5 and abs((right["x"] + right["w"]) - (pbo[-1]["x"] + pbo[-1]["w"])) <= 0.5)

# --- avatar
av = first("spawn-avatar")
card = first("spawn-card-surface")
if av and card:
    row("avatar / card", f'{dim(av)} / {dim(card)}', "40x40 / h 56", av["w"] == 40 and card["h"] <= 60)

# --- bottom row baseline: search entry centre == power button centre
sb = first("spawn-search-box")
if sb and pb:
    c1 = sb["y"] + sb["h"] / 2
    c2 = pb[0]["y"] + pb[0]["h"] / 2
    row("search centre y / power centre y", f"{c1:g} / {c2:g}", "equal (+-1)", abs(c1 - c2) <= 1)

# --- left edges
if left and sb:
    edge = left["x"] + 8
    row("search entry left edge (pane edge)", f'{sb["x"]:g}', f"{edge:g}", abs(sb["x"] - edge) <= 0.5)
    glyph = after(sb, "St_Icon") or first("spawn-search-icon")
    nav = first("spawn-nav-surface")
    nav_icon = after(nav, "St_Icon") if nav else None
    title = first("spawn-section-title")
    vals = {"search glyph": glyph and glyph["x"] + glyph["pad"][3]}
    if nav:
        vals["nav button edge"] = nav["x"]
    if nav_icon:
        vals["nav icon"] = nav_icon["x"] + nav_icon["pad"][3]
    if title:
        vals["section title text"] = title["x"] + title["pad"][3]
    inset = {k: v for k, v in vals.items() if v is not None}
    row("left-pane x: " + ", ".join(f"{k} {v:g}" for k, v in inset.items()), "", "edge, then one inset (12)",
        all(abs(v - edge - 12) <= 1.5 for k, v in inset.items() if k in ("search glyph", "nav icon", "section title text")) and
        abs(inset.get("nav button edge", edge) - edge) <= 0.5)

# --- grid symmetry (the visible tile is the .spawn-tile-surface inside the transparent .spawn-tile button)
outer_tiles = [i for i in find("spawn-tile") if i["w"] > 0]
tiles = [i for i in find("spawn-tile-surface") if i["w"] > 0]
icons = find("spawn-tile-icon")
if left and tiles:
    ys = sorted({round(i["y"]) for i in tiles})
    row0 = [i for i in tiles if round(i["y"]) == ys[0]]
    li = row0[0]["x"] - left["x"]
    ri = (left["x"] + left["w"]) - (row0[-1]["x"] + row0[-1]["w"])
    # the first and last tile cell are equally far from the pane edges => so are their (centred) icons
    row("pinned first-tile inset / last-tile inset (%d columns)" % len(row0), f"{li:g} / {ri:g}", "equal (+-2)", abs(li - ri) <= 2)
    t = tiles[0]
    row("tile size / icon / label font", f'{dim(t)} / {icons[0]["w"]:g} / {first("spawn-tile-label")["fs"]:.2f}', "87 high @ 1-line labels", t["h"] == 87)
    # no dead zone: the transparent buttons around the tiles touch (4 + 4 px of the 8 px gap each, 8 px gutters at the ends)
    rows_y = sorted({round(i["y"]) for i in outer_tiles})
    ok = all(abs(b - (a + max(i["h"] for i in outer_tiles if round(i["y"]) == a))) <= 0.5 for a, b in zip(rows_y, rows_y[1:]))
    row("pinned tile hit areas touch (no vertical gap)", "touch" if ok else "gap", "0 px between rows", ok)

# --- pinned list (pinned-apps-display = List): full-width rows, 32 px targets, icon on the 12 px inset
# (the visible row is the .spawn-row-surface inside the transparent, full-width .spawn-pinned-row button)
hits = [i for i in find("spawn-pinned-row") if i["w"] > 0]
prows = [after(i, "St_", "spawn-row-surface") for i in hits]
prows = [i for i in prows if i and i["w"] > 0]
if left and prows:
    hs = sorted({i["h"] for i in prows})
    row("pinned row size", f'{prows[0]["w"]:g} x {hs[0]:g}..{hs[-1]:g}', ">= 32 high", hs[0] >= 32)
    edge = left["x"] + 8
    row("pinned row left edge", f'{prows[0]["x"]:g}', f"{edge:g}", abs(prows[0]["x"] - edge) <= 0.5)
    ic = after(prows[0], "St_Icon")
    if ic:
        row("pinned row icon inset", f'{ic["x"] - prows[0]["x"]:g}', "12 (= section title text inset)", abs(ic["x"] - prows[0]["x"] - 12) <= 1.5)
    gaps = [round(b["y"] - (a["y"] + a["h"]), 1) for a, b in zip(prows, prows[1:])]
    row("pinned row pitch (gap px)", sorted(set(gaps)) or "-", "1 everywhere (as the right pane)", all(abs(g - 1) <= 0.5 for g in gaps))
    # no dead zone: the transparent buttons around the rows touch each other and span the pane width
    hgaps = [round(b["y"] - (a["y"] + a["h"]), 1) for a, b in zip(hits, hits[1:])]
    row("pinned row hit areas (gap px between buttons)", sorted(set(hgaps)) or "-", "0 everywhere (no dead pixel between rows)", all(abs(g) <= 0.5 for g in hgaps))
    right_gap = (left["x"] + left["w"]) - (hits[0]["x"] + hits[0]["w"])
    row("pinned row hit area vs pane width", f'{hits[0]["x"] - left["x"]:g} in, {right_gap:g} short on the right', "full pane width (0 in, 0 short)", abs(right_gap) <= 0.5 and abs(hits[0]["x"] - left["x"]) <= 0.5)

# --- folder plate (48 px on a grid tile, row-icon sized in a list row)
plate = first("spawn-folder-plate")
if plate and not prows:
    mini = first("spawn-folder-mini")
    row("folder plate / mini icon", f'{dim(plate)} / {dim(mini)}', "48x48 / 16x16", plate["w"] == 48 and plate["h"] == 48 and (mini is None or (mini["w"] == 16 and mini["h"] == 16)))
elif plate:
    mini = first("spawn-folder-mini")
    row("folder plate / mini icon (list)", f'{dim(plate)} / {dim(mini)}', "square, mini = (plate - 6) / 2 (padding 2) or (plate - 10) / 2 (padding 4, Large)", plate["w"] == plate["h"] and (mini is None or min(abs(mini["w"] * 2 + 6 - plate["w"]), abs(mini["w"] * 2 + 10 - plate["w"])) <= 1))

# --- type scale
sizes = sorted({round(i["fs"], 2) for i in items if i.get("fs") and (i["type"].startswith("St_Label"))})
row("label font sizes", sizes, "<= 4 sizes + search", len(sizes) <= 5)

# --- popup / panel gap
if menu and anchor:
    if d["side"] == 2:
        gap = anchor[1] - (menu[1] + menu[3])
        row("popup -> panel gap (bottom panel)", f"{gap:g}", "~= top-panel gap", True)
    else:
        row("panel -> popup gap (top panel)", f"{menu[1] - (anchor[1] + anchor[3]):g}", "-", True)
    row("popup inside monitor", "", "all edges inside", menu[0] >= 0 and menu[1] >= 0 and menu[0] + menu[2] <= d["monitor"][2] and menu[1] + menu[3] <= d["monitor"][3])

w = max(len(r[0]) for r in rows)
for name, got, target, ok in rows:
    print(f"{ok:4} {name:<{w}}  {got}  [target {target}]")
sys.exit(1 if (check and fails) else 0)
