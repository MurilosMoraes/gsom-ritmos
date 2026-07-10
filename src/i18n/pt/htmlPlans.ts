// Strings do HTML estático (hidratação data-i18n) — valores BYTE-IDÊNTICOS
// aos literais do HTML original (fallback pt-BR é um no-op visual).
export const htmlPlans: Record<string, string> = {
  // ─── plans.html ───────────────────────────────────────────────────
  'htmlPlans.plansDocTitle': 'Planos GDrums | A partir de R$ 9,90',
  'htmlPlans.plansMetaDescription': 'Planos do GDrums com acesso a 155 ritmos, suporte a pedal Bluetooth (vendido separadamente) e apps iOS/Android. Mensal R$ 29, Anual R$ 228, Rei dos Palcos (3 anos) R$ 522.',
  'htmlPlans.plansOgTitle': 'Planos GDrums — A partir de R$ 9,90',
  'htmlPlans.plansOgDescription': 'Acesso total: 155 ritmos, suporte a pedal Bluetooth, apps iOS/Android. Trial 48h grátis sem cartão.',
  'htmlPlans.plansTwitterDescription': 'Acesso total: 155 ritmos, suporte a pedal Bluetooth, apps iOS/Android.',
  'htmlPlans.plansSupportLink': 'Suporte',
  'htmlPlans.plansOverline': 'Planos',
  'htmlPlans.plansTitle': 'Escolha como quer seguir.',
  'htmlPlans.plansSubtitle': `
        Todos os planos incluem a biblioteca completa, suporte a pedal
        Bluetooth, setlist e modo offline. Sem limite de uso. Cancele
        quando quiser. <span style="opacity:0.6;font-size:0.85em;">(pedal vendido separadamente)</span>
      `,
  'htmlPlans.plansCouponPlaceholder': 'Tem um cupom?',
  'htmlPlans.plansCouponApplyBtn': 'Aplicar',
  'htmlPlans.plansFooterPayment': 'Pagamento seguro via InfinitePay.',
  'htmlPlans.plansGlory': 'Pra honra e glória de Deus',
  'htmlPlans.plansLoadingText': 'Redirecionando para pagamento',

  // ─── payment-success.html ─────────────────────────────────────────
  'htmlPlans.paymentSuccessDocTitle': 'Pagamento Confirmado | GDrums',
  'htmlPlans.paymentSuccessInitialMsg': 'Estamos confirmando seu pagamento. Isso leva poucos segundos.',
  'htmlPlans.paymentSuccessAccessBtn': 'Acessar GDrums',

  // ─── demo.html ────────────────────────────────────────────────────
  'htmlPlans.demoDocTitle': 'GDrums | Teste Grátis sem Cadastro | Baterista Virtual',
  'htmlPlans.demoMetaDescription': 'Teste o GDrums agora sem cadastro. 5 ritmos liberados, acompanhamento profissional pra tocar ao vivo. Biblioteca com 155 ritmos brasileiros.',
  'htmlPlans.demoOgTitle': 'GDrums — Teste Grátis sem Cadastro',
  'htmlPlans.demoOgDescription': '5 ritmos liberados sem cadastro. Biblioteca com 155 ritmos brasileiros, pedal Bluetooth, viradas e finalizações.',
  'htmlPlans.demoTwitterDescription': '5 ritmos liberados. Biblioteca com 155 ritmos brasileiros, pedal Bluetooth.',
  'htmlPlans.demoTopbarHeadline': `
        Cadastre e tenha <strong>48h grátis</strong> pra tocar tudo
      `,
  'htmlPlans.demoCounterFallback': 'Prévia com 5 ritmos · <strong>155 no catálogo</strong>',
  'htmlPlans.demoTopbarCtaLabel': 'Começar grátis',
  'htmlPlans.demoValueBannerText': 'Essa é a banda real. <strong>Cadastra grátis</strong> pra liberar tudo.',
  'htmlPlans.demoValueCtaLabel': 'Começar',
  'htmlPlans.demoAllRhythmsBtnAria': 'Ver todos os ritmos',
  'htmlPlans.demoAllRhythmsBtnContent': `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                  <line x1="4" y1="6" x2="20" y2="6"></line>
                  <line x1="4" y1="12" x2="20" y2="12"></line>
                  <line x1="4" y1="18" x2="20" y2="18"></line>
                </svg>
                Ver todos os ritmos
              `,
  'htmlPlans.demoCellRitmo': 'RITMO',
  'htmlPlans.demoCellVirada': 'VIRADA',
  'htmlPlans.demoCellPrato': 'PRATO',
};
