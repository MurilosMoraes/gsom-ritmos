// Gera as landings internacionais a partir da landing em português:
//   landing.html → landing-es.html (gdrums.com.br/es) e landing-en.html (gdrums.com.br/en)
//
// Roda: node scripts/build-landing-i18n.mjs
//
// Mesmo visual e mesmos scripts da landing BR; muda só o texto e o que não
// serve fora do Brasil:
//   - sem preço em R$ e sem Modo Show 3 Dias (web/Android BR); o bloco de
//     planos vira "teste grátis + planos na sua moeda dentro do app";
//   - suporte por e-mail no lugar do grupo de WhatsApp brasileiro;
//   - termos/privacidade com ?lang=;
//   - head próprio (título, descrição, hreflang, canonical, dados estruturados).
//
// Cada troca exige que o trecho em português exista UMA vez. Se a landing BR
// mudar e algum trecho sumir, o script para com erro (não gera página pela
// metade). Depois de mexer na landing BR, rode de novo e confira.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pt = fs.readFileSync(path.join(root, 'landing.html'), 'utf8');

function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] trecho esperado 1x, achado ${n}x: ${from.slice(0, 80)}`);
  return src.replace(from, to);
}
function replaceBetween(src, startMarker, endMarker, to, label) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error(`[${label}] marcadores não achados`);
  if (src.indexOf(startMarker, a + 1) >= 0) throw new Error(`[${label}] início repetido`);
  return src.slice(0, a) + to + src.slice(b + endMarker.length);
}

const CHECK = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M16.5 6L7.5 15L3.5 11" stroke="#00D4FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>`;
const featureItems = items => items.map(t => `            <div class="feature-item">
              ${CHECK}
              <span>${t}</span>
            </div>`).join('\n');

