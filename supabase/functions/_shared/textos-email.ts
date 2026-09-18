// Textos e molde da régua de e-mail (cron-recovery-emails), por idioma.
//
// O PORTUGUÊS NÃO MUDA. O texto pt continua vindo do banco
// (gdrums_email_campaigns), o molde pt é o mesmo de sempre e o HTML gerado
// é BYTE A BYTE o de hoje: test/disparos-idioma-test.mts roda a função
// antiga e a nova lado a lado com a mesma fila falsa e quebra se um
// caractere mudar.
//
// Fora do Brasil o e-mail muda de conteúdo, não só de idioma:
//   - sem WhatsApp: o número é brasileiro e o suporte de fora é por e-mail
//     (contato@gdrums.com.br);
//   - sem cupom e sem preço em R$: o cupom vale no checkout brasileiro
//     (InfinitePay, Pix, boleto), que cliente de fora não usa;
//   - o botão leva pra App Store, que é por onde a assinatura de fora sai.
//
// Campanha nova cadastrada na tela e ainda sem tradução aqui NÃO deixa de
// ser enviada: cai no texto do banco (português) e o nome dela volta em
// `sem_traducao` na resposta do cron, pra aparecer que falta traduzir.

import { type Idioma, idiomaDoPais } from "./idioma.ts";

export const LINK_APP_STORE = "https://apps.apple.com/app/gdrums/id6766099516";
export const EMAIL_SUPORTE = "contato@gdrums.com.br";

export interface Campanha {
  id: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  cta_label: string;
  coupon: string | null;
}

/** Só a parte de texto: o cupom e o resto continuam vindo do banco. */
export interface TextoCampanha {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta_label: string;
}

type ParIdiomas = { es: TextoCampanha; en: TextoCampanha };

