// Build entry: bundle the 40kdc dataset + the separate ability-text store into a
// single browser global `window.DC`. Built with esbuild → js/vendor/dc-bundle.js.
// `alliedRules` drives the allied-units pass in js/data/dc-adapter.js (Daemonic
// Pact, Imperial Agents, Brood Brothers…). The adapter also reaches it via the
// `fv.ds` back-reference, so it degrades gracefully on an older bundle — but
// exporting it keeps the dependency explicit and greppable.
import {
  units, factions, weapons, detachments, stratagems, enhancements,
  wargear, wargearOptions, abilities, alliedRules,
} from "@alpaca-software/40kdc-data";
import abilityText from "./abilities-index.json" with { type: "json" };
window.DC = {
  units, factions, weapons, detachments, stratagems, enhancements,
  wargear, wargearOptions, abilities, alliedRules, abilityText,
};