const LANGS = {
  es: {
    file: 'landing-es.html',
    url: 'https://gdrums.com.br/es',
    htmlLang: 'es',
    ogLocale: 'es_LA',
    playHl: 'es',
    title: 'Ritmos de Batería y Baterista Virtual | GDrums',
    description: 'Ritmos de batería para tocar en vivo: 180 loops con redobles y finales en tu pedal Bluetooth. Cumbia, bachata, salsa, rock y pop. Prueba gratis 48h.',
    keywords: 'ritmos de batería, loops de batería, baterista virtual, caja de ritmos, batería electrónica, pedal bluetooth, tocar en vivo, pista de batería, GDrums',
    ogTitle: 'GDrums | Ritmos de Batería con Pedal Bluetooth',
    ogDescription: '180 ritmos de batería con redobles y finales en tu pedal Bluetooth. Tocar en vivo nunca fue tan profesional.',
    appDescription: 'Baterista virtual con 180 ritmos de batería, loops con redobles y finales, y soporte para pedal Bluetooth. Funciona sin conexión. Prueba gratis de 48h.',
    features: ['180 ritmos de batería', 'Control con pedal Bluetooth', 'Redobles, intros y finales', '3 variaciones por ritmo', 'Funciona sin conexión', 'Repertorios personalizados', 'Apps para iOS y Android'],
    faq: [
      ['¿Qué es GDrums?', 'GDrums es un baterista virtual para músicos que tocan en vivo. Ofrece 180 ritmos de batería con redobles, intros y finales, controlados con un pedal Bluetooth, en la web, iOS y Android.'],
      ['¿Cómo funciona el pedal Bluetooth?', 'Los pedales Bluetooth musicales funcionan como un teclado. GDrums los reconoce y los usa para cambiar de ritmo, hacer redobles y terminar la canción, sin tocar la pantalla.'],
      ['¿Cuánto cuesta GDrums?', 'Todos los usuarios nuevos tienen 48 horas gratis, sin tarjeta. Después hay planes mensual, trimestral, semestral y anual. El precio se muestra en tu moneda dentro de la app.'],
      ['¿GDrums funciona sin internet?', 'Sí. Después de descargar los ritmos, GDrums funciona sin conexión, ideal para escenarios con internet inestable.'],
      ['¿Qué estilos incluye?', 'Cumbia, bachata, salsa, reggaetón, tango, rumba, flamenco, bolero, pop, rock, blues, jazz, country, música cristiana y ritmos brasileños, entre otros.'],
    ],
    t: {
      navFeatures: 'Funciones', navPricing: 'Planes', navLogin: 'Entrar', navPlay: 'Tocar ahora',
      badgePlayAria: 'Descargar en Google Play', badgePlaySmall: 'Disponible en',
      badgeAppAria: 'Descargar en la App Store', badgeAppSmall: 'Disponible en',
      badgeIgAria: 'Seguir en Instagram', badgeIgSmall: 'Síguenos en',
      heroBadge: 'Más de 1.250 músicos ya lo usan',
      heroTitle: 'Tu banda completa<br/><span class="gradient-text">en el celular</span>',
      heroDesc: 'Toca con acompañamiento profesional en cualquier lugar.\n          <span class="js-rhythm-count">180</span> ritmos de batería, redobles y finales controlados con el pedal.',
      heroPlay: 'Tocar ahora', heroSignup: 'Crear cuenta gratis', heroSub: 'Sin registro. Empieza a tocar en 10 segundos.',
      statRhythms: 'Ritmos', statFree: 'Gratis', seePlans: 'ver planes →',
      featTitle: 'Tu banda te <span class="gradient-text">espera</span>',
      featDesc: 'Acompañamiento profesional que sostiene tu música de principio a fin',
      f1t: 'Biblioteca de ritmos listos', f1d: 'Ritmos de batería profesionales en varias categorías: latinos, pop/rock, cristianos, reggae, brasileños y más. Elige y toca.',
      f2t: 'Para tocar en vivo', f2d: 'Pantalla con 3 variaciones, 3 redobles, intro y final. Cambia en el momento justo, como lo haría un baterista de verdad.',
      f3t: 'Pedal Bluetooth a tu manera', f3d: 'Conecta cualquier pedal Bluetooth o USB y configura qué hace cada botón: iniciar, redoble, final. Manos libres en el escenario.',
      f4t: 'Favoritos y repertorio', f4d: 'Arma la lista del show en el orden correcto. Pasa de una canción a otra con un toque o con el pedal.',
      f5t: 'Sin conexión y siempre actualizado', f5d: 'Funciona sin internet en el escenario. Cuando te conectas, recibes ritmos nuevos: la biblioteca no para de crecer.',
      fbTitle: 'Quienes ya lo usan <span class="gradient-text">en el escenario</span>',
      fbDesc: 'Mensajes reales de músicos en Brasil que tocan con GDrums cada fin de semana',
      fbAlt: 'Mensaje de un usuario de GDrums', fbIg: 'Más testimonios en @gdrums_app',
      prTitle: 'Arma tu <span class="gradient-text">banda</span>',
      prDesc: 'Acceso completo a todos los ritmos, pedal Bluetooth y actualizaciones. Cancela cuando quieras.',
      trialTitle: 'Prueba gratis', trialPeriod: '/48h', trialDesc: 'Prueba todo sin compromiso',
      trialItems: ['Todos los ritmos de la biblioteca', 'Modo en vivo completo', 'Compatible con pedal Bluetooth', 'Favoritos y repertorio'],
      trialBtn: 'Crear cuenta',
      premTitle: 'GDrums Premium', premPrice: 'Tu moneda', premDesc: 'Planes mensual, trimestral, semestral y anual. El precio aparece en tu moneda dentro de la app.',
      premItems: ['Acceso total a todo', 'Ritmos nuevos todo el tiempo', 'Modo sin conexión', 'Soporte por correo'],
      premBtn: 'Empezar gratis',
      guarantee: 'Prueba gratis por 48 horas. Sin tarjeta de crédito. Cancela cuando quieras.',
      footTag: 'Tu baterista virtual en el escenario', footProduct: 'Producto', footAccount: 'Cuenta', footSupport: 'Soporte',
      footLogin: 'Entrar', footSignup: 'Crear cuenta', footEmail: 'Soporte por correo', footTerms: 'Términos de uso', footPrivacy: 'Política de privacidad',
      footRights: 'Todos los derechos reservados.', footGlory: 'Para honra y gloria de Dios',
      langSwitch: 'Português | English',
    },
  },
  en: {
    file: 'landing-en.html',
    url: 'https://gdrums.com.br/en',
    htmlLang: 'en',
    ogLocale: 'en_US',
    playHl: 'en',
    title: 'Drum Rhythms & Virtual Drummer App | GDrums',
    description: 'Drum rhythms for live music: 180 drum loops with fills and endings on your Bluetooth pedal. Latin, rock, pop, worship and more. Free for 48 hours.',
    keywords: 'drum rhythms, drum loops, virtual drummer, drum machine app, backing drums, bluetooth pedal, live performance, drum beats, GDrums',
    ogTitle: 'GDrums | Drum Rhythms with Bluetooth Pedal',
    ogDescription: '180 drum rhythms with fills and endings on your Bluetooth pedal. Playing live has never been this professional.',
    appDescription: 'Virtual drummer with 180 drum rhythms, drum loops with fills and endings, and Bluetooth pedal support. Works offline. 48-hour free trial.',
    features: ['180 drum rhythms', 'Bluetooth pedal control', 'Fills, intros and endings', '3 variations per rhythm', 'Works offline', 'Custom setlists', 'iOS and Android apps'],
    faq: [
      ['What is GDrums?', 'GDrums is a virtual drummer for musicians who play live. It offers 180 drum rhythms with fills, intros and endings, controlled with a Bluetooth pedal, on web, iOS and Android.'],
      ['How does the Bluetooth pedal work?', 'Music Bluetooth pedals act like a keyboard. GDrums recognizes them and uses them to switch rhythms, trigger fills and end the song, without touching the screen.'],
      ['How much does GDrums cost?', 'Every new user gets 48 hours free, no credit card. After that there are monthly, quarterly, semiannual and annual plans. Prices are shown in your local currency in the app.'],
      ['Does GDrums work offline?', 'Yes. Once the rhythms are downloaded, GDrums works without internet, perfect for venues with unreliable connections.'],
      ['Which styles are included?', 'Rock, pop, blues, jazz, country, reggae, worship, Latin grooves like cumbia, bachata, salsa and tango, and Brazilian rhythms like samba and bossa nova, among others.'],
    ],
    t: {
      navFeatures: 'Features', navPricing: 'Pricing', navLogin: 'Sign in', navPlay: 'Play now',
      badgePlayAria: 'Get it on Google Play', badgePlaySmall: 'Get it on',
      badgeAppAria: 'Download on the App Store', badgeAppSmall: 'Download on the',
      badgeIgAria: 'Follow on Instagram', badgeIgSmall: 'Follow us on',
      heroBadge: 'Trusted by 1,250+ musicians',
      heroTitle: 'Your full band<br/><span class="gradient-text">on your phone</span>',
      heroDesc: 'Play with professional backing anywhere.\n          <span class="js-rhythm-count">180</span> drum rhythms, fills and endings controlled with your pedal.',
      heroPlay: 'Play now', heroSignup: 'Sign up free', heroSub: 'No sign-up needed. Start playing in 10 seconds.',
      statRhythms: 'Rhythms', statFree: 'Free', seePlans: 'see pricing →',
      featTitle: 'Your band is <span class="gradient-text">ready</span>',
      featDesc: 'Professional backing that carries your song from start to finish',
      f1t: 'Ready-made rhythm library', f1d: 'Professional drum rhythms in many categories: Latin, pop/rock, worship, reggae, Brazilian and more. Pick one and play.',
      f2t: 'Built for live shows', f2d: 'A grid with 3 variations, 3 fills, an intro and an ending. It switches right on time, just like a real drummer.',
      f3t: 'Bluetooth pedal, your way', f3d: 'Connect any Bluetooth or USB pedal and choose what each button does: start, fill, ending. Hands-free on stage.',
      f4t: 'Favorites and setlists', f4d: 'Build your show setlist in the right order. Jump to the next song with one tap or with your pedal.',
      f5t: 'Offline and always up to date', f5d: 'Works without internet on stage. When you are online, you get new rhythms: the library keeps growing.',
      fbTitle: 'Musicians already using it <span class="gradient-text">on stage</span>',
      fbDesc: 'Real messages from musicians in Brazil who play with GDrums every weekend',
      fbAlt: 'Message from a GDrums user', fbIg: 'More reviews on @gdrums_app',
      prTitle: 'Build your <span class="gradient-text">band</span>',
      prDesc: 'Full access to every rhythm, Bluetooth pedal support and updates. Cancel anytime.',
      trialTitle: 'Free trial', trialPeriod: '/48h', trialDesc: 'Try everything, no strings attached',
      trialItems: ['Every rhythm in the library', 'Full live mode', 'Bluetooth pedal support', 'Favorites and setlists'],
      trialBtn: 'Create account',
      premTitle: 'GDrums Premium', premPrice: 'Your currency', premDesc: 'Monthly, quarterly, semiannual and annual plans. Prices are shown in your local currency in the app.',
      premItems: ['Full access to everything', 'New rhythms all the time', 'Offline mode', 'Email support'],
      premBtn: 'Start free',
      guarantee: 'Free for 48 hours. No credit card. Cancel anytime.',
      footTag: 'Your virtual drummer on stage', footProduct: 'Product', footAccount: 'Account', footSupport: 'Support',
      footLogin: 'Sign in', footSignup: 'Create account', footEmail: 'Email support', footTerms: 'Terms of use', footPrivacy: 'Privacy policy',
      footRights: 'All rights reserved.', footGlory: 'For the honor and glory of God',
      langSwitch: 'Português | Español',
    },
  },
};

