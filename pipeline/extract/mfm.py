#!/usr/bin/env python3
"""extract/mfm.py — MFM site -> work/mfm.json (DATASET.md §4). Name-keyed, NO 40kdc lookup.

Ported from ~/sites/base/mfm-scrape-wargear.py: same RSC parsing (price-change
markers, scalar-row-safe raw_decode, root-row walk), same sanity gates. The
join half is gone: output is keyed by what MFM prints.

  { fetched, pages, units: { "<mfm faction slug>|<unit name as printed>":
      { points: [{cost, models, unit_count_min, unit_count_max}],
        items: { "<item name as printed>": pts } } },
    meta: { unitsPriced, wargearPriced, unmatchedRows, ... } }

`unmatchedRows` here means wargear rows whose unit header has no points row on
the same page (an orphan the builder cannot attach); the join to GDC/40kdc
datasheets is the builder's job, via aliases.json.

Usage: mfm.py [--out /work/work/mfm.json] [--cache-dir DIR] [--cache-hours 6]
Exit codes: 0 ok, 2 sanity gate failed, 3 fetch/parse hard failure.
"""
import argparse, json, os, re, sys, time, urllib.request

sys.setrecursionlimit(100000)  # RSC trees are deep; walked recursively

UA = ("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0")
BASE = "https://mfm.warhammer-community.com/en"

# MFM page slugs (titan legions intentionally absent).
FACTION_PAGES = [
    "adepta-sororitas", "adeptus-custodes", "adeptus-mechanicus", "aeldari",
    "astra-militarum", "black-templars", "blood-angels", "chaos-daemons",
    "chaos-knights", "chaos-space-marines", "dark-angels", "death-guard",
    "deathwatch", "drukhari", "emperors-children", "genestealer-cults",
    "grey-knights", "imperial-agents", "imperial-knights", "leagues-of-votann",
    "necrons", "orks", "space-marines", "space-wolves", "tau-empire",
    "thousand-sons", "tyranids", "world-eaters",
]

def fetch(slug, cache_dir=None, cache_hours=6.0, retries=3):
    path = cache_dir and os.path.join(cache_dir, slug + ".html")
    if path and os.path.exists(path) and os.path.getsize(path) > 10000 \
       and (time.time() - os.path.getmtime(path)) < cache_hours * 3600:
        return open(path, encoding="utf-8", errors="replace").read()
    req = urllib.request.Request(f"{BASE}/{slug}", headers={"User-Agent": UA})
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                body = r.read().decode("utf-8", errors="replace")
            if len(body) < 10000:
                raise RuntimeError(f"suspiciously small page ({len(body)} bytes)")
            if path:
                os.makedirs(cache_dir, exist_ok=True)
                open(path, "w", encoding="utf-8").write(body)
            time.sleep(1.0)   # polite: one page a second at most
            return body
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"fetch {slug}: {last}")

# ── RSC payload parse ──────────────────────────────────────────────────────────
DECODER = json.JSONDecoder()
# "YOUR UNIT COSTS" / "YOUR 1ST TO 2ND UNITS COST" / "YOUR 3RD + UNIT COSTS" /
# "YOUR 1ST UNIT COSTS" / "YOUR 2ND + UNIT COSTS" → per-army-ordinal band.
BAND_RE = re.compile(
    r"^YOUR(?:\s+(\d+)(?:ST|ND|RD|TH))?(?:\s+TO\s+(\d+)(?:ST|ND|RD|TH))?"
    r"\s*(\+)?\s*UNITS?\s+COSTS?$")
MODELS_RE = re.compile(r"^(\d+)\s+models?$")
# Composition-string size rows ("1 Sword Brother, 4 Neophytes, 5 Initiates")
# — total model count is the sum of the leading integers.
COMP_ROW_RE = re.compile(r"^\d+\s+[^,\d]+(?:,\s*\d+\s+[^,\d]+)*$")
# Prices that moved in the most recent MFM update are rendered with a leading
# change marker — "▼ (-10) 65 pts", "▲ (+15) 275 pts". Anchoring on the digits
# silently DROPPED every changed price: a unit whose base band changed kept only
# its unchanged surcharge band (Rhino read 75, the 4th+ price, instead of 65),
# and a unit whose only band changed vanished from the output entirely
# (pointsUnits 982 → 833 after the 22 Jul update). Tolerate the marker.
PTS_RE = re.compile(
    r"^(?:[▲▼]+\s*(?:\([+\-−]?\d+\)\s*)?)?(\d+)\s*pts(\s*\(.*\))?$")

