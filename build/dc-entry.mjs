// Build entry: bundle the 40kdc dataset + the separate ability-text store into a
// single browser global `window.DC`. Built with esbuild → js/vendor/dc-bundle.js.
import {
  units, factions, weapons, detachments, stratagems, enhancements,
  wargear, wargearOptions, abilities,
} from "@alpaca-software/40kdc-data";
import abilityText from "./abilities-index.json" with { type: "json" };
window.DC = {
  units, factions, weapons, detachments, stratagems, enhancements,
  wargear, wargearOptions, abilities, abilityText,
};
