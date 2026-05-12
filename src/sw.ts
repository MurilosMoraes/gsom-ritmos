/// <reference lib="webworker" />
// Service Worker custom — Workbox PWA + OneSignal push juntos.
//
// Por que custom em vez do generateSW do vite-plugin-pwa?
//
// OneSignal precisa de SW registrado em scope "/" (raiz do domínio) pra
// receber push. O Workbox também registra em "/". Browsers permitem só
// UM SW por scope — o último a registrar ganha, o outro fica órfão.
//
// Resultado anterior: ambos os SWs eram registrados, Workbox vencia,
// OneSignal SDK Worker ficava sem controle de clientes. OneSignal mandava
// push (successful=1 na API), mas Chrome Android entregava pro Workbox
// SW que não tem handler de `push` → nenhuma notificação aparecia
// (received=0 nos analytics).
//
// Solução: ESTE arquivo é o único SW. Ele faz:
//   1. importScripts do OneSignal SDK Worker (handlers de push/notif)
//   2. Workbox precaching + runtime caching pro PWA
//
// O importScripts roda primeiro e registra os event listeners do OneSignal.
// Depois o Workbox adiciona os seus. Como `push` é evento que o OneSignal
// consome, e fetch/install são do Workbox, não há colisão.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope;

// ════════════════════════════════════════════════════════════════════
// OneSignal — tem que vir ANTES de qualquer outro listener de push.
// O OneSignal SDK Worker adiciona seus próprios handlers de `push`,
// `notificationclick`, etc. Carregar via importScripts no nível top do
// SW garante que os listeners ficam registrados antes do install.
// ════════════════════════════════════════════════════════════════════
self.importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

// ════════════════════════════════════════════════════════════════════
// Workbox — precache + runtime caching
// ════════════════════════════════════════════════════════════════════

// Ativação imediata: novo SW assume controle sem esperar abas fecharem.
self.skipWaiting();
// @ts-ignore — clientsClaim global do workbox
self.addEventListener('activate', () => {
  // @ts-ignore
  self.clients.claim();
});

cleanupOutdatedCaches();

// Manifest injetado em build time pelo vite-plugin-pwa.
precacheAndRoute(self.__WB_MANIFEST || []);

// SPA fallback — denylist de rotas que NÃO devem cair pra index.html.
// Mesmas regras que estavam no generateSW antes.
const denylist: RegExp[] = [
  /^\/register(\.html)?/,
  /^\/login(\.html)?/,
  /^\/plans(\.html)?/,
  /^\/admin(\.html)?/,
  /^\/landing(\.html)?/,
  /^\/demo(\.html)?/,
  /^\/payment-success(\.html)?/,
  /^\/affiliate(\.html)?/,
  /^\/terms(\.html)?/,
  /^\/privacy(\.html)?/,
  /^\/excluir-conta(\.html)?/,
  /^\/links(\.html)?/,
  /^\/completar-cadastro(\.html)?/,
  /^\/download(\/.*)?(\.html)?$/,
];

// Samples de áudio — cache first (raramente mudam)
registerRoute(
  ({ url }) => /\/midi\/.+\.(wav|mp3)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'gdrums-samples',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// Ritmos JSON — stale while revalidate
registerRoute(
  ({ url }) => /\/rhythm\/.+\.json$/.test(url.pathname) && !/manifest\.json$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'gdrums-rhythms',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    ],
  })
);

// HTMLs — NetworkFirst pra pegar CSP atualizada.
registerRoute(
  ({ request }) => request.destination === 'document',
  new NetworkFirst({
    cacheName: 'gdrums-html',
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 }),
    ],
  })
);

// Manifests — NetworkFirst (precisam estar atualizados)
registerRoute(
  ({ url }) => /\/rhythm\/manifest\.json$/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'gdrums-manifest',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 }),
    ],
  })
);

registerRoute(
  ({ url }) => /\/midi\/manifest\.json$/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'gdrums-midi-manifest',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxAgeSeconds: 24 * 60 * 60 }),
    ],
  })
);

// Imagens — cache first
registerRoute(
  ({ url }) => /\/img\/.+\.(png|jpg|svg)$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'gdrums-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// SPA navigation fallback — só pra rotas NÃO no denylist
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'gdrums-nav-fallback',
      networkTimeoutSeconds: 3,
    }),
    { denylist }
  )
);
