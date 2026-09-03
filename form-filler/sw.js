/* Caches everything the tool needs so it keeps working with no network at all. */
const CACHE = 'form-filler-v1.0';
const ASSETS = [
  './', './index.html', './app.js', './detect.js', './manifest.json',
  './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/pdf-lib.min.js',
  './vendor/mammoth.min.js', './vendor/html2canvas.min.js',
  '../icons/icon-form-filler-192.png', '../icons/icon-form-filler-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
