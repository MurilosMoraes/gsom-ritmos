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
 * Se a URL tem token de recovery (hash legacy OU query PKCE) e a página
 * atual NÃO é o login.html, redireciona pra /login.html preservando
 * search + hash. Retorna true se redirecionou — caller deve abortar
 * inicialização nesse caso.
 */
export function redirectIfRecoveryHash(): boolean {
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';

    // Implicit flow (legacy): #type=recovery, #access_token=...
    const hasHashRecovery = !!hash && (
      RECOVERY_FLAGS.some(flag => hash.includes(flag)) ||
      hash.includes('access_token=')
    );

    // PKCE flow (default supabase-js v2): ?code=... na query string.
    // Não dá pra distinguir 100% se é recovery vs magic link só pelo code,
    // mas em ambos casos o destino correto é o login.html (que sabe
    // processar e mostrar form de nova senha se a sessão for recovery).
    const hasPkceCode = /[?&]code=[A-Za-z0-9_-]+/.test(search);

    // token_hash (template de email com {{ .TokenHash }}): validado via
    // verifyOtp — INDEPENDE de onde o reset foi pedido. É o formato
    // robusto pro app nativo (App Links forçam o link a abrir no app,
    // e o PKCE ?code= só valida no contexto que PEDIU o reset).
    const hasTokenHash = /[?&]token_hash=/.test(search) || /[?&#]token_hash=/.test(hash);

    if (!hasHashRecovery && !hasPkceCode && !hasTokenHash) return false;

    const path = window.location.pathname || '/';
    const onLogin = /\/login(\.html)?$/i.test(path);
    if (onLogin) return false;

    // Mantém search (PKCE code) + hash (Implicit token).
    const target = '/login.html' + search + hash;
    window.location.replace(target);
    return true;
  } catch {
    return false;
  }
}
