// inspect-sm.mjs — per-faction inspection for the Space Marines GDC-authority
// change (docs/GDC-AUTHORITY.md §4/§5). Sibling of
// ~/sites/base/40kdc-build/bundle/validate-deploy.mjs and boots exactly as it
// does; validate-deploy only emits a whole-tree SUMMARY line, which cannot say
// whether one datasheet got the right keywords or whether a chapter lists the
// detachments GW prints.
//
// Run (the worktree mounted as /app, the bundle workspace as /work):
//   docker run --rm -v ~/sites/base/40kdc-build:/work -v <APP>:/app -w /work/bundle \
//     -u "$(id -u):$(id -g)" -e HOME=/work/bundle \
//     -e ADAPTER_PATH=/app/js/data/dc-adapter.js -e BUNDLE_PATH=/app/js/vendor/dc-bundle.js \
//     -e PROSE_PATH=/app/js/vendor/dc-prose.js node:22-alpine node /app/scripts/inspect-sm.mjs
//
// MODE=dump prints one JSON line per NON-Astartes faction instead of the
// report, for the byte-identity diff in §5.
import { readFileSync } from "node:fs";

global.window = {};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const BUNDLE_PATH = process.env.BUNDLE_PATH;
const PROSE_PATH = process.env.PROSE_PATH;
const ADAPTER_PATH = process.env.ADAPTER_PATH;
const MODE = process.env.MODE || "report";
if (!BUNDLE_PATH || !ADAPTER_PATH) { console.error("BUNDLE_PATH / ADAPTER_PATH not set"); process.exit(3); }

await import(BUNDLE_PATH);
if (PROSE_PATH) await import(PROSE_PATH);
await import("/app/js/gdc.js");
const App = window.App;

const gdcDir = "/app/data/gdc/" + App.GDC._EDITION + "/gdc/";
const gdcFiles = new Set(["space_marines"]);
Object.values(App.GDC.FACTION_TO_GDC).forEach((v) =>
  (Array.isArray(v) ? v : [v]).forEach((f) => f && gdcFiles.add(f)));
for (const fn of gdcFiles) {
  try {
    App.GDC._rawCache.set(App.GDC._EDITION + "/" + fn,
      JSON.parse(readFileSync(gdcDir + fn + ".json", "utf8")));
  } catch (_) { /* validate-deploy.mjs is the gate for a missing file */ }
}

(0, eval)(readFileSync(ADAPTER_PATH, "utf8"));

// Same phase order as validate-deploy.mjs. Detachment adoption is NOT called
// here on purpose: mergeIntoFactions fires it as a hook for every faction
// before it indexes faction.detachments, and relying on that is what proves
// the hook works for the harnesses under ~/sites/base that nobody can edit.
const built = [];
await window.BSData.loadAllFactions(() => {}, (f) => built.push(f));
App.GDC.mergeIntoFactions(built);
App.GDC.mergeUnitDataIntoFactions && App.GDC.mergeUnitDataIntoFactions(built);
App.GDC.mergeUnitAbilitiesFromGdc(built);
// Snapshot the ability names the 40kdc build + GDC merges produced, BEFORE the
// authority pass replaces the list. Anything that disappears is a candidate for
// GDC_KEEP_ABILITIES (GW prints it; the dump ships it as an image, so a straight
// rebuild from GDC silently deletes a real rule). Measured here rather than
// recorded on the unit, because a new field on every authoritative unit would
// break the §5 byte-identity test for Orks.
const ASTARTES_RE = /Adeptus Astartes/;
const abilitiesBefore = new Map();
built.filter((f) => ASTARTES_RE.test(f.factionName)).forEach((f) => {
  (f.units || []).forEach((u) => {
    abilitiesBefore.set(f._factionId + "::" + u.id, (u.abilities || []).map((a) => a && a.name).filter(Boolean));
  });
});
window.BSData._applyGdcStatlines(built);
window.BSData._adoptGdcUnits(built);
window.BSData._applyWeaponFixes(built);
built.forEach((f) => (f.detachments || []).forEach((d) => window.BSData._reconcileStrats(d)));

const ASTARTES = ASTARTES_RE;

