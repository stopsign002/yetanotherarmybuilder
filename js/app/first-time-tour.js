// app/first-time-tour.js — onboarding tour disabled.
// The tour was annoying users who already know Warhammer; the file is kept
// as a no-op stub so the index.html script tag and SW PRECACHE entry
// remain valid. App.replayTour stays defined so settings-drawer.js can
// safely call it (it just no-ops).
(function () {
  const App = window.App = window.App || {};
  App.replayTour = function () {};
  App.startTour  = function () {};
})();
