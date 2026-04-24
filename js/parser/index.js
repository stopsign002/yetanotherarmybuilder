/* index.js — public WahapediaParser API. Loads last; all helpers already
 * attached to WahapediaParser._internal by sibling modules. */

(function () {
  const P = window.WahapediaParser;
  const I = P._internal;

  P.parse              = I.parse;
  P.addToSharedIndex   = I.addToSharedIndex;
  P.releaseSharedIndex = I.releaseSharedIndex;
})();
