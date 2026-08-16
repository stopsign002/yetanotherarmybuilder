// app/first-time-tour.js — onboarding tour disabled.
// The tour was annoying users who already know Warhammer; the file is kept
// as a no-op stub so the index.html script tag remains valid. (It also used to
// mention a service-worker PRECACHE entry — there is no precache list any more,
// the worker is stale-while-revalidate; see app/sw.js.) App.replayTour stays
// defined so settings-drawer.js can safely call it (it just no-ops).
(function () {
  const App = window.App = window.App || {};
  App.replayTour = function () {};
  App.startTour  = function () {};
})();
