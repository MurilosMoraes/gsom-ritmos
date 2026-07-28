import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  root: '.',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
        paymentSuccess: './payment-success.html',
        affiliate: './affiliate.html',
        demo: './demo.html',
        terms: './terms.html',
        privacy: './privacy.html',
        excluirConta: './excluir-conta.html',
        links: './links.html',
        completarCadastro: './completar-cadastro.html',
        download: './download.html'
      }
    }
  },
  plugins: [
    VitePWA({
      // injectManifest: temos um SW custom em src/sw.ts que faz
      // importScripts do OneSignal SDK Worker + Workbox routing.
      // Necessário pra não ter 2 SWs competindo pelo scope "/" — antes
      // o Workbox SW vencia e o OneSignal SDK Worker ficava órfão, então
      // push aparecia successful=1 na API mas received=0 no Chrome Android.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        // Pré-cachear tudo: app shell + ritmos + samples + imagens.
        // EXCLUI midi-native/ — esses só são usados pelo NativeAudioEngine
        // em Capacitor (via bundle do app, não fetch). No web/PWA, web usa
        // /midi/ original. Incluir no precache web inflaria o download em
        // ~5MB sem benefício.
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2,json,wav,mp3,png}'],
        // OneSignalSDKWorker.js foi removido — agora o SW principal
        // (src/sw.ts) faz importScripts diretamente do CDN do OneSignal.
        globIgnores: ['**/midi-native/**', '**/OneSignalSDKWorker.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
      },
      manifest: {
        name: 'GDrums',
        short_name: 'GDrums',
        description: 'Seu baterista virtual no palco',
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
