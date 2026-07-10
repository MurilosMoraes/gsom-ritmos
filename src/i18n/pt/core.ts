// Preenchido pela extração de strings (fase 1 do i18n) — valores byte-idênticos aos literais originais.
export const core: Record<string, string> = {
  // SetlistManager.ts
  'core.setlist.defaultName': 'Meu repertório',
  'core.setlist.numbered': 'Repertório {n}',
  'core.setlist.copyName': '{name} (cópia)',

  // UserRhythmService.ts — syncOne() erros visíveis no badge "pendente sync"
  'core.sync.rhythmNotFound': 'ritmo não encontrado',
  'core.sync.noInternet': 'sem internet',
  'core.sync.sessionNotStarted': 'sessão não iniciada',
  'core.sync.networkFailure': 'falha de rede',

  // BiometricService.ts — textos do prompt nativo de biometria
  'core.bio.title': 'Entrar no GDrums',
  'core.bio.subtitleFace': 'Use o Face ID pra entrar',
  'core.bio.subtitleFingerprint': 'Use sua digital pra entrar',
  'core.bio.labelFace': 'Face ID',
  'core.bio.labelFingerprint': 'digital',
};
