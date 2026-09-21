import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * O registerSW.js gerado pelo vite-plugin-pwa registra o service worker em
 * QUALQUER contexto, inclusive dentro do app nativo. No Android o Capacitor
 * serve o app por https://localhost, então o SW assume o controle e passa a
 * entregar os arquivos da instalação anterior: build novo instalado, app
 * velho na tela. Aqui o registro passa a acontecer só na web.
 */
function swSoNaWeb() {
  return {
    name: 'gdrums-sw-so-na-web',
    enforce: 'post' as const,
    closeBundle() {
      const arquivo = resolve(__dirname, 'dist/registerSW.js');
      if (!existsSync(arquivo)) return;
      const original = readFileSync(arquivo, 'utf8');
      if (original.includes('capacitor:')) return;
      const guardado = `// GDrums: nunca registrar o service worker dentro do app nativo.
// Capacitor serve o app por capacitor:// (iOS) ou https://localhost (Android);
// com SW registrado, o build novo é servido do cache do build antigo.
if (location.protocol !== 'capacitor:' && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {
${original}
}
`;
      writeFileSync(arquivo, guardado);
    },
  };
}

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
        landingEs: './landing-es.html',
        landingEn: './landing-en.html',
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
    swSoNaWeb(),
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
        // Links do próprio domínio (ex: /?c=CÓDIGO da comunidade) devem abrir
        // NA PWA instalada, não numa aba do navegador:
        //  - handle_links 'preferred'  -> pede pro navegador capturar os links
        //  - launch_handler            -> reaproveita a janela já aberta em vez
        //    de abrir outra (senão daria pra ficar com 2 GDrums abertos)
        // O navegador ainda tem a palavra final; no Chrome desktop dá pra
        // ligar/desligar em "Abrir links compatíveis no GDrums".
        handle_links: 'preferred',
        launch_handler: { client_mode: 'navigate-existing' },
        icons: [
          // "any" = ícone da PWA instalada no PC (desktop usa este). Arquivo
          // dedicado icon-pc-* pra NÃO afetar favicon/SERP/WhatsApp/celular,
          // que continuam usando icon-512/192 originais.
          {
            src: '/img/icon-pc-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/img/icon-pc-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/img/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/img/icon-maskable-512.png',
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
