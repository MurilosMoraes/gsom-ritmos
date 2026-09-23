// Preenchido pela extração de strings (fase 1 do i18n) — valores byte-idênticos aos literais originais.
export const core: Record<string, string> = {
  // SetlistManager.ts
  'core.setlist.defaultName': 'Mi repertorio',
  'core.share.title': 'Compartir',
  'core.share.whatsapp': 'Enviar por WhatsApp',
  'core.share.copy': 'Copiar enlace',
  'core.share.copied': '¡Copiado!',
  'core.share.copyFallback': 'Copia el enlace de arriba',
  'core.share.close': 'Cerrar',
  'core.share.waText': 'Mira este {tipo} que armé en GDrums: {titulo}',
  'core.setlist.numbered': 'Repertorio {n}',
  'core.setlist.copyName': '{name} (copia)',

  // UserRhythmService.ts — syncOne() erros visíveis no badge "pendente sync"
  'core.sync.rhythmNotFound': 'ritmo no encontrado',
  'core.sync.noInternet': 'sin internet',
  'core.sync.sessionNotStarted': 'tu sesión expiró — inicia sesión de nuevo',
  'core.sync.networkFailure': 'falla de red',

  // BiometricService.ts — textos do prompt nativo de biometria
  'core.bio.title': 'Entrar a GDrums',
  'core.bio.subtitleFace': 'Usa Face ID para entrar',
  'core.bio.subtitleFingerprint': 'Usa tu huella para entrar',
  'core.bio.labelFace': 'Face ID',
  'core.bio.labelFingerprint': 'huella',

  // /download e /links (paginas de marketing)
  'core.download.docTitle': 'Descargar GDrums',
  'core.download.title': 'Te llevamos al lugar correcto…',
  'core.download.sub': 'Detectando tu dispositivo',
  'core.download.manual': 'Continuar manualmente',
  'core.download.readyTitle': '¡Todo listo!',
  'core.download.continue': 'Continuar',
  'core.download.notFound': 'Enlace no encontrado',
  'core.download.notFoundSub': 'Este enlace no existe o fue desactivado.',
  'core.download.goSite': 'Ir al sitio',
  'core.links.bio': 'Tu banda completa en el celular. <br/>+180 ritmos, pedal Bluetooth, para músicos que tocan en vivo.',
  'core.links.loading': 'Cargando…',
  'core.links.empty': 'No pudimos cargar los enlaces ahora.',
  'core.links.footer': 'Para honra y gloria de Dios',
};
