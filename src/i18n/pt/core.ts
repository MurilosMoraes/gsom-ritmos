// Preenchido pela extração de strings (fase 1 do i18n) — valores byte-idênticos aos literais originais.
export const core: Record<string, string> = {
  // SetlistManager.ts
  'core.setlist.defaultName': 'Meu repertório',
  'core.share.title': 'Compartilhar',
  'core.share.whatsapp': 'Mandar no WhatsApp',
  'core.share.copy': 'Copiar link',
  'core.share.copied': 'Copiado!',
  'core.share.copyFallback': 'Copie o link acima',
  'core.share.close': 'Fechar',
  'core.share.waText': 'Olha esse {tipo} que separei no GDrums: {titulo}',
  'core.setlist.numbered': 'Repertório {n}',
  'core.setlist.copyName': '{name} (cópia)',

  // UserRhythmService.ts — syncOne() erros visíveis no badge "pendente sync"
  'core.sync.rhythmNotFound': 'ritmo não encontrado',
  'core.sync.noInternet': 'sem internet',
  'core.sync.sessionNotStarted': 'sua sessão expirou — entre na conta de novo',
  'core.sync.networkFailure': 'falha de rede',

  // BiometricService.ts — textos do prompt nativo de biometria
  'core.bio.title': 'Entrar no GDrums',
  'core.bio.subtitleFace': 'Use o Face ID pra entrar',
  'core.bio.subtitleFingerprint': 'Use sua digital pra entrar',
  'core.bio.labelFace': 'Face ID',
  'core.bio.labelFingerprint': 'digital',
};
