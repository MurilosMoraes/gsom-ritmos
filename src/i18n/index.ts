// i18n do GDrums — dicionários EMPACOTADOS no build (offline por construção:
// entram no precache do PWA e no bundle nativo como qualquer módulo).
//
// FASE 1 (2026-07): só pt-BR, extraído do código com valores BYTE-IDÊNTICOS
// aos literais originais — o app renderiza exatamente igual à produção.
// Idiomas novos = criar src/i18n/<locale>/ espelhando as chaves e registrar
// em `dictionaries` + `resolveLocale`. NUNCA buscar tradução na rede.
//
// Convenções:
// - Chaves prefixadas pelo domínio do arquivo de origem: 'main.*', 'auth.*',
//   'plans.*', 'demo.*', 'ui.*', 'core.*'.
// - Interpolação: '{nome}' no valor + t('chave', { nome: valor }).
// - Fallback: chave ausente no idioma ativo cai pro pt-BR; ausente no
//   pt-BR devolve a própria chave (fica visível e óbvio no teste).
// - Admin (admin.ts) fica FORA do i18n de propósito: painel interno, PT-BR.

import { pt } from './pt';

const LOCALE_KEY = 'gdrums-locale';

const dictionaries: Record<string, Record<string, string>> = {
  'pt-BR': pt,
};

/** Resolve o idioma ativo: escolha manual salva > idioma do aparelho > pt-BR.
 *  Enquanto só existe pt-BR, sempre cai em pt-BR — comportamento idêntico. */
function resolveLocale(): string {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved && dictionaries[saved]) return saved;
  } catch { /* storage indisponível — segue */ }
  try {
    const nav = (navigator.language || '').toLowerCase();
    // Quando houver mais idiomas: 'es*' → 'es-419', 'en*' → 'en', etc.
    if (nav.startsWith('pt')) return 'pt-BR';
  } catch { /* noop */ }
  return 'pt-BR';
}

let currentLocale = resolveLocale();

/** Tradução por chave. Params substituem {placeholders} no valor. */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] || pt;
  let s = dict[key] ?? pt[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export function getLocale(): string {
  return currentLocale;
}

/** Troca o idioma e persiste. Recarregar a página aplica em tudo (strings
 *  são lidas na renderização; reload é o caminho simples e à prova de
 *  estado misto). */
export function setLocale(locale: string): boolean {
  if (!dictionaries[locale]) return false;
  currentLocale = locale;
  try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* noop */ }
  return true;
}

export function availableLocales(): string[] {
  return Object.keys(dictionaries);
}
