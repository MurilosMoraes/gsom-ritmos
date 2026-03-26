import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        landing: './landing.html',
        login: './login.html',
        register: './register.html',
        admin: './admin.html',
        plans: './plans.html',
        paymentSuccess: './payment-success.html'
      }
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Cachear app shell (HTML, CSS, JS) — excluir imagens grandes do precache
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        // Cachear runtime: samples e ritmos
        runtimeCaching: [
          {
            // Samples de áudio — cache first (raramente mudam)
            urlPattern: /\/midi\/.+\.(wav|mp3)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gdrums-samples',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 dias
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Ritmos JSON — stale while revalidate (atualiza em background)
            urlPattern: /\/rhythm\/.+\.json$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'gdrums-rhythms',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 dias
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Manifest dos ritmos — network first (precisa estar atualizado)
            urlPattern: /\/rhythm\/manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gdrums-manifest',
              expiration: {
                maxAgeSeconds: 24 * 60 * 60 // 1 dia
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Manifest dos MIDIs
            urlPattern: /\/midi\/manifest\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gdrums-midi-manifest',
              expiration: {
                maxAgeSeconds: 24 * 60 * 60
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Imagens — cache first
            urlPattern: /\/img\/.+\.(png|jpg|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gdrums-images',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 30 * 24 * 60 * 60
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: 'GDrums — Sequenciador de Ritmos',
        short_name: 'GDrums',
        description: 'Sequenciador de bateria profissional com 12 canais',
        theme_color: '#030014',
        background_color: '#030014',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/img/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/img/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/img/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  server: {
    port: 3000,
    open: true
  }
});
