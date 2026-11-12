// Fabrique la version téléphone (PWA installable) dans web/ à partir de src/.
// Usage : node outils/web.js
const fs = require('fs');
const path = require('path');
const racine = path.join(__dirname, '..');
const src = path.join(racine, 'src');
const web = path.join(racine, 'web');

fs.rmSync(web, { recursive: true, force: true });
fs.cpSync(src, web, { recursive: true });

// icônes PNG : on reprend l'image PNG contenue dans chaque .ico (en-tête ICO de 22 octets)
for (const nom of ['matin', 'repas']) {
  const ico = fs.readFileSync(path.join(racine, 'icones', nom + '.ico'));
  fs.writeFileSync(path.join(web, nom + '.png'), ico.subarray(22));
}

const APPS = {
  matin: { name: 'Tableau du matin', short_name: 'Matin', theme: '#0f1115' }, // = fond du thème Nuit : barres du téléphone sombres
  repas: { name: 'Repas & courses', short_name: 'Repas', theme: '#3f7a4f' },
};
const fichiers = fs.readdirSync(web, { recursive: true }).filter((f) => fs.statSync(path.join(web, f)).isFile()).map((f) => f.replace(/\\/g, '/'));
const version = Date.now().toString(36);

for (const [nom, a] of Object.entries(APPS)) {
  fs.writeFileSync(path.join(web, `manifest-${nom}.json`), JSON.stringify({
    id: `./${nom}.html`, name: a.name, short_name: a.short_name, start_url: `./${nom}.html`, scope: './',
    display: 'standalone', background_color: '#14161b', theme_color: a.theme, lang: 'fr',
    icons: [{ src: `${nom}.png`, sizes: '256x256', type: 'image/png', purpose: 'any' }],
  }, null, 2));
  const f = path.join(web, nom + '.html');
  let html = fs.readFileSync(f, 'utf8');
  html = html
    .replace("default-src 'self';", "default-src 'self'; manifest-src 'self'; worker-src 'self';")
    .replace('</title>', `</title>
<link rel="manifest" href="manifest-${nom}.json">
<link rel="icon" href="${nom}.png">
<link rel="apple-touch-icon" href="${nom}.png">
<meta name="theme-color" content="${a.theme}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${a.short_name}">`)
    .replace('</body>', `<script src="pwa.js"></script>\n</body>`)
    // ?v= : le navigateur ne peut pas mélanger une page neuve avec un ancien script en cache
    .replace(/(src|href)="([\w/.-]+\.(?:js|css))"/g, `$1="$2?v=${version}"`);
  fs.writeFileSync(f, html);
}

fs.writeFileSync(path.join(web, 'pwa.js'), "if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');\n");
// service worker : l'app s'ouvre même sans réseau ; météo et synchro passent toujours par le réseau
fs.writeFileSync(path.join(web, 'sw.js'), `const CACHE = 'mesapps-${version}';
const FICHIERS = ${JSON.stringify(['./', ...fichiers.map((f) => './' + f), './pwa.js', './manifest-matin.json', './manifest-repas.json', './matin.png', './repas.png'].filter((v, i, t) => t.indexOf(v) === i && v !== './'))};
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))); self.clients.claim(); });
// briefing du matin envoyé par la fonction Supabase
self.addEventListener('push', (e) => {
  let d = { title: 'Ton briefing', body: '', url: './matin.html?briefing=1' };
  try { d = { ...d, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: 'matin.png', badge: 'matin.png', tag: 'briefing', renotify: true,
    data: { url: d.url }, actions: [{ action: 'ecouter', title: '🔊 Écouter' }],
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './matin.html?briefing=1', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
    const c = liste.find((x) => x.url.includes('matin.html'));
    return c ? c.navigate(url).then((w) => (w || c).focus()) : self.clients.openWindow(url);
  }));
});
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
`);
fs.writeFileSync(path.join(web, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=matin.html"><title>Mes apps</title><a href="matin.html">Tableau du matin</a> · <a href="repas.html">Repas &amp; courses</a>`);
fs.writeFileSync(path.join(web, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/sw.js\n  Cache-Control: no-cache\n`);
console.log('web/ prêt :', fichiers.length + 8, 'fichiers');
