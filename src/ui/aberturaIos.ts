// O QUE MOSTRAR NA ABERTURA DO APP NO iPHONE.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUE ESTE MODAL EXISTE (não dá pra simplesmente tirar)
// ═══════════════════════════════════════════════════════════════════════
// O iOS exige um toque do usuário pra liberar o áudio (AudioContext) e pro
// pedal Bluetooth funcionar. Sem esse toque o app abre mudo e o pedal não
// responde, e o cliente acha que quebrou. O modal existe pra garantir esse
// toque, e é por isso que ele é blocante.
//
// ⚠️ O QUE NÃO PODE MUDAR: o `unlockAudio()` tem que rodar SÍNCRONO dentro
// do clique. Nada de await, nada de setTimeout antes dele. Perdeu o
// contexto do gesto, o iOS ignora e o pedal morre. Ver o bloco do pedal
// em main.ts.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUE ELE MUDOU
// ═══════════════════════════════════════════════════════════════════════
// Ele dizia só "Tudo pronto". É o melhor espaço do app: aparece em TODA
// abertura, em tela cheia, e o cliente é obrigado a tocar. Impressão de
// 100%, atenção total, e estava sendo gasto com um aviso que não diz nada.
//
// Agora o toque continua sendo um toque, mas a tela em volta dele fala do
// que interessa pra AQUELE cliente naquele dia.
//
// ═══════════════════════════════════════════════════════════════════════
// REGRAS QUE EU NÃO PODIA QUEBRAR
// ═══════════════════════════════════════════════════════════════════════
// - Decisão 100% LOCAL e síncrona. O modal aparece antes do perfil chegar
//   da rede, e travar a abertura do app esperando rede seria pior que o
//   problema que estou resolvendo. Usa o cache de perfil que o app já
//   grava e as chaves de localStorage que já existem.
// - Quem ACABOU DE PAGAR não leva oferta na cara. Respeita o mesmo sinal
//   que o resto do app usa (`gdrums-awaiting-payment`).
// - No iOS nunca se fala em preço nem em site: quem cobra é a Apple, na
//   moeda dela. Só CTA pra tela de planos, que aciona o StoreKit.
// - Uma variante por abertura, e a de oferta tem teto por dia, pra não
//   virar perseguição.

export interface EstadoAbertura {
  /** Do cache de perfil (OfflineCache). Null se nunca logou/cacheou. */
  status: 'active' | 'trial' | 'expired' | 'canceled' | null;
  /** ISO. Null se não tem. */
  venceEm: string | null;
  /** Já mapeou/usou pedal alguma vez? (gdrums_pedal_keys) */
  temPedal: boolean;
  /** Já montou algum repertório? (gdrums-setlists-v2) */
  temRepertorio: boolean;
  /** Já baixou o conteúdo pra usar offline? (gdrums-offline-ready) */
  temOffline: boolean;
  /** Foi pagar agora há pouco? (gdrums-awaiting-payment) */
  pagandoAgora: boolean;
  /** Quantas vezes a variante de oferta já apareceu hoje. */
  ofertasHoje: number;
  /** Agora, em ms. */
  agora: number;
}

export type Variante =
  | 'trial-acabando'     // teste perto do fim → assinar
  | 'renovar'            // plano pago vencendo → renovar
  | 'sem-pedal'          // nunca configurou o pedal → ativar o diferencial
  | 'sem-repertorio'     // nunca montou repertório → ativar
  | 'sem-offline'        // não baixou pra offline → evita frustração no palco
  | 'padrao';            // o "Tudo pronto" de sempre

/** Quantas aberturas por dia podem trazer oferta de dinheiro. */
export const MAX_OFERTAS_DIA = 2;

/** Teste com menos que isto: hora de converter. */
export const TRIAL_ALERTA_H = 24;

/** Plano pago vencendo em menos que isto: hora de renovar. */
export const RENOVAR_ALERTA_D = 7;

const H = 60 * 60 * 1000;
const D = 24 * H;

/**
 * Escolhe UMA variante. A ordem é a ordem do negócio:
 *
 * 1. dinheiro que está prestes a ser perdido (trial acabando, plano
 *    vencendo). É o momento de maior intenção que existe;
 * 2. ativação do que segura o cliente (pedal e repertório são o motivo de
 *    ele não trocar por outro app);
 * 3. offline, que evita a pior experiência possível: o app falhar no meio
 *    do show por falta de sinal;
 * 4. o "Tudo pronto" de sempre.
 */
export function escolherVariante(e: EstadoAbertura): Variante {
  // Acabou de pagar: não enche o saco. Nem com oferta, nem com renovação.
  const podeOferecer = !e.pagandoAgora && e.ofertasHoje < MAX_OFERTAS_DIA;

  const restante = e.venceEm ? new Date(e.venceEm).getTime() - e.agora : null;

  if (podeOferecer && e.status === 'trial' && restante !== null
      && restante > 0 && restante <= TRIAL_ALERTA_H * H) {
    return 'trial-acabando';
  }

  if (podeOferecer && e.status === 'active' && restante !== null
      && restante > 0 && restante <= RENOVAR_ALERTA_D * D) {
    return 'renovar';
  }

  // Ativação só pra quem TEM acesso: oferecer "configure seu pedal" pra
  // quem está bloqueado é deboche.
  const temAcesso = (e.status === 'active' || e.status === 'trial')
    && restante !== null && restante > 0;

  if (temAcesso && !e.temPedal) return 'sem-pedal';
  if (temAcesso && !e.temRepertorio) return 'sem-repertorio';
  if (temAcesso && !e.temOffline) return 'sem-offline';

  return 'padrao';
}

/** A variante mexe com dinheiro? (conta no teto diário) */
export function eOferta(v: Variante): boolean {
  return v === 'trial-acabando' || v === 'renovar';
}

/**
 * Pra onde o botão leva. `null` = só fecha o modal e usa o app.
 *
 * ⚠️ Em todos os casos o áudio é destravado ANTES de navegar. O destino
 * nunca pode vir antes do unlock.
 */
export function destinoDaVariante(v: Variante): string | null {
  switch (v) {
    case 'trial-acabando': return '/plans';
    case 'renovar':        return '/plans?renew=true';
    default:               return null;   // pedal, repertório e offline
  }                                       // se resolvem dentro do app
}

/**
 * Botão que o modal deve acionar dentro do app, pras variantes que não
 * navegam pra lugar nenhum.
 *
 * Sem isto o modal de ativação seria conversa fiada: dizia "configure seu
 * pedal" e o botão só fechava, deixando o cliente procurar sozinho no
 * menu. Quem toca precisa chegar na tela, não receber conselho.
 *
 * São ids que já existem no index.html; o modal só dá o clique.
 */
export function botaoDaVariante(v: Variante): string | null {
  switch (v) {
    case 'sem-pedal':       return 'pedalMapBtn';
    case 'sem-repertorio':  return 'setlistEditBtn';
    case 'sem-offline':     return 'menuOfflineBtn';
    default:                return null;
  }
}

/** Chaves de i18n da variante: título, texto e botão. */
export function textosDaVariante(v: Variante): { titulo: string; corpo: string; cta: string } {
  if (v === 'padrao') {
    return {
      titulo: 'main.iosStartup.title',
      corpo: 'main.iosStartup.body',
      cta: 'main.iosStartup.cta',
    };
  }
  return {
    titulo: `main.abertura.${v}.titulo`,
    corpo: `main.abertura.${v}.corpo`,
    cta: `main.abertura.${v}.cta`,
  };
}
