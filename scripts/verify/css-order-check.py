#!/usr/bin/env python3
"""css-order-check.py — prove a stylesheet edit kept the cascade order.

Usage:
  scripts/verify/css-order-check.py <old-tree> <new-tree> [matches.json[.gz][,more.json.gz...]]
      [--max N] [--quiet] [--empty-disjoint]

A tree is a directory holding index.html and css/ (e.g. a `git archive HEAD
css index.html` extract, or the worktree itself). Stylesheets are read in the
order index.html links them, then css/themes/brutalist.css (appended last at
runtime by js/theme-boot.js).

Rule (docs/CSS-REORG-2026-10-31.md section 2): flatten both sets to
declarations in cascade order (link order, then source order, @media/@supports
bodies inline). For every pair D1 before D2 in the OLD order with
  - the same property (or overlapping shorthand/longhand: `background` vs
    `background-color`, `inset` vs `top`, a -webkit- alias vs its standard name),
  - the same !important flag,
  - equal specificity,
  - the same pseudo-element (::before never competes with ::after),
  - selectors that can co-match (per matches.json: their element sets
    intersect; a selector with a null OR EMPTY set — never matched in any
    captured state — co-matches everything; without matches.json every pair
    is assumed to co-match — conservative),
D1 must still precede D2 in the NEW order. Every violated pair is printed and
the exit code is 1.

It also fails on: declarations present in old and absent in new that are not
provably dead (a later same-selector, same-media, same-property, same-importance
declaration exists in old and survives in new), declarations added in new,
selectors that disappeared, and lost/re-ordered @keyframes, @font-face and
:root tokens.

Pure python3, no dependencies. Exit 0 = cascade preserved.
"""
import gzip, json, os, re, sys
from collections import defaultdict

LINK_RE = re.compile(r'<link rel="stylesheet" href="(css/[^"?]+)')
THEME = 'css/themes/brutalist.css'
# --empty-disjoint: the contract's literal section 3 reading (a selector that
# matched nothing co-matches nothing). Default is the stricter reading.
EMPTY_DISJOINT = '--empty-disjoint' in sys.argv or os.environ.get('CSS_EMPTY_DISJOINT') == '1'

# ---------------------------------------------------------------- parsing
class Comment:
    def __init__(s, text, line): s.text = text; s.line = line
class Decl:
    def __init__(s, prop, value, imp, line): s.prop = prop; s.value = value; s.imp = imp; s.line = line
class Rule:
    def __init__(s, prelude, items, line): s.prelude = prelude; s.items = items; s.line = line
class At:
    def __init__(s, name, prelude, children, line, decls=False):
        s.name = name; s.prelude = prelude; s.children = children; s.line = line; s.decls = decls
class Stmt:
    def __init__(s, text, line): s.text = text; s.line = line

def norm_ws(s):
    out = []; q = None; prev = False
    for ch in s:
        if q:
            out.append(ch)
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch; out.append(ch); prev = False; continue
        if ch.isspace():
            if not prev: out.append(' ')
            prev = True
        else: out.append(ch); prev = False
    return ''.join(out).strip()

def split_top(s, sep):
    parts = []; depth = 0; q = None; cur = []
    for ch in s:
        if q:
            cur.append(ch)
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch; cur.append(ch); continue
        if ch in '([': depth += 1
        elif ch in ')]': depth -= 1
        if ch == sep and depth == 0: parts.append(''.join(cur)); cur = []
        else: cur.append(ch)
    parts.append(''.join(cur))
    return parts

