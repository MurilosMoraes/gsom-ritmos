// Textos dos pushes automáticos (cron-push-notifications), por idioma.
//
// O português é o que já saía antes da internacionalização e está aqui
// BYTE A BYTE igual: test/disparos-idioma-test.mts roda a função antiga e a
// nova lado a lado e quebra se um caractere mudar.
//
// Nas versões de fora do Brasil não entra preço em R$: o plano é cobrado
// pela loja e o valor muda por país. Por isso o espanhol e o inglês falam
// da diferença entre anual e mensal em porcentagem, que vale em qualquer
// moeda.

import { type Idioma, idiomaDoPais } from "./idioma.ts";

export interface MensagemPush {
  title: string;
  body: string;
}

/** Teste acaba em ~24h. */
export const PUSH_TRIAL_24H: Record<Idioma, MensagemPush> = {
  pt: {
    title: "Seu teste acaba amanhã",
    body: "Garante os 166 ritmos e o pedal antes do ensaio. Ativa o plano agora.",
  },
  es: {
    title: "Tu prueba termina mañana",
    body: "Asegura los 166 ritmos y el pedal antes del ensayo. Activa tu plan ahora.",
  },
  en: {
    title: "Your trial ends tomorrow",
    body: "Lock in the 166 grooves and the pedal before rehearsal. Activate your plan now.",
  },
};

/** Teste acabou hoje. */
export const PUSH_EXPIRED_TODAY: Record<Idioma, MensagemPush> = {
  pt: {
    title: "Seu teste acabou",
    body: "Volta pros 166 ritmos. No plano anual sai por R$ 19 por mês, 34% menos que o mensal.",
  },
  es: {
    title: "Tu prueba terminó",
    body: "Vuelve a los 166 ritmos. El plan anual sale 34% más barato por mes que el mensual.",
  },
  en: {
    title: "Your trial has ended",
    body: "Come back to the 166 grooves. The yearly plan costs 34% less per month than the monthly one.",
  },
};

/** Escolhe a mensagem pelo país do perfil. Sem país = português. */
export function mensagemPush(
  catalogo: Record<Idioma, MensagemPush>,
  country?: string | null,
): MensagemPush {
  return catalogo[idiomaDoPais(country)] || catalogo.pt;
}
