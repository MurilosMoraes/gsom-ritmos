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
import { dict as es419 } from './es-419';
import { dict as en } from './en';

const LOCALE_KEY = 'gdrums-locale';

const dictionaries: Record<string, Record<string, string>> = {
  'pt-BR': pt,
  'es-419': es419, // espanhol latino-americano neutro
  'en': en,
};

/** Resolve o idioma ativo — ordem de prioridade:
 *  1. Escolha MANUAL salva (usuário trocou no app) — vence sempre.
 *  2. Idioma do APARELHO (no Capacitor o WebView reporta o idioma do
 *     sistema; na web, o do navegador): pt* → pt-BR, es* → es-419.
 *  3. Qualquer outro idioma do mundo → inglês (padrão internacional). */
function resolveLocale(): string {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved && dictionaries[saved]) return saved;
  } catch { /* storage indisponível — segue */ }
  try {
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('pt')) return 'pt-BR';
    if (nav.startsWith('es')) return 'es-419';
  } catch { /* noop */ }
  return 'en';
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

/**
 * HIDRATAÇÃO do HTML estático. As páginas são escritas em pt-BR (valor
 * byte-idêntico ao dicionário — pra pt a hidratação é um no-op visual) e
 * marcadas com atributos data-i18n; cada entry chama hydrate() no boot.
 *
 * Atributos suportados:
 *   data-i18n="chave"              → innerHTML (valores podem ter <strong> etc.
 *                                    — vêm do NOSSO dicionário, conteúdo confiável)
 *   data-i18n-placeholder="chave"  → placeholder
 *   data-i18n-title="chave"        → title
 *   data-i18n-aria="chave"         → aria-label
 *   data-i18n-content="chave"      → content (meta description)
 *
 * Também ajusta <html lang> e, se data-i18n-doc-title existir no <html>,
 * o título da aba.
 */
export function hydrate(root: ParentNode = document): void {
  try {
    document.documentElement.lang = currentLocale;
    const docTitleKey = document.documentElement.getAttribute('data-i18n-doc-title');
    if (docTitleKey) document.title = t(docTitleKey);
  } catch { /* fora do browser (testes) — ignora */ }

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n')!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')!));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')!));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')!));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-content]').forEach((el) => {
    el.setAttribute('content', t(el.getAttribute('data-i18n-content')!));
  });
}