def parse_decls(body, base_line):
    chunks = []; cur = ''; depth = 0; q = None; i = 0; n = len(body)
    ln = base_line; startline = base_line
    while i < n:
        ch = body[i]
        if q:
            cur += ch
            if ch == '\\': cur += body[i + 1]; i += 1
            elif ch == q: q = None
            if ch == '\n': ln += 1
            i += 1; continue
        if body.startswith('/*', i):
            j = body.index('*/', i) + 2
            if cur.strip():
                ln += body[i:j].count('\n'); i = j; continue
            chunks.append(('c', body[i:j], ln)); ln += body[i:j].count('\n'); i = j; startline = ln; continue
        if ch in '"\'': q = ch; cur += ch; i += 1; continue
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ';' and depth == 0:
            if cur.strip(): chunks.append(('d', cur, startline))
            cur = ''; i += 1; startline = ln; continue
        if ch == '\n': ln += 1
        if not cur.strip(): startline = ln
        cur += ch; i += 1
    if cur.strip(): chunks.append(('d', cur, startline))
    items = []
    for k, t, l in chunks:
        if k == 'c': items.append(Comment(t, l)); continue
        m = re.match(r'\s*([^:]+?)\s*:(.*)$', t, re.S)
        if not m: raise ValueError('bad declaration %r at line %d' % (t[:60], l))
        val = norm_ws(m.group(2)); imp = False
        mi = re.search(r'\s*!\s*important\s*$', val, re.I)
        if mi: imp = True; val = val[:mi.start()].strip()
        items.append(Decl(m.group(1).strip(), val, imp, l))
    return items

def parse(text):
    pos = 0; n = len(text)
    def line_of(p): return text.count('\n', 0, p) + 1
    def block():
        nonlocal pos
        nodes = []
        while pos < n:
            while pos < n and text[pos].isspace(): pos += 1
            if pos >= n: break
            if text[pos] == '}': pos += 1; return nodes
            if text.startswith('/*', pos):
                j = text.index('*/', pos) + 2
                nodes.append(Comment(text[pos:j], line_of(pos))); pos = j; continue
            start = pos; ln = line_of(pos); depth = 0; q = None; p = pos
            while p < n:
                ch = text[p]
                if q:
                    if ch == '\\': p += 1
                    elif ch == q: q = None
                elif ch in '"\'': q = ch
                elif ch == '(': depth += 1
                elif ch == ')': depth -= 1
                elif text.startswith('/*', p) and depth == 0: p = text.index('*/', p) + 1
                elif ch in '{;' and depth == 0: break
                p += 1
            prelude = norm_ws(re.sub(r'/\*.*?\*/', '', text[start:p], flags=re.S))
            if text[p] == ';':
                nodes.append(Stmt(prelude + ';', ln)); pos = p + 1; continue
            pos = p + 1
            if re.match(r'@(media|supports|keyframes|-webkit-keyframes|layer|container)', prelude):
                nodes.append(At(prelude.split()[0], prelude, block(), ln))
            else:
                depth = 0; q = None; p = pos
                while p < n:
                    c = text[p]
                    if q:
                        if c == '\\': p += 1
                        elif c == q: q = None
                    elif c in '"\'': q = c
                    elif text.startswith('/*', p): p = text.index('*/', p) + 1
                    elif c == '(': depth += 1
                    elif c == ')': depth -= 1
                    elif c == '}' and depth == 0: break
                    p += 1
                body = text[pos:p]; pos = p + 1
                items = parse_decls(body, line_of(start))
                if prelude.startswith('@'): nodes.append(At(prelude.split()[0], prelude, items, ln, decls=True))
                else: nodes.append(Rule(prelude, items, ln))
        return nodes
    return block()

def linked(tree):
    names = LINK_RE.findall(open(os.path.join(tree, 'index.html')).read())
    if os.path.exists(os.path.join(tree, THEME)) and THEME not in names: names.append(THEME)
    return names

def load(tree):
    return [(nm, parse(open(os.path.join(tree, nm)).read())) for nm in linked(tree)]

