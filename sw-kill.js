// sw-kill.js — emergency kill switch.
// To use: copy this file to sw.js and deploy. Every visitor whose browser
// fetches it will have their old SW unregistered and all yaab caches wiped.
// After all users are cleaned up, restore: git checkout sw.js && deploy.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.navigate(c.url));
});
