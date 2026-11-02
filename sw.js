/* Basket101 service worker: funciona sin conexión con los juegos ya descargados.
   La versión de la caché la pone sola build.py (huella de los archivos),
   así que no hay que tocarla a mano nunca más. */
const CACHE = 'basket101-__BUILD__';
const CORE = [
  './', 'index.html', 'statshunter.html', 'trophyhunter.html', 'nbaorder.html', 'nbamulti.html', 'nbaraya.html', 'nbawordle.html', 'datos-nba.js',
  'privacidad.html', 'ranking.html', 'online.html', '404.html', 'hunter-account.js', 'manifest.webmanifest',
  'fonts/poppins.css',
  'fonts/poppins-latin-500-normal.woff2', 'fonts/poppins-latin-600-normal.woff2', 'fonts/poppins-latin-700-normal.woff2',
  'fonts/poppins-latin-800-normal.woff2', 'fonts/poppins-latin-900-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Misma web: red primero (para recibir actualizaciones), pero si la red tarda más
// de 3 s (cobertura mala) se sirve lo guardado para no dejar la pantalla en blanco.
// Firebase y demás dominios externos no se tocan.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/__/')) return;
  const network = fetch(e.request).then(res => {
    if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  network.catch(() => {});
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  const slow = new Promise(resolve => setTimeout(resolve, 3000)).then(cached);
  e.respondWith(
    Promise.race([network, slow.then(r => r || network)])
      .catch(() => cached().then(r => r || caches.match('index.html')))
  );
});