# ---------------------------------------------------------------- selectors
def canon_sel(sel):
    """Canonical text for comparing a source selector with a browser
    selectorText: single spaces, ' > ' style combinators, double quotes."""
    s = norm_ws(sel)
    s = re.sub(r"'([^']*)'", r'"\1"', s)
    out = []; depth = 0; i = 0
    while i < len(s):
        c = s[i]
        if c in '([': depth += 1
        elif c in ')]': depth -= 1
        if c in '>+~' and depth == 0 and not (c == '~' and i + 1 < len(s) and s[i + 1] == '='):
            while out and out[-1] == ' ': out.pop()
            out.append(' ' + c + ' ')
            i += 1
            while i < len(s) and s[i] == ' ': i += 1
            continue
        out.append(c); i += 1
    s = ''.join(out)
    s = re.sub(r'(?<!:):(before|after|first-line|first-letter)\b', r'::\1', s)
    # browsers drop a universal selector that is followed by another simple
    # selector (`*:not(x)` serialises as `:not(x)`, `*::before` as `::before`)
    s = re.sub(r'(^|[\s(,])\*(?=[:.#\[])', r'\1', s)
    s = re.sub(r'\s*,\s*', ', ', s)
    s = re.sub(r'\(\s+', '(', s); s = re.sub(r'\s+\)', ')', s)
    return s.strip()

def pseudo_element(sel):
    m = re.findall(r'::?(before|after|first-line|first-letter|placeholder|selection|marker|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)\b', sel)
    # only a trailing pseudo-element counts; :-webkit-autofill is a class, but
    # nothing here uses it.
    return m[-1] if m else ''

def _split_args(s):
    return [a.strip() for a in split_top(s, ',')]

def _compound_specificity(sel):
    """Selector specificity per Selectors 4 (handles :is/:not/:has max,
    :where zero, :nth-child(... of S))."""
    a = b = c = 0; i = 0; n = len(sel)
    while i < n:
        ch = sel[i]
        if ch == '#':
            m = re.match(r'#[\w-]+', sel[i:]); a += 1; i += len(m.group(0)); continue
        if ch == '.':
            m = re.match(r'\.[\w-]+', sel[i:]); b += 1; i += len(m.group(0)); continue
        if ch == '[':
            depth = 0; j = i
            while j < n:
                if sel[j] == '[': depth += 1
                elif sel[j] == ']':
                    depth -= 1
                    if depth == 0: break
                j += 1
            b += 1; i = j + 1; continue
        if ch == ':':
            m = re.match(r'::?([\w-]+)', sel[i:])
            name = m.group(1); dbl = sel[i:i + 2] == '::'; i += len(m.group(0))
            arg = None
            if i < n and sel[i] == '(':
                depth = 0; j = i
                while j < n:
                    if sel[j] == '(': depth += 1
                    elif sel[j] == ')':
                        depth -= 1
                        if depth == 0: break
                    j += 1
                arg = sel[i + 1:j]; i = j + 1
            if dbl or name in ('before', 'after', 'first-line', 'first-letter'):
                c += 1; continue
            if name == 'where': continue
            if name in ('is', 'not', 'has', 'matches', '-webkit-any'):
                best = max((specificity(x) for x in _split_args(arg or '')), default=(0, 0, 0))
                a += best[0]; b += best[1]; c += best[2]; continue
            if name in ('nth-child', 'nth-last-child') and arg and ' of ' in arg:
                b += 1
                best = max((specificity(x) for x in _split_args(arg.split(' of ', 1)[1])), default=(0, 0, 0))
                a += best[0]; b += best[1]; c += best[2]; continue
            b += 1; continue
        if ch == '*' or ch in ' >+~,': i += 1; continue
        m = re.match(r'[a-zA-Z][\w-]*', sel[i:])
        if m: c += 1; i += len(m.group(0)); continue
        i += 1
    return (a, b, c)

_spec_cache = {}
def specificity(sel):
    r = _spec_cache.get(sel)
    if r is None: r = _spec_cache[sel] = _compound_specificity(sel.strip())
    return r

# ---------------------------------------------------------------- properties
EXTRA_LONGHANDS = {
    'inset': {'top', 'right', 'bottom', 'left'},
    'gap': {'row-gap', 'column-gap'}, 'grid-gap': {'row-gap', 'column-gap', 'gap'},
    'place-items': {'align-items', 'justify-items'},
    'place-content': {'align-content', 'justify-content'},
    'place-self': {'align-self', 'justify-self'},
    'font': {'line-height'},
    'grid-area': {'grid-row', 'grid-column', 'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end'},
    'grid-template': {'grid-template-rows', 'grid-template-columns', 'grid-template-areas'},
    'grid': {'grid-template', 'grid-auto-flow', 'grid-auto-rows', 'grid-auto-columns'},
    'border': {'border-image'},
    'mask': {'-webkit-mask'},
    'overflow': {'overflow-x', 'overflow-y'},
    'text-decoration': {'text-decoration-line'},
    'columns': {'column-width', 'column-count'},
}
def norm_prop(p):
    p = p.lower()
    return p[8:] if p.startswith('-webkit-') else p