export const TRADUCOES: Record<string, ParIdiomas> = {
  trial_h0: {
    es: {
      subject: "{nome}, tu prueba terminó ahora",
      heading: "¡Hola {nome}!",
      paragraphs: [
        "Tu prueba de 48 horas terminó ahora. Si GDrums te ayudó en el ensayo, puedes seguir desde donde paraste: el repertorio que armaste y los ritmos que guardaste siguen ahí.",
        "Son 166 ritmos, el pedal Bluetooth funcionando hasta en el iPhone, y modo sin conexión para tocar en ese lugar donde no hay señal.",
      ],
      cta_label: "Seguir con GDrums",
    },
    en: {
      subject: "{nome}, your trial just ended",
      heading: "Hey {nome}!",
      paragraphs: [
        "Your 48 hour trial just ended. If GDrums helped you at rehearsal, you can pick up where you left off: the setlist you built and the grooves you saved are still there.",
        "That is 166 grooves, the Bluetooth pedal working even on the iPhone, and offline mode for that place with no signal.",
      ],
      cta_label: "Keep GDrums",
    },
  },

  trial_d3: {
    es: {
      subject: "{nome}, el pedal es la parte que nadie copia",
      heading: "Algo que solo GDrums hace",
      paragraphs: [
        "Pedal Bluetooth funcionando en el iPhone. Parece un detalle, pero es lo que cambia el show: cambias de ritmo, pides el break y terminas la canción sin sacar la mano del instrumento.",
        "Quien toca solo y canta sabe la diferencia entre eso y estar tocando la pantalla del celular en medio de la canción.",
      ],
      cta_label: "Ver los planes",
    },
    en: {
      subject: "{nome}, the pedal is the part nobody copies",
      heading: "One thing only GDrums does",
      paragraphs: [
        "A Bluetooth pedal that works on the iPhone. It sounds like a detail, but it is what changes the show: you switch grooves, call the fill and end the song without taking your hand off the instrument.",
        "Anyone who plays alone and sings knows the difference between that and poking at a phone in the middle of a song.",
      ],
      cta_label: "See the plans",
    },
  },

  trial_d7: {
    es: {
      subject: "{nome}, tu prueba terminó hace una semana",
      heading: "Un empujón",
      paragraphs: [
        "Hace una semana que terminó tu prueba y no volviste. Si el GDrums te sirvió aunque sea una vez, vale la pena tenerlo listo para el próximo ensayo.",
        "Son los 166 ritmos, el pedal, el repertorio y el modo sin conexión. La suscripción se activa por la App Store.",
      ],
      cta_label: "Ver los planes",
    },
    en: {
      subject: "{nome}, your trial ended a week ago",
      heading: "A little push",
      paragraphs: [
        "Your trial ended a week ago and you have not come back. If GDrums helped you even once, it is worth having it ready for the next rehearsal.",
        "That is all 166 grooves, the pedal, the setlist and offline mode. You subscribe through the App Store.",
      ],
      cta_label: "See the plans",
    },
  },

  trial_d15: {
    es: {
      subject: "{nome}, última nota mía",
      heading: "Último recordatorio",
      paragraphs: [
        "No voy a insistir más que esto. Si en algún momento necesitas una banda en el ensayo, GDrums va a estar aquí.",
        "Y si tuviste algún problema cuando lo probaste, responde este correo contando cuál. Lo arreglamos más rápido de lo que imaginas.",
      ],
      cta_label: "Ver los planes",
    },
    en: {
      subject: "{nome}, one last note from me",
      heading: "Last reminder",
      paragraphs: [
        "I will not push any further than this. Whenever you need a band at rehearsal, GDrums will be here.",
        "And if something went wrong when you tried it, reply to this email and tell me what. We fix things faster than you would expect.",
      ],
      cta_label: "See the plans",
    },
  },

  trial_d30: {
    es: {
      subject: "{nome}, entró algo nuevo en GDrums",
      heading: "Pasó un mes",
      paragraphs: [
        "Desde que lo probaste, entró un ritmo nuevo cada semana. Si tocaste en algún lugar este mes y te faltó una base, vale la pena mirar de nuevo.",
      ],
      cta_label: "Ver lo que cambió",
    },
    en: {
      subject: "{nome}, something new landed in GDrums",
      heading: "It has been a month",
      paragraphs: [
        "Since you tried it, a new groove has landed every week. If you played somewhere this month and missed having a backing track, it is worth another look.",
      ],
      cta_label: "See what changed",
    },
  },

  reativacao: {
    es: {
      subject: "{nome}, GDrums cambió desde que lo probaste",
      heading: "Hace tiempo que no hablamos",
      paragraphs: [
        "Probaste GDrums y no seguiste, y ya pasó un tiempo. Desde entonces la biblioteca pasó a 166 ritmos y entra algo nuevo cada semana.",
        "Si sigues tocando y todavía te cuesta tener una base decente en el ensayo, vale la pena mirar de nuevo.",
      ],
      cta_label: "Ver los planes",
    },
    en: {
      subject: "{nome}, GDrums has changed since you tried it",
      heading: "It has been a while",
      paragraphs: [
        "You tried GDrums and did not stick with it, and that was a while ago. Since then the library grew to 166 grooves and something new lands every week.",
        "If you are still playing and still struggle to get a decent backing track at rehearsal, it is worth another look.",
      ],
      cta_label: "See the plans",
    },
  },

  volta_d1: {
    es: {
      subject: "{nome}, tu suscripción venció",
      heading: "Tu suscripción venció",
      paragraphs: [
        "Tu acceso a GDrums venció ayer. Tu repertorio y tus ritmos siguen guardados: al renovar, todo vuelve exactamente como estaba.",
      ],
      cta_label: "Renovar ahora",
    },
    en: {
      subject: "{nome}, your subscription expired",
      heading: "Your subscription expired",
      paragraphs: [
        "Your GDrums access expired yesterday. Your setlist and your grooves are still saved: renew and everything comes back exactly as it was.",
      ],
      cta_label: "Renew now",
    },
  },

  volta_d7: {
    es: {
      subject: "{nome}, lo que entró desde que te fuiste",
      heading: "Cambiaron cosas por aquí",
      paragraphs: [
        "Hace una semana que cayó tu suscripción. En ese tiempo entró ritmo nuevo, y la app gana algo cada semana.",
        "Si paraste por un motivo específico, responde este correo contando cuál. Eso vale más para nosotros que la suscripción.",
      ],
      cta_label: "Volver a GDrums",
    },
    en: {
      subject: "{nome}, what landed since you left",
      heading: "Things changed around here",
      paragraphs: [
        "Your subscription lapsed a week ago. Since then new grooves landed, and the app gains something every week.",
        "If you stopped for a specific reason, reply to this email and tell me what it was. That is worth more to us than the subscription.",
      ],
      cta_label: "Come back to GDrums",
    },
  },

  volta_d30: {
    es: {
      subject: "{nome}, hace un mes que te fuiste",
      heading: "Hace un mes que te fuiste",
      paragraphs: [
        "Ya fuiste cliente, así que sabes si GDrums sirve para lo que tocas. Si quieres volver, tu repertorio sigue guardado exactamente como lo dejaste.",
      ],
      cta_label: "Volver a GDrums",
    },
    en: {
      subject: "{nome}, it has been a month since you left",
      heading: "It has been a month since you left",
      paragraphs: [
        "You were a subscriber, so you know whether GDrums fits what you play. If you want to come back, your setlist is still saved exactly as you left it.",
      ],
      cta_label: "Come back to GDrums",
    },
  },
};

