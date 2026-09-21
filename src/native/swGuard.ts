// Limpeza de service worker DENTRO do app nativo.
//
// Até a 1.5.0 o app nativo saía com o service worker registrado (o
// registerSW.js do build roda em qualquer contexto). No Android, que é
// servido por https://localhost, isso fazia o app novo ser entregue a
// partir do cache do app antigo: você instalava build novo e via tela
// velha. O build novo já não registra mais (ver vite.config.ts), mas quem
// atualizou por cima continua com o SW antigo preso no aparelho.
//
// Esta função desregistra o que ficou e apaga os caches. Só roda no app
// nativo: na web o service worker é o que faz o PWA funcionar offline e
// o que entrega o push do OneSignal.

import { isNativeApp } from './Platform';

export async function limparServiceWorkerNoNativo(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (regs && regs.length > 0) {
      await Promise.all(regs.map(r => r.unregister().catch(() => false)));
      const chaves = await caches?.keys?.();
      if (chaves) await Promise.all(chaves.map(k => caches.delete(k).catch(() => false)));
      // O HTML desta sessão veio do cache antigo: recarrega uma vez pra
      // pegar o build de verdade. Marca pra não entrar em laço.
      const marca = 'gdrums-sw-limpo';
      if (!sessionStorage.getItem(marca)) {
        sessionStorage.setItem(marca, '1');
        location.reload();
      }
    }
  } catch { /* aparelho sem suporte: nada a limpar */ }
}
