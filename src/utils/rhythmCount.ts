/**
 * Fonte única pra contagem de ritmos do catálogo.
 * Atualize RHYTHM_COUNT aqui sempre que adicionar/remover ritmos — depois rode
 * updateRhythmCountInDom() ou deixe o runtime ler direto do manifest.
 *
 * Uso:
 * - em TS/JS: import { RHYTHM_COUNT } from './utils/rhythmCount';
 * - em HTML estático: classe `.js-rhythm-count` é preenchida na carga da página.
 */
export const RHYTHM_COUNT = 94;

/** Quantidade liberada no demo sem cadastro. */
export const DEMO_RHYTHM_COUNT = 3;

/** Quantidade bloqueada atrás do cadastro (= total - demo). */
export const LOCKED_RHYTHM_COUNT = RHYTHM_COUNT - DEMO_RHYTHM_COUNT;

/**
 * Atualiza todos os elementos `.js-rhythm-count` com o número atual.
 * HTMLs estáticos podem ter `<strong class="js-rhythm-count">90</strong>`
 * como fallback SSR — o JS sobrescreve se RHYTHM_COUNT mudou.
 */
export function updateRhythmCountInDom(): void {
  document.querySelectorAll<HTMLElement>('.js-rhythm-count').forEach(el => {
    el.textContent = String(RHYTHM_COUNT);
  });
  document.querySelectorAll<HTMLElement>('.js-locked-rhythm-count').forEach(el => {
    el.textContent = String(LOCKED_RHYTHM_COUNT);
  });
}
