// Strings do HTML estático (hidratação data-i18n) de login.html, register.html
// e completar-cadastro.html. Valores BYTE-IDÊNTICOS ao texto que já estava
// nesses arquivos — a hidratação em pt-BR é um no-op visual.
export const htmlAuth: Record<string, string> = {
  // ─── Compartilhado entre páginas ────────────────────────────────────
  'htmlAuth.emailLabel': 'E-mail',
  'htmlAuth.passwordLabel': 'Senha',
  'htmlAuth.cpfLabel': 'CPF',
  'htmlAuth.cpfPlaceholder': '000.000.000-00',
  'htmlAuth.whatsappLabel': 'WhatsApp',

  // ─── login.html ──────────────────────────────────────────────────────
  'htmlAuth.docTitleLogin': 'Entrar no GDrums | Baterista Virtual',
  'htmlAuth.login.title': 'Bora tocar.',
  'htmlAuth.login.subtitle': 'Entra na tua conta e continua de onde parou.',
  'htmlAuth.login.passwordPlaceholder': 'Sua senha',
  'htmlAuth.login.rememberMe': 'Lembrar de mim',
  'htmlAuth.login.forgotPassword': 'Esqueci a senha',
  'htmlAuth.login.backBtn': 'Entrar com outro e-mail',
  'htmlAuth.login.firstTime': 'Primeira vez?',
  'htmlAuth.login.createFreeAccount': 'Criar conta grátis',
  'htmlAuth.login.trialSub': '48h pra testar tudo · sem cartão',
  'htmlAuth.login.supportLink': 'Precisa de ajuda? Falar com o suporte',
  'htmlAuth.login.glory': 'Pra honra e glória de Deus',

  // Ticker de ritmos (nomes de gênero — não traduzidos em nenhum idioma)
  'htmlAuth.login.ticker.sertanejo': 'Sertanejo',
  'htmlAuth.login.ticker.forro': 'Forró',
  'htmlAuth.login.ticker.gospel': 'Gospel',
  'htmlAuth.login.ticker.pagode': 'Pagode',
  'htmlAuth.login.ticker.vaneira': 'Vaneira',
  'htmlAuth.login.ticker.rock': 'Rock',
  'htmlAuth.login.ticker.samba': 'Samba',
  'htmlAuth.login.ticker.bossaNova': 'Bossa Nova',
  'htmlAuth.login.ticker.reggae': 'Reggae',
  'htmlAuth.login.ticker.piseiro': 'Piseiro',
  'htmlAuth.login.ticker.xote': 'Xote',
  'htmlAuth.login.ticker.mpb': 'MPB',
  'htmlAuth.login.ticker.arrocha': 'Arrocha',
  'htmlAuth.login.ticker.bachata': 'Bachata',
  'htmlAuth.login.ticker.worship': 'Worship',
  'htmlAuth.login.ticker.frevo': 'Frevo',
  'htmlAuth.login.ticker.carimbo': 'Carimbó',
  'htmlAuth.login.ticker.funk': 'Funk',

  // ─── register.html ───────────────────────────────────────────────────
  'htmlAuth.docTitleRegister': 'Criar conta no GDrums | 48h Grátis',
  'htmlAuth.register.pitchTitle': 'Sua banda no celular.',
  'htmlAuth.register.pitchSub': 'Mais de 120 ritmos brasileiros pra tocar ao vivo com qualidade de banda completa. 48h grátis pra testar, sem cartão.',
  'htmlAuth.register.title': 'Crie sua conta.',
  'htmlAuth.register.subtitle': '48h grátis pra testar tudo. Sem cartão.',
  'htmlAuth.register.nameLabel': 'Nome',
  'htmlAuth.register.countryLabel': 'País',
  'htmlAuth.register.namePlaceholder': 'Seu nome',
  'htmlAuth.register.phoneLabel': 'WhatsApp <span style="opacity:0.55;font-weight:500;text-transform:none;letter-spacing:0;">(opcional)</span>',
  'htmlAuth.register.termsCheckbox': 'Aceito os <a href="/terms">termos de uso</a> e a <a href="/privacy">política de privacidade</a>',
  'htmlAuth.register.submitBtn': 'Começar grátis',
  'htmlAuth.register.footerText': 'Já tem conta? <a href="login.html">Entrar</a>',

  // ─── completar-cadastro.html ─────────────────────────────────────────
  'htmlAuth.docTitleCompletarCadastro': 'Completar cadastro | GDrums',
  'htmlAuth.completarCadastro.overline': 'Falta pouco!',
  'htmlAuth.completarCadastro.title': 'Termina seu cadastro',
  'htmlAuth.completarCadastro.subtitle': 'A gente precisa do seu CPF e WhatsApp pra confirmar sua conta e te avisar de novidades. Leva 30 segundos.',
  'htmlAuth.completarCadastro.logoutText': 'Não é você? <a id="ccLogout">Sair</a>',
};