def prop_group(p):
    """Bucket key: properties in different buckets never interact."""
    if p.startswith('--'): return p
    p = norm_prop(p)
    if p == 'all': return '*all*'
    if p in ('top', 'right', 'bottom', 'left'): return 'inset'
    if p in ('row-gap', 'column-gap'): return 'gap'
    if p.startswith('align-') or p.startswith('justify-'): return 'place'
    if p == 'line-height': return 'font'
    if p in ('column-width', 'column-count'): return 'columns'
    head = p.split('-')[0]
    return head

def props_conflict(p, q):
    if p == q: return True
    if p.startswith('--') or q.startswith('--'): return False
    p = norm_prop(p); q = norm_prop(q)
    if p == q or p == 'all' or q == 'all': return True
    if p.startswith(q + '-') or q.startswith(p + '-'): return True
    for s, ls in EXTRA_LONGHANDS.items():
        fam = {s} | ls
        if (p == s and (q in ls or any(q.startswith(x + '-') for x in ls))) or \
           (q == s and (p in ls or any(p.startswith(x + '-') for x in ls))):
            return True
        if p in fam and q in fam and s in (p, q): return True
    return False

# ---------------------------------------------------------------- flatten
def flatten(files):
    """Declaration rows in cascade order, plus at-rule inventories."""
    rows = []; kf = []; ff = []; order = 0
    def walk(name, nodes, stack):
        nonlocal order
        for nd in nodes:
            if isinstance(nd, Rule):
                sels = [norm_ws(s) for s in split_top(nd.prelude, ',')]
                for it in nd.items:
                    if not isinstance(it, Decl): continue
                    for s in sels:
                        rows.append(dict(sel=s, media=' && '.join(stack), prop=it.prop, value=it.value,
                                         imp=it.imp, file=name, line=it.line, order=order, rule=id(nd)))
                        order += 1
            elif isinstance(nd, At):
                if nd.name in ('@media', '@supports', '@container', '@layer'):
                    walk(name, nd.children, stack + [nd.prelude])
                elif nd.name.endswith('keyframes'):
                    body = []
                    for k in nd.children:
                        if isinstance(k, Rule):
                            body.append((norm_ws(k.prelude), tuple((d.prop, d.value, d.imp) for d in k.items if isinstance(d, Decl))))
                    kf.append(dict(name=nd.prelude.split(None, 1)[1].strip(), media=' && '.join(stack),
                                   body=tuple(body), file=name, line=nd.line, order=order)); order += 1
                elif nd.name == '@font-face':
                    d = {x.prop: x.value for x in nd.children if isinstance(x, Decl)}
                    ff.append(dict(key=(d.get('font-family'), d.get('font-weight', 'normal'), d.get('font-style', 'normal')),
                                   body=tuple(sorted(d.items())), media=' && '.join(stack), file=name, line=nd.line, order=order)); order += 1
    for name, nodes in files: walk(name, nodes, [])
    return rows, kf, ff

def canon_value(v):
    if '"' in v or "'" in v: return v
    return re.sub(r'\s+\)', ')', re.sub(r'\(\s+', '(', v))

def row_key(r): return (canon_sel(r['sel']), r['media'], r['prop'].lower(), canon_value(r['value']), r['imp'])

def map_rows(old, new):
    """old row index -> new row index (None if absent); list of new rows unmatched."""
    pool = defaultdict(list)
    for j, r in enumerate(new): pool[row_key(r)].append(j)
    for k in pool: pool[k].reverse()
    m = []
    for r in old:
        lst = pool.get(row_key(r))
        m.append(lst.pop() if lst else None)
    extra = [j for lst in pool.values() for j in lst]
    return m, sorted(extra)