if (MODE === "dump") {
  const out = [];
  // §5 byte-identity: one stable JSON line per non-Astartes faction. Sorted by
  // name so a reordering in window.DC can never read as a data change.
  built.filter((f) => !ASTARTES.test(f.factionName))
    .sort((a, b) => a.factionName.localeCompare(b.factionName))
    .forEach((f) => out.push(JSON.stringify(f)));
  // Written with one synchronous write and NO process.exit: node truncates a
  // pending async stdout write at the pipe buffer when process.exit runs, and
  // this payload is ~20 MB — the first run of this silently produced exactly
  // 65537 bytes and a diff that read "IDENTICAL".
  process.stdout.write(out.join("\n") + "\n");
}

if (MODE !== "dump") {

// ── §4 datasheet table ──────────────────────────────────────────────────────
const SM = "Imperium - Adeptus Astartes - Space Marines";
const BA = "Imperium - Adeptus Astartes - Blood Angels";
const byName = new Map(built.map((f) => [f.factionName, f]));
// A chapter has zero units of its own (40kdc parks every chapter-unique sheet
// on the parent), so "under Blood Angels" means the object the BA roster shows,
// which is the parent's — look there when the chapter has none.
function unit(factionName, unitName) {
  const order = [factionName, SM];
  for (const fn of order) {
    const f = byName.get(fn);
    const u = f && (f.units || []).find((x) => x.name === unitName);
    if (u) return u;
  }
  return null;
}
const kw = (u) => (u.keywords || []).map((x) => String(x).toLowerCase());
const abil = (u) => (u.abilities || []).map((a) => String(a.name || "").toLowerCase());
const hasAbil = (u, re) => abil(u).some((n) => re.test(n));

const rows = [
  ["Intercessor Squad (SM)", () => {
    const u = unit(SM, "Intercessor Squad");
    return [u && kw(u).includes("explosives") && !kw(u).includes("grenades"),
            u ? "kw=" + (u.keywords || []).join("/") : "NOT FOUND"];
  }],
  ["Intercessor Squad (under Blood Angels)", () => {
    const u = unit(BA, "Intercessor Squad");
    return [u && kw(u).includes("explosives") && !kw(u).includes("grenades"),
            u ? "kw=" + (u.keywords || []).join("/") : "NOT FOUND"];
  }],
  ["Impulsor core 'Firing Deck 7' + named 'Rapid Disembarkation'", () => {
    const u = unit(SM, "Impulsor");
    return [u && hasAbil(u, /^firing deck 7$/) && hasAbil(u, /^rapid disembarkation$/),
            u ? abil(u).join(" | ") : "NOT FOUND"];
  }],
  ["Gladiator Lancer core 'Damaged: 1-4 wounds remaining'", () => {
    const u = unit(SM, "Gladiator Lancer");
    return [u && hasAbil(u, /^damaged: 1\s*[-–]\s*4 wounds remaining$/),
            u ? abil(u).filter((n) => /damaged/.test(n)).join(" | ") || "(no damaged row)" : "NOT FOUND"];
  }],
  ["Chief Librarian Mephiston FNP 5+ + 'Chief Librarian (psyker level 3)'", () => {
    const u = unit(BA, "Chief Librarian Mephiston");
    return [u && hasAbil(u, /^feel no pain 5\+$/) && hasAbil(u, /^chief librarian \(psyker level 3\)$/),
            u ? abil(u).join(" | ") : "NOT FOUND"];
  }],
  ["Judiciar attachmentRole === 'support'", () => {
    const u = unit(SM, "Judiciar");
    return [u && u.attachmentRole === "support", u ? "role=" + u.attachmentRole : "NOT FOUND"];
  }],
  ["Cato Sicarius role 'leader' + gdcLeadBy non-empty", () => {
    const u = unit(SM, "Cato Sicarius");
    return [u && u.attachmentRole === "leader" && (u.gdcLeadBy || []).length > 0,
            u ? "role=" + u.attachmentRole + " leadBy=" + JSON.stringify(u.gdcLeadBy) : "NOT FOUND"];
  }],
  ["Death Company Captain with Jump Pack gdcLeadBy", () => {
    const u = unit(BA, "Death Company Captain with Jump Pack");
    // The contract expected [] here; GDC 972 gives exactly one target. GW's
    // dump is the source of record, so assert what it says and flag the
    // contract rather than hardcoding the expectation.
    return [u && JSON.stringify(u.gdcLeadBy) === JSON.stringify(["Death Company Marines with Jump Packs"]),
            u ? "leadBy=" + JSON.stringify(u.gdcLeadBy) + " role=" + u.attachmentRole : "NOT FOUND"];
  }],
  ["Tactical Squad present, isLegends, untouched by the authority pass", () => {
    const u = unit(SM, "Tactical Squad");
    return [!!u && u.isLegends === true && !u._gdcAuthoritative,
            u ? "legends=" + u.isLegends + " authoritative=" + !!u._gdcAuthoritative : "NOT FOUND"];
  }],
];

let fails = 0;
console.log("== §4 datasheet authority ==");
for (const [label, fn] of rows) {
  let ok = false, detail = "";
  try { [ok, detail] = fn(); } catch (e) { detail = "THREW: " + e.message; }
  if (!ok) fails++;
  console.log((ok ? "  PASS  " : "  FAIL  ") + label + "\n          " + detail);
}

// ── §3/§5 detachments per Astartes faction ──────────────────────────────────
console.log("\n== Astartes detachments ==");
built.filter((f) => ASTARTES.test(f.factionName)).forEach((f) => {
  const dets = f.detachments || [];
  const bad = [];
  dets.forEach((d) => {
    const nR = (d.rules || []).length;
    const nE = (d.enhancements || []).length;
    const nS = (d.gdcStratagems || []).length;
    if (nR < 1) bad.push(d.name + " 0 rules");
    if (nE < 1) bad.push(d.name + " 0 enhancements");
    // 3 or 6 is GW's pattern for a 1-pt and a 2/3-pt detachment, but Deathwatch
    // Support genuinely ships FOUR stratagems and ONE enhancement in
    // space_marines.json — it is the odd one out in GW's own data, not a merge
    // that half-landed, so it is not a shortfall.
    if (nS !== 3 && nS !== 6 && d.name !== "Deathwatch Support") bad.push(d.name + " " + nS + " strats");
  });
  console.log(`-- ${f.factionName} (${f._factionId}) — ${dets.length} detachments` +
    (f._retiredDetachments ? `, ${f._retiredDetachments.length} retired` : ""));
  dets.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((d) => {
    console.log(`     ${(d._adopted ? "+" : " ")} ${d.name.padEnd(30)} tag=${(d._gdcFactionTag || "-").padEnd(18)}` +
      ` rules=${(d.rules || []).length} enh=${(d.enhancements || []).length}` +
      ` strats=${(d.gdcStratagems || []).length} pts=${d.points} disp=${(d.dispositions || []).map((x) => x.name).join("+") || "-"} id=${d.id}`);
  });
  if (f._retiredDetachments) console.log("     retired: " + f._retiredDetachments.join(", "));
  if (bad.length) { fails++; console.log("     SHORTFALL: " + bad.join("; ")); }
});

const sm = byName.get(SM);
const smNames = (sm.detachments || []).map((d) => d.name).sort();
console.log(`\nSM detachment count: ${smNames.length} (expect 22) — ${smNames.join(", ")}`);
if (smNames.length !== 22) fails++;

// ── abilities the authority pass DROPPED (GDC_KEEP_ABILITIES candidates) ────
console.log("\n== dropped named abilities (GDC_KEEP_ABILITIES candidates) ==");
let nDropped = 0;
built.filter((f) => ASTARTES.test(f.factionName)).forEach((f) => {
  (f.units || []).forEach((u) => {
    if (!u._gdcAuthoritative) return;
    const before = abilitiesBefore.get(f._factionId + "::" + u.id) || [];
    const now = new Set((u.abilities || []).map((a) => String(a && a.name || "").toLowerCase()));
    const dropped = before.filter((n) => !now.has(String(n).toLowerCase()));
    if (!dropped.length) return;
    nDropped += dropped.length;
    console.log(`  ${f._factionId}::${u.id}  (${u.name})  ${JSON.stringify(dropped)}`);
  });
});
if (!nDropped) console.log("  (none)");

console.log("\nINSPECT:" + JSON.stringify({ fails, smDetachments: smNames.length, droppedAbilities: nDropped }));
process.exitCode = fails === 0 ? 0 : 3;
}