/** Textos fixos do molde, por idioma. O pt é o de sempre. */
const MOLDE: Record<Idioma, {
  lang: string;
  tagline: string;
  cupomTitulo: string;
  cupomOff: string;
  conversa: string;
  rodape: string;
}> = {
  pt: {
    lang: "pt-BR",
    tagline: "Sua banda inteira no celular",
    cupomTitulo: "Cupom no seu nome",
    cupomOff: "% OFF em qualquer plano",
    conversa: "Prefere conversar? Me chama no WhatsApp.",
    rodape: "É só responder esse email que a gente conversa.<br>GDrums · Gold Sound on Music · gdrums.com.br",
  },
  es: {
    lang: "es",
    tagline: "Toda tu banda en el celular",
    cupomTitulo: "Cupón a tu nombre",
    cupomOff: "% OFF en cualquier plan",
    conversa: `¿Prefieres hablar? Escríbenos a ${EMAIL_SUPORTE}.`,
    rodape: `Responde este correo y hablamos.<br>GDrums · Gold Sound on Music · gdrums.com.br`,
  },
  en: {
    lang: "en",
    tagline: "Your whole band on your phone",
    cupomTitulo: "Coupon in your name",
    cupomOff: "% OFF on any plan",
    conversa: `Rather talk it through? Write to ${EMAIL_SUPORTE}.`,
    rodape: `Just reply to this email and we will talk.<br>GDrums · Gold Sound on Music · gdrums.com.br`,
  },
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * Monta o HTML do e-mail. Com idioma "pt" e cupom ligado a saída é
 * exatamente a de antes da internacionalização.
 */
export function render(
  c: Campanha,
  nome: string,
  desconto: number,
  porMes: string,
  link: string,
  idioma: Idioma = "pt",
  usaCupom = true,
): string {
  const T = MOLDE[idioma] || MOLDE.pt;

  const troca = (t: string) =>
    t.replace(/\{nome\}/g, nome)
     .replace(/\{desconto\}/g, String(desconto))
     .replace(/\{porMes\}/g, porMes);

  const C = {
    fundo: "#050510", carta: "#0d0d1a", borda: "rgba(255,255,255,0.09)",
    texto: "rgba(255,255,255,0.72)", forte: "#ffffff",
    fraco: "rgba(255,255,255,0.42)", azul: "#00D4FF", verde: "#00E68C",
  };

  const paragrafos = c.paragraphs
    .map((p) => `<p style="color:${C.texto};font-size:0.95rem;line-height:1.72;margin:0 0 16px;">${esc(troca(p))}</p>`)
    .join("");

  const blocoCupom = (usaCupom && c.coupon)
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;"><tr><td align="center" style="background:rgba(0,230,140,0.07);border:1px solid rgba(0,230,140,0.22);border-radius:14px;padding:18px 14px;">
<div style="font-size:0.66rem;color:rgba(0,230,140,0.75);text-transform:uppercase;letter-spacing:2.2px;margin-bottom:7px;">${T.cupomTitulo}</div>
<div style="font-size:2rem;font-weight:900;color:${C.verde};letter-spacing:3px;line-height:1.1;">${esc(c.coupon)}</div>
<div style="font-size:1.02rem;color:${C.forte};font-weight:700;margin-top:4px;">${desconto}${T.cupomOff}</div>
</td></tr></table>` : "";

  // Bloco de contato: WhatsApp só no Brasil (o número é brasileiro).
  const wa = `https://wa.me/5547984639792?text=` + encodeURIComponent(
    `Oi! Sou ${nome}, testei o GDrums e queria tirar uma dúvida.`);
  const conversa = idioma === "pt"
    ? `<p style="color:${C.texto};font-size:0.88rem;line-height:1.6;margin:0 0 13px;">${T.conversa}</p>
<a href="${wa}" style="display:inline-block;padding:11px 22px;background:#25D366;color:#04120a;text-decoration:none;border-radius:11px;font-weight:700;font-size:0.9rem;">Falar no WhatsApp</a>`
    : `<p style="color:${C.texto};font-size:0.88rem;line-height:1.6;margin:0;">${esc(T.conversa)}</p>`;

  return `<!DOCTYPE html>
<html lang="${T.lang}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GDrums</title></head>
<body style="margin:0;padding:0;background:${C.fundo};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fundo};"><tr><td align="center" style="padding:28px 16px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td align="center" style="padding-bottom:26px;">
<div style="font-size:1.7rem;font-weight:800;color:${C.azul};letter-spacing:-0.5px;">GDrums</div>
<div style="color:${C.fraco};font-size:0.8rem;margin-top:2px;">${T.tagline}</div>
</td></tr>
<tr><td style="background:${C.carta};border:1px solid ${C.borda};border-radius:18px;padding:30px 26px;">
<div style="color:${C.forte};font-size:1.25rem;font-weight:700;margin-bottom:14px;">${esc(troca(c.heading))}</div>
${paragrafos}
${blocoCupom}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:4px 0 22px;">
<a href="${link}" style="display:inline-block;padding:15px 38px;background:${C.azul};color:#04121a;text-decoration:none;border-radius:12px;font-weight:800;font-size:1rem;">${esc(troca(c.cta_label))}</a>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.borda};"><tr><td align="center" style="padding-top:20px;">
${conversa}
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding-top:22px;">
<p style="color:rgba(255,255,255,0.26);font-size:0.72rem;line-height:1.6;margin:0;">${T.rodape}</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

export interface EmailMontado {
  idioma: Idioma;
  /** Desconto do cupom como o banco vê. A guarda do cron continua usando ele. */
  desconto: number | null;
  assunto: string;
  html: string;
  /** true quando a campanha ainda não tem tradução e caiu no português. */
  semTraducao: boolean;
}

/**
 * Monta assunto e HTML pro destinatário, no idioma do país do perfil.
 *
 * `desconto` é sempre o do banco (null = cupom não está valendo), pra guarda
 * do cron continuar igual. O cupom só ENTRA na mensagem no caminho pt.
 */
export function montarEmail(
  camp: Campanha,
  nome: string,
  country: string | null | undefined,
  desconto: number | null,
  porMes: string,
): EmailMontado {
  const idioma = idiomaDoPais(country);

  if (idioma === "pt") {
    const link = `https://gdrums.com.br/plans?${camp.coupon ? `coupon=${camp.coupon}&` : ""}` +
      `utm_source=email&utm_medium=regua&utm_campaign=${camp.id}`;
    const assunto = camp.subject.replace(/\{nome\}/g, nome)
      .replace(/\{desconto\}/g, String(desconto ?? 0));
    return {
      idioma, desconto, assunto, semTraducao: false,
      html: render(camp, nome, desconto ?? 0, porMes, link, "pt", true),
    };
  }

  const traducao = TRADUCOES[camp.id]?.[idioma];
  // Sem tradução cadastrada: manda o texto do banco em vez de não mandar
  // nada, e o cron devolve o id da campanha em `sem_traducao`.
  const texto: TextoCampanha = traducao ?? {
    subject: camp.subject, heading: camp.heading,
    paragraphs: camp.paragraphs, cta_label: camp.cta_label,
  };

  // Fora do Brasil a assinatura sai pela loja, não pelo checkout brasileiro:
  // sem cupom no link e sem cupom na mensagem.
  const campTraduzida: Campanha = { ...camp, ...texto };
  const assunto = texto.subject.replace(/\{nome\}/g, nome).replace(/\{desconto\}/g, "0");

  return {
    idioma, desconto, assunto, semTraducao: !traducao,
    html: render(campTraduzida, nome, 0, porMes, LINK_APP_STORE, idioma, false),
  };
}