# ---------------------------------------------------------------- co-match
class CoMatch:
    def __init__(self, path=None):
        self.sets = None; self.unknown = set(); self.empty = set(); self._memo = {}
        if not path: return
        # several captures (e.g. one per width) may be given comma-separated;
        # element ids are namespaced per file so only a shared element in the
        # SAME capture counts as a co-match.
        self.sets = {}
        for n, one in enumerate(path.split(',')):
            op = gzip.open if one.endswith('.gz') else open
            data = json.load(op(one, 'rt'))
            for sel, lst in data['selectors'].items():
                c = canon_sel(sel)
                if c in self.sets and self.sets[c] is None: continue
                if lst is None: self.sets[c] = None; continue
                self.sets[c] = (self.sets.get(c) or frozenset()) | frozenset((n, i) for i in lst)
        # A selector that matched nothing in any captured state is UNKNOWN
        # (its UI was never driven), not "matches nothing": treat it like null.
        if not EMPTY_DISJOINT:
            for c, v in list(self.sets.items()):
                if v is not None and not v: self.sets[c] = None
    def get(self, sel):
        if self.sets is None: return None
        c = canon_sel(sel)
        if c in self.sets: return self.sets[c]
        self.unknown.add(sel); return None
    def can(self, a, b):
        k = (a, b)
        r = self._memo.get(k)
        if r is None: r = self._memo[k] = self._can(a, b)
        return r
    def _can(self, a, b):
        if pseudo_element(a) != pseudo_element(b): return False
        if self.sets is None: return True
        sa = self.get(a); sb = self.get(b)
        if sa is None or sb is None: return True
        return not sa.isdisjoint(sb)