function buildHead(L) {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization', '@id': 'https://gdrums.com.br/#organization', name: 'GDrums', url: 'https://gdrums.com.br',
        logo: { '@type': 'ImageObject', url: 'https://gdrums.com.br/img/icon-512.png', width: 512, height: 512 },
        email: 'contato@gdrums.com.br',
      },
      {
        '@type': 'SoftwareApplication', '@id': `${L.url}#app`, name: 'GDrums',
        applicationCategory: 'MultimediaApplication', applicationSubCategory: 'MusicApplication',
        operatingSystem: 'Web, iOS, Android', url: L.url, inLanguage: L.htmlLang,
        description: L.appDescription, featureList: L.features,
        author: { '@id': 'https://gdrums.com.br/#organization' },
        image: 'https://gdrums.com.br/img/og-logo-1200.png', screenshot: 'https://gdrums.com.br/img/app-img.png',
      },
      {
        '@type': 'WebPage', '@id': `${L.url}#webpage`, url: L.url, name: L.title, description: L.description,
        isPartOf: { '@id': 'https://gdrums.com.br/#organization' }, about: { '@id': `${L.url}#app` }, inLanguage: L.htmlLang,
      },
      {
        '@type': 'FAQPage', inLanguage: L.htmlLang,
        mainEntity: L.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  };
  return `<meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${L.title}</title>
  <meta name="description" content="${L.description}">
  <meta name="keywords" content="${L.keywords}">
  <meta name="author" content="Murilo Moraes, Staner Goulart">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${L.url}">
  <link rel="alternate" hreflang="pt-BR" href="https://gdrums.com.br/landing">
  <link rel="alternate" hreflang="es" href="https://gdrums.com.br/es">
  <link rel="alternate" hreflang="en" href="https://gdrums.com.br/en">
  <link rel="alternate" hreflang="x-default" href="https://gdrums.com.br/en">

  <!-- Gerado por scripts/build-landing-i18n.mjs a partir de landing.html. Não editar à mão. -->

  <link rel="icon" type="image/png" sizes="512x512" href="/img/icon-512.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/img/icon-192.png">
  <link rel="apple-touch-icon" sizes="192x192" href="/img/icon-192.png">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="GDrums">
  <meta property="og:title" content="${L.ogTitle}">
  <meta property="og:description" content="${L.ogDescription}">
  <meta property="og:image" content="https://gdrums.com.br/img/og-logo-1200.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="1200">
  <meta property="og:url" content="${L.url}">
  <meta property="og:locale" content="${L.ogLocale}">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${L.ogTitle}">
  <meta name="twitter:description" content="${L.ogDescription}">
  <meta name="twitter:image" content="https://gdrums.com.br/img/og-logo-1200.png">

  <meta name="theme-color" content="#030014">
  <meta name="msapplication-TileColor" content="#030014">

  <script type="application/ld+json">
${JSON.stringify(graph, null, 2)}
  </script>
`;
}

