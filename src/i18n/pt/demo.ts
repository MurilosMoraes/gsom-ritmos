// Preenchido pela extração de strings (fase 1 do i18n) — valores byte-idênticos aos literais originais.
export const demo: Record<string, string> = {
  // Tour guiado
  'demo.tour.step1.title': 'Comece tocando',
  'demo.tour.step1.body': 'Aperte o Ritmo 1 pra ouvir a banda entrar.',
  'demo.tour.step2.title': 'Agora solte uma virada',
  'demo.tour.step2.body': 'Toque a Virada 2 — ela entra no tempo certo, como baterista de verdade.',
  'demo.tour.step3.title': 'Troque de ritmo',
  'demo.tour.step3.body': 'Aperte o Ritmo 3. O app faz a virada automática na transição.',
  'demo.tour.step4.title': 'Finalize a música',
  'demo.tour.step4.body': 'O Final encerra a música no tempo certo — com direito a prato de saída. Aperte pra ver.',
  'demo.tour.skip': 'Pular tour',

  // Contador da prévia (header)
  'demo.counter.oneMinLeft': '1 min restante da prévia',
  'demo.counter.createAccountToContinue': 'crie conta pra continuar',
  'demo.counter.ended': 'Prévia encerrada',
  'demo.counter.endedPlanCount': '{total} ritmos no plano',
  'demo.counter.lastRhythm': 'Último ritmo da prévia',
  'demo.counter.catalogCount': '{total} no catálogo',
  'demo.counter.previewCount': 'Prévia com {max} ritmos',

  // Modal de conversão (progressivo, após tour/3 trocas)
  'demo.convert.overline': 'Gostou?',
  'demo.convert.title': 'Isso é só uma prévia.',
  'demo.convert.body': 'Você acabou de tocar com acompanhamento profissional. Cria conta pra liberar os outros {count} ritmos, conectar pedal Bluetooth e montar seu repertório.',
  'demo.convert.offerSub': '✓ Não pedimos cartão · ✓ Sem cobrança automática',
  'demo.convert.secondary': 'Continuar testando',
  'demo.convert.reassure': 'É de graça mesmo, só criar a conta e tocar.',

  // Compartilhados entre modal de conversão e tela de prévia encerrada
  'demo.offer.badge': '100% Grátis',
  'demo.offer.head': '48 horas de acesso total',
  'demo.cta.createAccount': 'Criar conta grátis',

  // Modal "Todos os ritmos"
  'demo.allRhythms.buttonTitle': 'Ver todos os {count} ritmos',
  'demo.allRhythms.title': 'Todos os ritmos',
  'demo.allRhythms.subtitle': '{count} ritmos · liberados no cadastro',
  'demo.allRhythms.closeAriaLabel': 'Fechar',
  'demo.allRhythms.cta': 'Libere tudo grátis por 48h',
  'demo.allRhythms.lockedTitle': 'Disponível após cadastro',
  'demo.allRhythms.loadError': 'Não foi possível carregar o catálogo.',

  // Modal de fim do tour guiado
  'demo.tourEnd.ariaLabel': 'Demonstração rápida',
  'demo.tourEnd.title': 'Isso é só uma demonstração rápida!',
  'demo.tourEnd.feature.rhythmCount': 'Dentro do app temos <strong>{count} ritmos</strong>.',
  'demo.tourEnd.feature.pedal': 'Suporte para usar pedal sem fio.',
  'demo.tourEnd.feature.setlist': 'Pode criar repertórios na ordem e velocidade que quiser!',
  'demo.tourEnd.feature.toggle': 'Ativar e desativar ritmos e viradas.',
  'demo.tourEnd.feature.eq': 'Equalizador e Reverb.',
  'demo.tourEnd.footerText': 'E muito mais!! Se cadastre e teste gratuitamente.',
  'demo.tourEnd.primaryCta': 'Se cadastrar',
  'demo.tourEnd.secondary': 'Continuar teste',

  // Nome do ritmo atual
  'demo.rhythm.loadError': 'Erro ao carregar',

  // Botão de pausa
  'demo.pause.resumeLabel': 'CONTINUAR',
  'demo.pause.pauseLabel': 'PAUSAR',

  // Tela de prévia encerrada
  'demo.expired.overline': 'Você tocou bem',
  'demo.expired.title': 'Agora é pegar a banda completa.',
  'demo.expired.bodyPre': 'Você tocou {count} ritmos. A biblioteca tem',
  'demo.expired.bodyPost': '— Vaneira, Sertanejo, Gospel, Pagode, Forró, Reggae, Rock e muito mais, cada um com viradas, intros e finais prontos pra palco.',
  'demo.expired.featureRhythmsCount': 'ritmos completos',
  'demo.expired.featureBluetoothBadge': 'BT',
  'demo.expired.featureBluetoothLabel': 'pedal Bluetooth',
  'demo.expired.featureOfflineBadge': '∞',
  'demo.expired.featureOfflineLabel': 'offline no palco',
  'demo.expired.offerSub': '✓ Não pedimos cartão · ✓ Sem cobrança automática · cancela quando quiser',
  'demo.expired.offerPrice': 'Só depois das 48h, se gostar: R$ 29/mês',
  'demo.expired.emailPlaceholder': 'Seu e-mail',
  'demo.expired.hasAccount': 'Já tem conta?',
  'demo.expired.loginLink': 'Entrar',
};
