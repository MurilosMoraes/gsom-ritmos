// Liga, numa chamada só, tudo que faz o app respeitar o motivo pelo qual
// foi aberto: link de recuperar senha, de renovação, de campanha, de
// afiliado, e toque em push.
//
// ⚠️ CHAMAR NO BOOT DE TODA PÁGINA DO APP. Sem exceção.
//
// Cada .html é um contexto JS separado. Antes disto existir, o listener
// era registrado só em index, login e plans, e quem estivesse em register,
// payment-success, completar-cadastro ou demo simplesmente não recebia
// nada: o cliente tocava no link e o app abria na home.
//
// A regra é: página nova do app nasce chamando isto. Se esquecer, o bug
// volta calado, e é do tipo que o cliente não sabe reportar direito ("às
// vezes não vai").

import { initDeepLinks } from './DeepLinks';
import { escutarToquesDePush } from './NativePushService';

let ligado = false;

export function bootIntencao(): void {
  if (ligado) return;
  ligado = true;
  // Fire-and-forget: nada aqui pode segurar o carregamento da tela.
  void initDeepLinks().catch(() => { /* web ou plugin ausente */ });
  void escutarToquesDePush().catch(() => { /* idem */ });
}
