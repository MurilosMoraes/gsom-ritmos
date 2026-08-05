// Guardas de e-mail do cadastro (usadas pela register-account).
//
// Isolado em módulo próprio porque é REGRA DE NEGÓCIO com dinheiro em jogo:
// um falso positivo aqui impede um cliente pagante de criar conta. Fica
// separado pra poder ser testado de verdade (test/email-guard-test.ts roda
// ESTE arquivo, não uma cópia).
//
// Contexto (2026-08-05): estavam entrando contas "Teste" via e-mail
// descartável (davopa.com, kingcq.com) só pra pegar o trial de 48h — o
// bloqueio por CPF não pega isso porque cada uma usa um CPF diferente.
// E, do outro lado, cliente que PAGOU cadastrou "@gmail.come" e nunca vai
// receber confirmação nem recuperação de senha.
//
// Só vale pra cadastro NOVO. Quem já tem conta não é afetado.

// ── Guarda 1: e-mails descartáveis ───────────────────────────────────
// Serviços de "e-mail temporário": gera endereço, usa 10 minutos, joga
// fora. Manutenção: sempre nascem domínios novos, então isso corta o
// volume mas não é barreira definitiva — a defesa real de trial farming
// continua sendo o CPF/telefone único.
export const DISPOSABLE_DOMAINS = new Set([
  // Vistos em produção. O fmail.com entrou depois: na primeira olhada
  // pareciam 3 contas soltas e um domínio real demais pra bloquear, mas o
  // histórico completo mostrou 9 contas (04/07 a 05/08), todas trial, todas
  // com R$ 0,00 pago, login uma vez e sumiram, com nome preenchido de
  // qualquer jeito ("Carlos a", "Marco ot", "Claudio e"). As 12 foram
  // apagadas em 05/08/2026.
  "davopa.com", "kingcq.com", "fmail.com",
  // grandes serviços de temp mail
  "mailinator.com", "yopmail.com", "guerrillamail.com", "guerrillamail.info",
  "sharklasers.com", "grr.la", "temp-mail.org", "tempmail.com", "tempmail.net",
  "10minutemail.com", "10minutemail.net", "throwawaymail.com", "trashmail.com",
  "maildrop.cc", "getnada.com", "nada.email", "dispostable.com", "fakeinbox.com",
  "mailnesia.com", "mytemp.email", "tempr.email", "discard.email",
  "moakt.com", "tmpmail.org", "emailondeck.com", "mohmal.com",
  "spamgourmet.com", "mailcatch.com", "inboxkitten.com", "linshiyouxiang.net",
  "1secmail.com", "1secmail.org", "1secmail.net", "vjuum.com", "laafd.com",
  "txcct.com", "esiix.com", "wwjmp.com", "dcctb.com", "xojxe.com",
  "yoggm.com", "cevipsa.com", "poplk.com", "minuteinbox.com",
  "tmail.ws", "mailexpire.com", "spam4.me", "tmpeml.com", "tmails.net",
]);

// ── Guarda 2: domínio digitado errado ────────────────────────────────
// Correções EXPLÍCITAS, sem adivinhação por similaridade: "email.com" é um
// domínio real e fica a 1 letra de "gmail.com", então chute automático
// barraria gente legítima. Precisão vale mais que abrangência — falso
// positivo aqui é cliente pagante impedido de cadastrar.
export const DOMAIN_TYPOS: Record<string, string> = {
  // gmail
  "gmail.come": "gmail.com", "gmail.com.com": "gmail.com", "gmail.con": "gmail.com",
  "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.comm": "gmail.com",
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.cim": "gmail.com",
  "gmail.vom": "gmail.com", "gamil.com": "gmail.com", "gmail.om": "gmail.com",
  "gmaill.com": "gmail.com", "gmail.copm": "gmail.com", "gmail.xom": "gmail.com",
  "gnail.com": "gmail.com", "gmail.clm": "gmail.com", "gmail.cok": "gmail.com",
  // hotmail
  "hotmail.come": "hotmail.com", "hotmail.con": "hotmail.com", "hotmail.co": "hotmail.com",
  "hotmail.com.com": "hotmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
  "hotmail.cm": "hotmail.com", "hotmail.comm": "hotmail.com", "hotamil.com": "hotmail.com",
  "rotmail.com": "hotmail.com", "hotmail.vom": "hotmail.com", "hotmail.xom": "hotmail.com",
  // outlook / live
  "outlook.come": "outlook.com", "outlook.con": "outlook.com", "outlok.com": "outlook.com",
  "outllok.com": "outlook.com", "outlook.com.com": "outlook.com",
  // yahoo
  "yahoo.come": "yahoo.com", "yahoo.con": "yahoo.com", "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com", "yahoo.com.com": "yahoo.com",
  // icloud / provedores BR comuns no público
  "icloud.come": "icloud.com", "icloud.con": "icloud.com", "iclould.com": "icloud.com",
  "bol.com.br.com": "bol.com.br", "uol.com.br.com": "uol.com.br",
  "terra.com.br.com": "terra.com.br", "globo.com.com": "globo.com",
};

/** Terminações que NÃO existem — ninguém tem e-mail válido assim.
 *  Pega erro de digitação que não está no mapa explícito acima.
 *  CUIDADO ao mexer: tem que continuar aceitando .com, .com.br, .br,
 *  .edu.br, .org, .net e qualquer TLD legítimo. */
export function tldInvalido(dominio: string): boolean {
  return /\.(con|cim|cpm|comm|come|xom|vom|cmo|clm|copm|ocm|c0m)$/i.test(dominio) ||
         /\.com\.com$/i.test(dominio);
}

export interface ProblemaEmail {
  erro: string;
  code: "email_invalid" | "email_disposable" | "email_typo";
}

/** Analisa o domínio do e-mail. Retorna o motivo da recusa, ou null se ok.
 *  Mensagens em linguagem simples e sem jargão: boa parte do público é
 *  senhor de idade que se atrapalha com formulário. */
export function checarEmail(emailNorm: string): ProblemaEmail | null {
  const dominio = (emailNorm.split("@")[1] || "").trim().toLowerCase();
  if (!dominio || !dominio.includes(".")) {
    return {
      erro: "Esse e-mail não parece completo. Confira se está certo (exemplo: seunome@gmail.com).",
      code: "email_invalid",
    };
  }

  // 1) Descartável — recusa direto, sem sugerir alternativa
  if (DISPOSABLE_DOMAINS.has(dominio)) {
    return {
      erro: "Esse tipo de e-mail temporário não é aceito. Use seu e-mail de verdade (Gmail, Hotmail, Outlook...) para não perder o acesso à sua conta.",
      code: "email_disposable",
    };
  }

  // 2) Erro de digitação conhecido — sugere o certo, já montado
  const sugestao = DOMAIN_TYPOS[dominio];
  if (sugestao) {
    const certo = emailNorm.split("@")[0] + "@" + sugestao;
    return {
      erro: `Parece que faltou uma letrinha no e-mail. Você quis dizer ${certo}?`,
      code: "email_typo",
    };
  }

  // 3) Terminação que não existe (.con, .come, .com.com...)
  if (tldInvalido(dominio)) {
    return {
      erro: `O final do e-mail "${dominio}" não existe. Confira se digitou certo (o comum é .com ou .com.br).`,
      code: "email_typo",
    };
  }

  return null;
}