def parse_band(t):
    m = BAND_RE.match(t)
    if not m: return None
    lo, hi, plus = m.group(1), m.group(2), m.group(3)
    if lo is None: return (1, None)          # applies to every copy
    lo = int(lo)
    if hi is not None: return (lo, int(hi))  # "1ST TO 2ND"
    if plus: return (lo, None)               # "3RD +"
    return (lo, lo)                          # "1ST" exactly

def parse_page(html):
    """Extract deduped (unit_name, item_name, pts) wargear triples AND
    per-unit base-points bands from one MFM page.
    Returns (triples, points) where points is
    { unit_name: { (band_min, band_max|None): { models: pts } } }."""
    chunks = re.findall(r'__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    # Each chunk is a JS string literal — decode as JSON so \n/\"/\uXXXX
    # resolve AND real UTF-8 chars (curly apostrophes in "GAUNT'S GHOSTS")
    # survive. unicode_escape would mojibake them, breaking the all-caps
    # header check and the name join.
    def dec(c):
        try: return json.loads('"' + c + '"')
        except Exception: return c.encode().decode("unicode_escape", errors="replace")
    data = "".join(dec(c) for c in chunks)
    rows, order = {}, []
    # Find each row's start, then let the JSON decoder tell us where it ends.
    # Delimiting on "next row that starts with [ / { / \"" instead loses any row
    # followed by a SCALAR row (`8:null`): the lazy match over-runs into it and
    # the combined text fails to parse, so the row is silently dropped. That
    # cost exactly one price row per faction page (28 units) — e.g. space-marines
    # `1e4` = Wardens of Ultramar's "▲ (+10) 120 pts", the row right before
    # `8:null`. raw_decode has no lookahead to get wrong.
    for m in re.finditer(r'(?:^|\n)([0-9a-f]+):(?=[\[\{"])', data):
        rid = m.group(1)
        if rid in rows:
            continue
        try:
            rows[rid], _ = DECODER.raw_decode(data, m.end())
        except Exception:
            continue
        order.append(rid)
    if not rows:
        raise RuntimeError("no RSC rows parsed — page format changed?")

    # Rows referenced via "$L<id>" from another row are resolved inline where
    # they're referenced. Walking them AGAIN standalone would emit ghost
    # duplicates attributed to whatever header came before them in payload
    # order — so only walk root (unreferenced) rows.
    referenced = set()
    for node in rows.values():
        for ref in re.findall(r'"\$L([0-9a-f]+)"', json.dumps(node)):
            referenced.add(ref)

    def texts(node, out, seen):
        if isinstance(node, str):
            if node.startswith("$L"):
                rid = node[2:]
                if rid in seen: return   # cycle guard for $L refs
                seen.add(rid)
                texts(rows.get(rid), out, seen)
            elif not node.startswith("$") and node.strip():
                out.append(node.strip())
        elif isinstance(node, list):
            if len(node) == 4 and node[0] == "$":
                # React element ["$", tag, key, props]: descend ONLY the
                # children prop — walking other props would leak attribute
                # strings (src, width, className, …) into the text stream.
                props = node[3]
                if isinstance(props, dict) and "children" in props:
                    texts(props["children"], out, seen)
            else:
                for x in node: texts(x, out, seen)
        elif isinstance(node, dict):
            # A dict reached OUTSIDE an element position is an RSC route map
            # ({"P","c","f",...}) — descend every value to reach the tree.
            if "children" in node: texts(node["children"], out, seen)
            else:
                for v in node.values(): texts(v, out, seen)

    SKIP = {"UNITS", "DETACHMENTS", "ENHANCEMENTS", "WARGEAR OPTIONS",
            "LEADER", "SUPPORT"}
    triples, points = [], {}
    # Walking a root row resolves every $L ref inline, so each root is one
    # coherent document-order text stream. Header state resets per root.
    for rid in order:
        if rid in referenced: continue
        out = []
        texts(rows[rid], out, set())
        header, skip_next_hdr = None, False
        in_wg, pend = False, None
        band, band_models = None, None
        for t in out:
            if t in ("LEADER", "SUPPORT"):
                skip_next_hdr = True; in_wg = False; band = None; continue
            if t == "WARGEAR OPTIONS":
                in_wg = True; pend = None; band = None; continue
            b = parse_band(t)
            if b is not None and header:
                band = b; band_models = None; in_wg = False
                points.setdefault(header, {}).setdefault(band, {})
                continue
            if in_wg:
                if t.lower().startswith("per "):
                    pend = t[4:]; continue
                m = PTS_RE.match(t)
                if m and pend:
                    triples.append((header, pend, int(m.group(1))))
                    pend = None; continue
                in_wg = False; pend = None
            if band is not None:
                m = MODELS_RE.match(t)
                if m:
                    band_models = int(m.group(1)); continue
                m = PTS_RE.match(t)   # BEFORE comp-row: "90 pts" matches both
                if m and band_models is not None:
                    points[header][band][band_models] = int(m.group(1))
                    band_models = None; continue
                if COMP_ROW_RE.match(t):
                    band_models = sum(int(n) for n in
                                      re.findall(r"(?:^|,\s*)(\d+)\s", t))
                    continue
                band, band_models = None, None   # anything else ends the band
            if PTS_RE.match(t) or MODELS_RE.match(t) or t.startswith("YOUR "):
                continue
            if t == t.upper() and re.search(r"[A-Z]", t) and "," not in t \
               and t not in SKIP:
                if skip_next_hdr: skip_next_hdr = False; continue
                header = t
            else:
                skip_next_hdr = False
    return sorted(set(triples), key=str), points


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/home/stopsign002/sites/base/yaab-data/work/mfm.json")
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--cache-hours", type=float, default=6.0)
    ap.add_argument("--min-pairs", type=int, default=40)
    ap.add_argument("--min-points-units", type=int, default=700,
                    help="sanity gate: minimum units with MFM points")
    ap.add_argument("--min-prev-ratio", type=float, default=0.98,
                    help="fail if unitsPriced < ratio * previous out file's")
    args = ap.parse_args()

    prev_units = 0
    try: prev_units = json.load(open(args.out))["meta"]["unitsPriced"]
    except Exception: pass

    units, unmatched, collisions, conflicts = {}, [], [], []
    per_page, pairs = {}, 0
    for slug in FACTION_PAGES:
        try:
            triples, unit_points = parse_page(fetch(slug, args.cache_dir, args.cache_hours))
        except Exception as e:
            print(f"FATAL: {slug}: {e}", file=sys.stderr)
            sys.exit(3)
        per_page[slug] = {"units": 0, "wargear": len(triples)}
        for uname, bands in unit_points.items():
            rows = []
            for (lo, hi), sizes in sorted(bands.items(),
                                          key=lambda kv: (kv[0][0], kv[0][1] or 0)):
                for models, pts in sorted(sizes.items()):
                    rows.append({"cost": pts, "models": models,
                                 "unit_count_min": lo, "unit_count_max": hi})
            if not rows: continue
            key = f"{slug}|{uname}"
            if key in units:
                collisions.append(key); continue
            units[key] = {"points": rows, "items": {}}
            per_page[slug]["units"] += 1
        for uname, iname, pts in triples:
            pairs += 1
            key = f"{slug}|{uname}"
            u = units.get(key)
            if u is None:
                unmatched.append({"page": slug, "unit": uname, "item": iname, "pts": pts})
                continue
            if iname in u["items"] and u["items"][iname] != pts:
                conflicts.append({"unit": key, "item": iname, "a": u["items"][iname], "b": pts})
                continue
            u["items"][iname] = pts

    priced = sum(1 for u in units.values() if u["points"])
    wargear = sum(1 for u in units.values() if u["items"])
    meta = {"unitsPriced": priced, "wargearPriced": wargear, "pairs": pairs,
            "unmatchedRows": unmatched, "keyCollisions": collisions,
            "itemConflicts": conflicts, "perPage": per_page}
    out = {"fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "pages": len(FACTION_PAGES), "units": units, "meta": meta}
    # gates BEFORE writing so a degraded scrape never replaces a good file
    fail = []
    if pairs < args.min_pairs: fail.append(f"pairs={pairs} < {args.min_pairs}")
    if priced < args.min_points_units: fail.append(f"unitsPriced={priced} < {args.min_points_units}")
    if prev_units and priced < args.min_prev_ratio * prev_units:
        fail.append(f"unitsPriced={priced} fell from {prev_units}")
    if fail:
        print("SANITY GATE FAILED: " + "; ".join(fail), file=sys.stderr)
        sys.exit(2)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp = args.out + ".tmp"
    json.dump(out, open(tmp, "w"), indent=1, sort_keys=True, ensure_ascii=False)
    os.replace(tmp, args.out)
    print(json.dumps({"unitsPriced": priced, "wargearPriced": wargear, "pairs": pairs,
                      "unmatchedRows": len(unmatched), "keyCollisions": len(collisions),
                      "itemConflicts": len(conflicts), "out": args.out}))
    for u in unmatched[:20]:
        print("ORPHAN WARGEAR ROW: %(page)s / %(unit)s / %(item)s (%(pts)s pts)" % u, file=sys.stderr)

if __name__ == "__main__":
    main()
