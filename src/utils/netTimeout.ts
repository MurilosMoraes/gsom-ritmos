// Corta uma promise de REDE que pode ficar pendurada.
//
// BUG DE OFFLINE (cold start): `navigator.onLine` MENTE — no Android
// WebView e no desktop com WiFi-sem-internet ele reporta `true` mesmo
// sem conexão real. Aí o app entra no caminho "online" e o `fetch` de
// validação de sessão/perfil OU a query do Supabase fica pendurada no
// timeout de TCP do SO (30s a 2min) em vez de rejeitar — o `catch` do
// offline NUNCA dispara e o app trava eternamente no "carregando".
//
// Isso RESOLVE: se a chamada não voltar em `ms`, rejeita com 'net-timeout',
// e o fallback offline (cache local) assume — igual a quando a rede falha
// de vez. Rede boa responde em bem menos que isso, então online não é
// afetado.
//
// IMPORTANTE: os builders do Supabase (`.from().select()...`) são
// "thenables", não Promises reais — envolva em Promise.resolve(builder)
// antes de passar aqui pra o TypeScript e o Promise.race aceitarem.
export function withNetTimeout<T>(promise: Promise<T>, ms = 6000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('net-timeout')), ms)
    ),
  ]);
}