# ---------------------------------------------------------------- the check
def check(old_tree, new_tree, matches=None, maxshow=200, quiet=False, out=sys.stdout):
    oldf = load(old_tree); newf = load(new_tree)
    old, okf, off = flatten(oldf); new, nkf, nff = flatten(newf)
    cm = CoMatch(matches)
    m, extra = map_rows(old, new)
    problems = 0
    def p(*a):
        if not quiet: print(*a, file=out)

    # dead / lost declarations
    survivors = defaultdict(list)  # (sel, media, prop, imp) -> old orders that survive
    for i, r in enumerate(old):
        if m[i] is not None: survivors[(canon_sel(r['sel']), r['media'], r['prop'], r['imp'])].append(r['order'])
    dead = []; lost = []
    for i, r in enumerate(old):
        if m[i] is not None: continue
        k = (canon_sel(r['sel']), r['media'], r['prop'], r['imp'])
        if any(o > r['order'] for o in survivors.get(k, ())): dead.append(r)
        else: lost.append(r)
    for r in lost:
        problems += 1
        p('LOST declaration (not provably dead): %s:%d %s { %s: %s%s } [%s]' % (
            r['file'], r['line'], r['sel'], r['prop'], r['value'], ' !important' if r['imp'] else '', r['media']))
    for j in extra:
        r = new[j]; problems += 1
        p('ADDED declaration: %s:%d %s { %s: %s } [%s]' % (r['file'], r['line'], r['sel'], r['prop'], r['value'], r['media']))

    # lost selectors
    if cm.sets is not None:
        absent = sorted({r['sel'] for r in old if r['file'] != THEME and canon_sel(r['sel']) not in cm.sets})
        if absent:
            p('NOTE: %d stylesheet selectors are absent from matches.json (treated as co-matching everything): %s' % (
                len(absent), ', '.join(absent[:8]) + (' ...' if len(absent) > 8 else '')))
    oldsel = {canon_sel(r['sel']) for r in old}; newsel = {canon_sel(r['sel']) for r in new}
    for s in sorted(oldsel - newsel):
        problems += 1; p('LOST selector: %s' % s)

    # keyframes / font-face: presence and order of same-name definitions
    def inv(lst, keyf):
        d = defaultdict(list)
        for x in lst: d[keyf(x)].append(x)
        return d
    ok = inv(okf, lambda x: x['name']); nk = inv(nkf, lambda x: x['name'])
    for name, defs in ok.items():
        ndefs = nk.get(name, [])
        if [(x['media'], x['body']) for x in defs] != [(x['media'], x['body']) for x in sorted(ndefs, key=lambda x: x['order'])]:
            problems += 1
            p('KEYFRAMES @%s changed, lost or re-ordered: old %s -> new %s' % (
                name, ['%s:%d' % (x['file'], x['line']) for x in defs], ['%s:%d' % (x['file'], x['line']) for x in ndefs]))
    for name in set(nk) - set(ok):
        problems += 1; p('KEYFRAMES @%s added' % name)
    of = inv(off, lambda x: x['key']); nf = inv(nff, lambda x: x['key'])
    for key, defs in of.items():
        if [x['body'] for x in defs] != [x['body'] for x in sorted(nf.get(key, []), key=lambda x: x['order'])]:
            problems += 1; p('FONT-FACE %s changed, lost or re-ordered' % (key,))
    for key in set(nf) - set(of):
        problems += 1; p('FONT-FACE %s added' % (key,))
    # :root tokens are covered by the declaration checks above; list them
    # separately because a lost token is the loudest kind of lost declaration.
    for r in lost:
        if r['prop'].startswith('--'): p('  (lost TOKEN %s in %s)' % (r['prop'], r['sel']))

    # order pairs
    groups = defaultdict(list)
    for i, r in enumerate(old):
        if m[i] is None: continue
        groups[(prop_group(r['prop']), r['imp'], specificity(r['sel']))].append(i)
    allg = [k for k in groups if k[0] == '*all*']
    viol = []
    newpos = [None if x is None else new[x]['order'] for x in m]
    for key, idx in groups.items():
        cand = idx
        if key[0] != '*all*':
            for ak in allg:
                if ak[1:] == key[1:]: cand = sorted(cand + groups[ak])
        n = len(cand)
        for a in range(n):
            i = cand[a]; ri = old[i]; pi = newpos[i]
            for b in range(a + 1, n):
                j = cand[b]
                if newpos[j] > pi: continue
                rj = old[j]
                if not props_conflict(ri['prop'], rj['prop']): continue
                if not cm.can(ri['sel'], rj['sel']): continue
                viol.append((i, j))
    viol = sorted(set(viol))
    for i, j in viol[:maxshow]:
        a = old[i]; b = old[j]; na = new[m[i]]; nb = new[m[j]]
        p('old(%s:%d %s{%s}) must precede old(%s:%d %s{%s}) — new order: %s:%d, %s:%d' % (
            a['file'], a['line'], a['sel'], a['prop'], b['file'], b['line'], b['sel'], b['prop'],
            na['file'], na['line'], nb['file'], nb['line']))
    if len(viol) > maxshow: p('... %d more violated pairs' % (len(viol) - maxshow))
    problems += len(viol)
    if not quiet:
        p('')
        p('declarations: old %d, new %d; dead (deleted, proven) %d; lost %d; added %d' % (len(old), len(new), len(dead), len(lost), len(extra)))
        p('selectors: old %d, new %d, lost %d' % (len(oldsel), len(newsel), len(oldsel - newsel)))
        p('co-match: %s%s' % ('matches.json' if cm.sets is not None else 'CONSERVATIVE (no matches.json: every pair co-matches)',
                              ', %d selectors absent from the map (treated as co-matching everything)' % len(cm.unknown) if cm.sets is not None else ''))
        p('order violations: %d' % len(viol))
        p('RESULT: %s' % ('OK' if problems == 0 else 'FAIL (%d problems)' % problems))
    return dict(viol=viol, old=old, new=new, m=m, dead=dead, lost=lost, extra=extra, problems=problems, comatch=cm)

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        print(__doc__); sys.exit(2)
    mx = 200
    if '--max' in sys.argv: mx = int(sys.argv[sys.argv.index('--max') + 1]); args = [a for a in args if a != str(mx)]
    res = check(args[0], args[1], args[2] if len(args) > 2 else None, maxshow=mx, quiet='--quiet' in sys.argv)
    sys.exit(1 if res['problems'] else 0)
