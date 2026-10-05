/* Caches everything the tool needs so it keeps working with no network at all. */
const CACHE = 'daycare-forms-v1.3';
const ASSETS = [
  './', './index.html', './app.js', './forms.js', './manifest.json', './vendor/pdf-lib.min.js',
  './templates/renseignements-2026.pdf', './templates/entente-bc-2026.pdf',
  './templates/entente-ministere-2026.pdf', './templates/contribution-reduite-2026.pdf',
  './templates/fiche-identification-en.pdf', './templates/fiche-assiduite-2026.pdf',
  './templates/attestation-2026.pdf',
  '../icons/icon-daycare-forms-192.png', '../icons/icon-daycare-forms-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('daycare-forms-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