function buildPricing(t) {
  return `<section id="pricing" class="pricing">
    <div class="container">
      <div class="section-header">
        <h2 class="section-title">${t.prTitle}</h2>
        <p class="section-description">${t.prDesc}</p>
      </div>

      <div class="pricing-grid">
        <div class="pricing-card">
          <div class="pricing-header">
            <h3 class="pricing-title">${t.trialTitle}</h3>
            <div class="pricing-price">
              <span class="amount">0</span>
              <span class="period">${t.trialPeriod}</span>
            </div>
            <p class="pricing-description">${t.trialDesc}</p>
          </div>
          <div class="pricing-features">
${featureItems(t.trialItems)}
          </div>
          <a href="/register" class="pricing-button">${t.trialBtn}</a>
        </div>

        <div class="pricing-card popular">
          <div class="pricing-header">
            <h3 class="pricing-title">${t.premTitle}</h3>
            <div class="pricing-price">
              <span class="amount" style="font-size:1.6rem;">${t.premPrice}</span>
            </div>
            <p class="pricing-description">${t.premDesc}</p>
          </div>
          <div class="pricing-features">
${featureItems(t.premItems)}
          </div>
          <a href="/register" class="pricing-button gradient">${t.premBtn}</a>
        </div>
      </div>

      <div class="pricing-guarantee">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" stroke="url(#gradient1)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <defs>
            <linearGradient id="gradient1" x1="4" y1="2" x2="20" y2="22">
              <stop stop-color="#00D4FF"/>
              <stop offset="1" stop-color="#8B5CF6"/>
            </linearGradient>
          </defs>
        </svg>
        <p>${t.guarantee}</p>
      </div>
    </div>
  </section>`;
}

