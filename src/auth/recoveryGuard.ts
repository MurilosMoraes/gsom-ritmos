// Recovery / Magic Link guard.
//
// Quando o user clica num link de recuperação de senha do email, o
// Supabase abre alguma página do site com um fragmento tipo:
//   #access_token=xxx&type=recovery&...
//
// O ÚNICO lugar que sabe processar esse fragmento é o login.html (via
// login.ts → handlePasswordRecovery). Se o user cair em qualquer outra
// página (raiz "/", landing, plans, etc.), o JS dessa página vai
// processar a sessão e redirecionar perdendo o contexto de recovery.
//
// Defesa: cada entrypoint chama redirectIfRecoveryHash() ANTES de
// qualquer outra lógica. Se detectar hash de recovery, redireciona
// pra /login.html mantendo o fragmento.
//
// Roda só no browser. Em app nativo (Capacitor) este código nem é
// alcançado nesse cenário porque o user clica no link do email no
// navegador externo do celular, não dentro do app.

const RECOVERY_FLAGS = ['type=recovery', 'type=magiclink', 'type=signup'];

/**
 * Se a URL tem hash de recovery e a página atual NÃO é o login.html,
 * redireciona pra /login.html preservando o hash. Retorna true se
 * redirecionou — caller deve abortar inicialização nesse caso.
 */
export function redirectIfRecoveryHash(): boolean {
  try {
    const hash = window.location.hash || '';
    if (!hash) return false;

    const isRecovery = RECOVERY_FLAGS.some(flag => hash.includes(flag));
    if (!isRecovery) return false;

    const path = window.location.pathname || '/';
    const onLogin = /\/login(\.html)?$/i.test(path);
    if (onLogin) return false;

    // Mantém o hash. Não usa internalNav porque internalNav pode
    // adicionar .html dependendo do contexto e queremos URL exata.
    const target = '/login.html' + window.location.search + hash;
    window.location.replace(target);
    return true;
  } catch {
    return false;
  }
}
