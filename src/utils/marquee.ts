// Letreiro (marquee) compartilhado — usado nos modais do main.ts (picker de
// repertório e "Meus Ritmos"). Mesma ideia do editor de repertório:
//   - envolve o conteúdo do elemento num .gd-mq-inner (preserva badges/spans)
//   - mede o transbordo (scrollWidth - clientWidth)
//   - se não couber, rola do início até o fim e, ao terminar, PULA de volta
//     pro início (o reset é o loop da animação reiniciando — não volta rolando)
//   - só UM elemento deve ficar ligado por vez (o chamador cuida disso) pra
//     não travar listas grandes com dezenas de animações simultâneas.

let stylesInjected = false;

/** Injeta o CSS do letreiro uma única vez no <head>. */
export function ensureMarqueeStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'gd-marquee-styles';
  style.textContent = `
    /* inline-block SEMPRE — senão scrollWidth (medição do transbordo) sai
       errado quando o span é inline puro, e o letreiro nunca liga. */
    .gd-mq-host > .gd-mq-inner { display: inline-block; white-space: nowrap; }
    /* text-align:left garante que o letreiro comece pelo INÍCIO do nome mesmo
       em containers centralizados (ex.: nome central da fav-bar). */
    .gd-mq-host.gd-mq-on { overflow: hidden; text-align: left; }
    .gd-mq-host.gd-mq-on > .gd-mq-inner {
      will-change: transform;
      animation: gd-marquee var(--gd-mq-dur, 6s) linear infinite;
    }
    @keyframes gd-marquee {
      0%, 12% { transform: translateX(0); }
      88%, 100% { transform: translateX(var(--gd-mq-shift, 0px)); }
    }
  `;
  document.head.appendChild(style);
}

/** Liga o letreiro no elemento se o conteúdo transbordar. */
export function startMarquee(nameEl: HTMLElement): void {
  ensureMarqueeStyles();
  nameEl.classList.add('gd-mq-host');
  let inner = nameEl.querySelector<HTMLElement>(':scope > .gd-mq-inner');
  if (!inner) {
    inner = document.createElement('span');
    inner.className = 'gd-mq-inner';
    while (nameEl.firstChild) inner.appendChild(nameEl.firstChild);
    nameEl.appendChild(inner);
  }
  const overflow = Math.ceil(inner.scrollWidth - nameEl.clientWidth);
  if (overflow > 4) {
    const dur = Math.max(3.5, overflow / 42 + 2); // rolagem ~42px/s + pausas nas pontas
    nameEl.style.setProperty('--gd-mq-shift', `${-overflow}px`);
    nameEl.style.setProperty('--gd-mq-dur', `${dur.toFixed(1)}s`);
    nameEl.classList.add('gd-mq-on');
  } else {
    // Coube: desfaz o wrap pra manter ellipsis normal
    stopMarquee(nameEl);
  }
}

/** Desliga o letreiro e desfaz o wrap (restaura ellipsis). */
export function stopMarquee(nameEl: HTMLElement): void {
  nameEl.classList.remove('gd-mq-on');
  nameEl.style.removeProperty('--gd-mq-shift');
  nameEl.style.removeProperty('--gd-mq-dur');
  const inner = nameEl.querySelector<HTMLElement>(':scope > .gd-mq-inner');
  if (inner) {
    while (inner.firstChild) nameEl.insertBefore(inner.firstChild, inner);
    inner.remove();
  }
  nameEl.classList.remove('gd-mq-host');
}
