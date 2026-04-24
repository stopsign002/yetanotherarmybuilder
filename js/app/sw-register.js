// app/sw-register.js - Register the app-shell service worker after window load.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[SW]', e));
    });
  }
})();
