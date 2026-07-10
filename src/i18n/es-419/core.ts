// Preenchido pela extração de strings (fase 1 do i18n) — valores byte-idênticos aos literais originais.
export const core: Record<string, string> = {
  // SetlistManager.ts
  'core.setlist.defaultName': 'Mi repertorio',
  'core.setlist.numbered': 'Repertorio {n}',
  'core.setlist.copyName': '{name} (copia)',

  // UserRhythmService.ts — syncOne() erros visíveis no badge "pendente sync"
  'core.sync.rhythmNotFound': 'ritmo no encontrado',
  'core.sync.noInternet': 'sin internet',
  'core.sync.sessionNotStarted': 'sesión no iniciada',
  'core.sync.networkFailure': 'falla de red',

  // BiometricService.ts — textos do prompt nativo de biometria
  'core.bio.title': 'Entrar a GDrums',
  'core.bio.subtitleFace': 'Usa Face ID para entrar',
  'core.bio.subtitleFingerprint': 'Usa tu huella para entrar',
  'core.bio.labelFace': 'Face ID',
  'core.bio.labelFingerprint': 'huella',
};
