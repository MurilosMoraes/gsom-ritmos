// Adiciona um botão de olhinho 👁 em todo input[type=password] da página
// pra revelar/esconder a senha. Detecta inputs novos via MutationObserver
// (cobre modais e campos criados dinamicamente).
//
// Como usar: chamar setupPasswordToggle() 1x no boot da página.
// Não toca em campos já com data-no-toggle (caso queira desativar em algum).

const CSS_ID = 'gdrums-pwd-toggle-css';

function injectCss(): void {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
    .gd-pwd-wrap {
      position: relative;
      display: block;
    }
    .gd-pwd-toggle {
      position: absolute;
      top: 50%;
      right: 10px;
      transform: translateY(-50%);
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.4);
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      font-family: inherit;
      z-index: 2;
    }
    .gd-pwd-toggle:hover {
      color: rgba(255, 255, 255, 0.8);
      background: rgba(255, 255, 255, 0.05);
    }
    .gd-pwd-toggle svg {
      width: 18px;
      height: 18px;
      display: block;
    }
    /* Garantir espaço pro botão dentro do input */
    .gd-pwd-wrap > input[type="password"],
    .gd-pwd-wrap > input[type="text"][data-gd-pwd] {
      padding-right: 44px !important;
    }
  `;
  document.head.appendChild(style);
}

const EYE_OPEN = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
`;
const EYE_CLOSED = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
`;

function attachToggle(input: HTMLInputElement): void {
  // Evita duplicar
  if (input.dataset.gdPwdAttached) return;
  if (input.dataset.noToggle === '') return; // opt-out explícito
  input.dataset.gdPwdAttached = '1';

  // Wrappa o input num span pra posicionar o botão
  const parent = input.parentElement;
  if (!parent) return;

  // Se o pai já é um wrap nosso (caso re-render), reusa
  let wrap: HTMLElement;
  if (parent.classList.contains('gd-pwd-wrap')) {
    wrap = parent;
  } else {
    wrap = document.createElement('span');
    wrap.className = 'gd-pwd-wrap';
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);
  }

  // Remove botão duplicado se já existir nesse wrap
  wrap.querySelectorAll('.gd-pwd-toggle').forEach(b => b.remove());

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gd-pwd-toggle';
  btn.setAttribute('aria-label', 'Mostrar senha');
  btn.setAttribute('tabindex', '-1'); // não rouba foco do form
  btn.innerHTML = EYE_OPEN;
  wrap.appendChild(btn);

  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    if (showing) {
      input.type = 'password';
      input.removeAttribute('data-gd-pwd');
      btn.innerHTML = EYE_OPEN;
      btn.setAttribute('aria-label', 'Mostrar senha');
    } else {
      input.type = 'text';
      input.setAttribute('data-gd-pwd', '1'); // mantém padding-right via CSS
      btn.innerHTML = EYE_CLOSED;
      btn.setAttribute('aria-label', 'Esconder senha');
    }
    // Mantém o foco no input (não pula pra fora)
    input.focus();
  });
}

function scanAndAttach(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(attachToggle);
}

let observer: MutationObserver | null = null;

export function setupPasswordToggle(): void {
  injectCss();
  scanAndAttach();

  // Observa o DOM pra campos criados dinamicamente (modais, forms,
  // troca de senha que vira via JS, etc).
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        const el = node as Element;
        if (el.matches?.('input[type="password"]')) {
          attachToggle(el as HTMLInputElement);
        } else {
          scanAndAttach(el);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
