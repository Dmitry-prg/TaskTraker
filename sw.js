/* ============================================================
   Service Worker для Task Tracker
   - предзагрузка «оболочки» приложения
   - офлайн-режим для навигации
   - кеш Google Fonts (runtime)
   ============================================================ */

const APP_VERSION = 'v2';
const SHELL_CACHE  = `tt-shell-${APP_VERSION}`;
const FONT_CACHE   = `tt-fonts-${APP_VERSION}`;

/* Ресурсы оболочки — кешируются при установке SW.
   Пути относительные — работают и на GitHub Pages под подпапкой. */
const SHELL_ASSETS = [
  './',
  './index.html',
  './project.html',
  './style.css',
  './app.js',
  './index.js',
  './project.js',
  './manifest.webmanifest',
  './icon.png'
];

/* ---------- install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(err => {
        // Если какой-то файл отсутствует — не роняем install
        console.warn('[SW] Не удалось предзагрузить часть ресурсов:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

/* ---------- activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== SHELL_CACHE && k !== FONT_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Кешируем только GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* --- Google Fonts — runtime-кеш, cache-first --- */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // Всё, что не наш origin — не трогаем
  if (url.origin !== self.location.origin) return;

  /* --- Навигация — network-first, fallback на кеш --- */
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL_CACHE, './index.html'));
    return;
  }

  /* --- Остальное — stale-while-revalidate --- */
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

/* ============================================================
   Стратегии
   ============================================================ */

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return hit || Response.error();
  }
}

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    return new Response('Офлайн — данных нет', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await fetchPromise) || Response.error();
}