for (const [code, L] of Object.entries(LANGS)) {
  const t = L.t;
  let s = pt;
  const R = (from, to) => { s = replaceOnce(s, from, to, `${code}`); };

  s = replaceOnce(s, '<html lang="pt-BR">', `<html lang="${L.htmlLang}">`, code);
  s = replaceBetween(s, '<meta name="viewport"', '  </script>\n\n  <link rel="stylesheet" href="landing-styles.css">',
    buildHead(L) + '\n  <link rel="stylesheet" href="landing-styles.css">', `${code}:head`);

  // Navegação
  R('<a href="#features">Recursos</a>\n          <a href="#pricing">Planos</a>\n          <a href="login.html" class="btn-nav-secondary">Entrar</a>\n          <a href="/?entrar=1" class="btn-nav">Tocar Agora</a>',
    `<a href="#features">${t.navFeatures}</a>\n          <a href="#pricing">${t.navPricing}</a>\n          <a href="/login" class="btn-nav-secondary">${t.navLogin}</a>\n          <a href="/?entrar=1" class="btn-nav">${t.navPlay}</a>`);

  // Selos das lojas
  R('https://play.google.com/store/apps/details?id=com.gdrums.app&hl=pt', `https://play.google.com/store/apps/details?id=com.gdrums.app&hl=${L.playHl}`);
  R('aria-label="Baixar na Google Play"', `aria-label="${t.badgePlayAria}"`);
  R('<span class="store-badge-small">Disponível no</span>', `<span class="store-badge-small">${t.badgePlaySmall}</span>`);
  R('https://apps.apple.com/br/app/gdrums/id6766099516', 'https://apps.apple.com/app/gdrums/id6766099516');
  R('aria-label="Baixar na App Store"', `aria-label="${t.badgeAppAria}"`);
  R('<span class="store-badge-small">Disponível na</span>', `<span class="store-badge-small">${t.badgeAppSmall}</span>`);
  R('aria-label="Seguir no Instagram"', `aria-label="${t.badgeIgAria}"`);
  R('<span class="store-badge-small">Siga no</span>', `<span class="store-badge-small">${t.badgeIgSmall}</span>`);

  // Topo
  R('<div class="hero-badge">+1250 músicos já estão usando</div>', `<div class="hero-badge">${t.heroBadge}</div>`);
  R('Sua Banda Completa<br/><span class="gradient-text">no Celular</span>', t.heroTitle);
  R('Toque com acompanhamento profissional em qualquer lugar.\n          <span class="js-rhythm-count">180</span> ritmos, viradas e finalizações controladas pelo pedal.', t.heroDesc);
  R('<span>Tocar Agora</span>', `<span>${t.heroPlay}</span>`);
  R('<a href="register.html" class="btn-secondary" style="padding:0.75rem 1.5rem;">\n            <span>Cadastrar grátis</span>',
    `<a href="/register" class="btn-secondary" style="padding:0.75rem 1.5rem;">\n            <span>${t.heroSignup}</span>`);
  R('<p class="hero-subtext">Sem cadastro. Comece a tocar em 10 segundos.</p>', `<p class="hero-subtext">${t.heroSub}</p>`);
  R('<div class="stat-label">Ritmos</div>', `<div class="stat-label">${t.statRhythms}</div>`);
  R('<div class="stat-label">Grátis</div>', `<div class="stat-label">${t.statFree}</div>`);
  // Faixa de preços em R$: fora do Brasil vira só o link pros planos
  s = replaceBetween(s, '        <!-- Mini-strip de preços', 'ver detalhes dos planos →</a>',
    `        <a href="#pricing" class="hero-pricing-link">${t.seePlans}</a>`, `${code}:strip`);

  // Recursos
  R('Sua banda te <span class="gradient-text">esperando</span>', t.featTitle);
  R('Acompanhamento profissional que segura sua música do começo ao fim', t.featDesc);
  R('<h3 class="feature-title">Biblioteca de Ritmos Prontos</h3>', `<h3 class="feature-title">${t.f1t}</h3>`);
  R('Ritmos profissionais em diversas categorias: Gaúcho, Brasileiro, Pop/Rock, Gospel, Reggae e mais. Seleciona e toca.', t.f1d);
  R('<h3 class="feature-title">Performance ao Vivo</h3>', `<h3 class="feature-title">${t.f2t}</h3>`);
  R('Grid com 3 variações de ritmo, 3 viradas, intro e finalização. Troca no tempo certo, como um baterista real faria.', t.f2d);
  R('<h3 class="feature-title">Pedal Bluetooth Personalizável</h3>', `<h3 class="feature-title">${t.f3t}</h3>`);
  R('Conecta qualquer pedal Bluetooth ou USB e mapeia do seu jeito. Configura qual pedal faz o que, play, virada, finalização. Mãos livres no palco.', t.f3d);
  R('<h3 class="feature-title">Favoritos e Setlist</h3>', `<h3 class="feature-title">${t.f4t}</h3>`);
  R('Monte sua lista de ritmos pro show na ordem certa. Navega entre eles com um toque ou com o pedal.', t.f4d);
  R('<h3 class="feature-title">Offline + Atualizado Sempre</h3>', `<h3 class="feature-title">${t.f5t}</h3>`);
  R('Funciona sem internet no palco. E quando conectar, recebe ritmos novos toda semana, a biblioteca só cresce.', t.f5d);

  // Depoimentos
  R('Quem já usa <span class="gradient-text">no palco</span>', t.fbTitle);
  R('Mensagens reais de músicos que tocam com o GDrums todo fim de semana', t.fbDesc);
  s = s.split('alt="Depoimento de usuário do GDrums"').join(`alt="${t.fbAlt}"`);
  R('Mais depoimentos no @gdrums_app', t.fbIg);

  // Planos
  s = replaceBetween(s, '<section id="pricing" class="pricing">', '</section>', buildPricing(t), `${code}:pricing`);

  // Rodapé
  R('<p>Seu baterista virtual no palco</p>', `<p>${t.footTag}</p>`);
  R('<h4>Produto</h4>\n            <a href="#features">Recursos</a>\n            <a href="#pricing">Planos</a>',
    `<h4>${t.footProduct}</h4>\n            <a href="#features">${t.navFeatures}</a>\n            <a href="#pricing">${t.navPricing}</a>`);
  R('<h4>Conta</h4>\n            <a href="/?entrar=1">Entrar</a>\n            <a href="/register">Criar Conta</a>',
    `<h4>${t.footAccount}</h4>\n            <a href="/login">${t.footLogin}</a>\n            <a href="/register">${t.footSignup}</a>`);
  R('<h4>Suporte</h4>\n            <a href="https://chat.whatsapp.com/LBZhUH3vnNQBkauNLFCbWu" target="_blank">Comunidade WhatsApp</a>\n            <a href="/terms">Termos de Uso</a>\n            <a href="/privacy">Politica de Privacidade</a>',
    `<h4>${t.footSupport}</h4>\n            <a href="mailto:contato@gdrums.com.br">${t.footEmail}</a>\n            <a href="/terms?lang=${code}">${t.footTerms}</a>\n            <a href="/privacy?lang=${code}">${t.footPrivacy}</a>`);
  R('<p>&copy; 2026 GDrums Studio. Todos os direitos reservados.</p>\n        <p>gdrums.com.br</p>',
    `<p>&copy; 2026 GDrums Studio. ${t.footRights}</p>\n        <p><a href="/landing" hreflang="pt-BR" style="color:inherit;">Português</a> | <a href="${code === 'es' ? '/en' : '/es'}" hreflang="${code === 'es' ? 'en' : 'es'}" style="color:inherit;">${code === 'es' ? 'English' : 'Español'}</a></p>`);
  R('Pra honra e glória de Deus', t.footGlory);

  // Nenhum resquício de preço em real ou do grupo de WhatsApp BR
  for (const bad of ['R$', 'chat.whatsapp.com', 'Modo Show', 'passe-3-dias', 'Tocar Agora', 'Cadastrar grátis']) {
    if (s.includes(bad)) throw new Error(`[${code}] sobrou "${bad}" na página`);
  }
  fs.writeFileSync(path.join(root, L.file), s);
  console.log(`ok ${L.file} (${s.length} bytes) | title ${L.title.length} | desc ${L.description.length}`);
}
