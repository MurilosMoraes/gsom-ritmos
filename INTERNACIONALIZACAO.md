# Internacionalização do GDrums

Estado do projeto de levar o GDrums pro mundo. Última atualização: **10/jul/2026**.

Este documento é o mapa: o que já está pronto, o que falta, e o que **não** pode ser esquecido antes de cada passo. Mantenha atualizado.

---

## 🔴 Bloqueio de segurança (resolver antes de qualquer coisa)

A edge function **`send-email`** (vive só no dashboard do Supabase, não é versionada) tem a **`service_role` key e a senha do SMTP escritas direto no código-fonte**.

A `service_role` é a chave mestra do banco: ignora RLS por completo. Os valores já circularam fora do dashboard.

**Ação:** rotacionar as duas (Settings → API → rotate `service_role`; e a senha da conta de e-mail no Hostinger) e mover pra `Deno.env`. Depois de rotacionar, conferir quais funções liam a chave antiga.

---

## Onde estamos

| Fase | Status |
|---|---|
| 1. i18n (3 idiomas, seletor, offline) | ✅ **em produção** |
| 2. Cadastro internacional (sem CPF) | 🟡 **pronto na branch, não mergeado** |
| 3. Pagamento internacional | ⬜ não começou |
| 4. Páginas de marketing + lojas | ⬜ não começou |
| 5. Soft launch | ⬜ não começou |

---

## Fase 1 — i18n ✅ concluída

- **3 idiomas**: `pt-BR` (byte-idêntico ao original), `es-419` (espanhol latino neutro), `en` (inglês US).
- **~1000 chaves por idioma**, cobrindo app, demo, login, cadastro, planos, modais de conversão, editor de repertório e biometria.
- **Offline por construção**: os dicionários são módulos compilados no bundle. Entram no precache do PWA e no pacote nativo. Zero dependência de rede.
- **Detecção automática**: escolha manual salva vence sempre; senão o idioma do aparelho (`pt*` → pt-BR, `es*` → es-419); qualquer outro idioma do mundo cai em inglês.
- **Seletor com bandeiras SVG** (emoji de bandeira não renderiza no Windows) no menu do app, no login, no cadastro e no demo. A escolha é global: trocar em qualquer lugar vale pra todos.
- **Trava de qualidade**: `test/i18n-audit.ts` exige paridade total entre idiomas (mesmas chaves, mesmos placeholders `{x}`) e valida as chaves usadas nos HTMLs. Uma string PT sem tradução quebra o teste, não a tela do gringo.

### O que ficou de fora de propósito

- **Admin** (`admin.ts`): painel interno, PT-BR pra sempre.
- **Preços e moeda**: hardcoded em R$. É a Fase 3.
- **Páginas de marketing** (landing, download, links, terms, privacy): Fase 4. A recomendação é **copy nativa por mercado, não tradução**.
- **Meta tags de compartilhamento** (`og:title`, `twitter:title`): ainda em PT, aparecem só na prévia do link no WhatsApp/Facebook.

---

## Fase 2 — Cadastro internacional 🟡 pronto, aguardando merge

Branch: **`feature/intl-signup`** (não mergeada).

### O problema que resolve

Hoje um estrangeiro **não consegue criar conta**: o cadastro exige CPF válido (com dígito verificador) e telefone com DDD brasileiro. Sem isso, toda a internacionalização é decorativa.

### A arquitetura

**Princípio inegociável: detecção de país é UX, nunca é segurança.** Qualquer coisa que "adivinha" país (IP, idioma, fuso) é falsificável com um VPN. Por isso o país é um **campo escolhido pela pessoa** (com default sugerido), e a segurança real está em outro lugar.

Isso também resolve o caso do **brasileiro fora do Brasil**: o padrão vem do idioma/região do aparelho, mas ele troca pra 🇧🇷 e o campo de CPF reaparece. Nenhum caso especial no código.

| | **Brasil** (`country = 'BR'`) | **Internacional** (`country != 'BR'`) |
|---|---|---|
| CPF | Exigido (como sempre) | Não existe |
| Anti-abuso | CPF único | Rate limit + confirmação de e-mail + bloqueio de descartável |
| Confirmação de e-mail | **Nenhuma** (nasce confirmado) | Obrigatória antes de logar |
| Criação da conta | `admin.createUser({ email_confirm: true })` | `signUp()` (o Supabase envia o e-mail) |

### A garantia do Brasil

O caminho BR na edge function é o **código do v7, linha por linha**. Três provas, todas verificadas contra a produção:

1. **O toggle "Confirm email" só governa o `signUp()`.** O BR usa o admin API, que grava `email_confirmed_at` explicitamente. Testado com o toggle ligado: cadastro BR → `success`, e `signInWithPassword` logo depois → `access_token`.
2. **Ninguém mais chama `signUp()`.** O único ponto é `authService.register()`, que é **código morto**.
3. **Nenhum usuário existente ficaria trancado**: os 4.808 usuários de auth já têm o e-mail confirmado (query rodada em 10/jul).

**Compatibilidade com os apps já instalados:** os binários em produção **não mandam `country`**. Ausência ou vazio é tratado como `'BR'`. Testado explicitamente.

### O que já está feito

**Servidor:**
- `supabase/functions/register-account/index.ts` — a função **nunca esteve sob controle de versão**. Agora está, com o v8.
- Deployada como **`register-account-next`** (função separada, de teste). A **viva `register-account` continua no v7, intocada**.
- Migration **aplicada em produção** (`supabase/migrations/20260710_intl_signup_country_and_rate_limit.sql`):
  - `gdrums_profiles.country text not null default 'BR'` (os 4.805 perfis viraram BR, que é a verdade).
  - `gdrums_signup_attempts` (base do rate limit), com RLS sem policies: só a `service_role` acessa.

**Defesas do caminho internacional:**
- Rate limit por IP (5/hora, 15/dia) e por e-mail (3/hora). **Não se aplica ao BR** — um grupo de igreja se cadastrando na mesma WiFi não pode ser bloqueado.
- Bloqueio de domínios de e-mail descartável (mailinator, temp-mail e cia).
- Confirmação de e-mail obrigatória.
- Bônus de graça: o próprio Supabase rejeita domínio inexistente no `signUp()`.

**Cliente:**
- Seletor de país no topo do cadastro (nomes traduzidos via `Intl.DisplayNames`), CPF condicional.
- `login.ts` roteia por **tipo** de link de e-mail: `type=recovery` → form de nova senha; `type=signup` → confirma, loga e manda pro app. (Antes, todo `token_hash` caía no form de nova senha: um link de confirmação cairia na tela errada.)
- Tela **"confira seu e-mail"** compartilhada (`src/auth/checkEmailScreen.ts`), usada em dois momentos: logo após o cadastro, e quando um internacional não-confirmado tenta logar. Reenvio com cooldown regressivo e crescente (30s → 60s → 120s), limite de 3.
- `main.ts:checkAccess` — o guard de "conta incompleta" (sem CPF/phone → `/completar-cadastro`) agora só vale pra conta BR. Sem isso o estrangeiro ficaria preso pra sempre pedindo um documento brasileiro.

### Testes feitos contra a produção

Todos com o toggle "Confirm email" **ligado**. Usuários de teste criados e apagados; base voltou a 4.808 usuários / 4.805 perfis / 0 não-confirmados.

| Cenário | Esperado | Resultado |
|---|---|---|
| Função **viva (v7)**, cadastro BR | funciona | ✅ `success` + `access_token` no login |
| `-next`, BR **sem `country`** (app antigo) | sem fricção | ✅ `email_confirmado = true`, sem `confirmation_required` |
| `-next`, internacional (domínio real) | portão ativo | ✅ `confirmation_required: true`, nasce não-confirmado, sem `cpf_hash` |
| Login do internacional não-confirmado | pede confirmação | ✅ `error_code = email_not_confirmed` (aciona a tela) |
| CPF inválido | barrado | ✅ |
| E-mail descartável | barrado | ✅ |
| Domínio inexistente | barrado | ✅ (pelo próprio Supabase) |

### O que falta pra Fase 2 fechar

1. **Rotacionar os segredos do `send-email`** (ver bloqueio no topo).
2. **Merge da `feature/intl-signup`** e deploy da web.
3. **Trocar a `register-account` viva pela v8.** Nunca fazer sem aprovação explícita: é a entrada de lead de ~4.800 usuários. A `-next` está lá pra validar antes.
4. **Ajustar o template "Confirm signup"** (Auth → Email Templates) pra:
   ```
   {{ .SiteURL }}/login.html?token_hash={{ .TokenHash }}&type=signup
   ```
   **Só depois** que a branch estiver em produção, senão o link cai num site que ainda não sabe processar `type=signup`. Mesmo padrão robusto já usado no recovery: o `token_hash` valida em qualquer contexto, então o link abre certo no app (via App Links) e na web.
5. **Apertar os rate limits do Supabase Auth** (Auth → Rate Limits). A anon key é pública por design, então qualquer um pode chamar `/auth/v1/signup` direto, pulando a nossa edge function. O que segura são os limites do próprio Auth + o portão de confirmação.
6. **Decidir sobre `authService.register()`**, código morto que chama `signUp()`. Com o toggle ligado, se alguém o chamar cria usuário não-confirmado e o app quebra em silêncio. Recomendação: apagar.

### Estado do toggle

O **"Confirm email" está LIGADO** em produção desde 10/jul. Como o cadastro internacional ainda não está exposto, isso **não muda nada pra ninguém** hoje. Pode ficar ligado ou ser desligado: a edge function detecta o estado e se comporta certo nos dois (se o e-mail já nasce confirmado, ela não devolve `confirmation_required`, ou seja, não mente pro cliente).

---

## Fase 3 — Pagamento internacional ⬜

- **iOS: já resolvido, de graça.** O IAP que existe funciona global; a Apple converte moeda e cuida de imposto. Falta só liberar territórios no App Store Connect. É o canal internacional mais barato de abrir.
- **Web internacional: Stripe** (multi-moeda + imposto automático), mantendo InfinitePay pro Brasil (PIX é vantagem competitiva, não se joga fora).
- **Android: cuidado.** O esquema atual de "pagar no site" o Google tolera hoje, mas pra distribuição global a Play Store costuma **forçar Play Billing**. É o item mais espinhoso da lista.

Também pendente aqui: preços e moeda ainda são hardcoded em R$ no cliente (`PaymentService.ts` e nos HTMLs).

---

## Fase 4 — Marketing e lojas ⬜

- Landing, download, links, termos e privacidade: **copy nativa por mercado**, não tradução.
- Listagens das lojas (ASO) em espanhol e inglês. É o que puxa o orgânico.
- Meta tags de compartilhamento por idioma.

---

## Fase 5 — Soft launch escalonado ⬜

Ordem recomendada, do mais barato pro mais caro:

1. **Lusofonia** (Portugal, Angola, Moçambique): **zero tradução**. Precisa só da Fase 2 (cadastro sem CPF) + liberar territórios no iOS. É o teste de fogo do funil internacional gastando quase nada.
2. **LatAm em espanhol**: o maior potencial orgânico. O catálogo já fala a língua musical (cumbia, bachata, salsa, reggaeton), e o público de músico solo de igreja é movido a indicação, igual à base brasileira.
3. **EN global**: mercado saturado de apps de música, ASO caro. Vem por último, com o caixa dos dois primeiros.

Europa só com privacidade e termos traduzidos e consentimento GDPR.

---

## Referências rápidas

| Coisa | Onde |
|---|---|
| Infra do i18n | `src/i18n/index.ts` (`t()`, `hydrate()`, detecção) |
| Dicionários | `src/i18n/{pt,es-419,en}/` |
| Seletor de idioma | `src/i18n/selector.ts` |
| Auditoria de i18n | `test/i18n-audit.ts` |
| Edge function do cadastro | `supabase/functions/register-account/index.ts` |
| Migration do `country` | `supabase/migrations/20260710_intl_signup_country_and_rate_limit.sql` |
| Tela de confirme e-mail | `src/auth/checkEmailScreen.ts` |
| Roteamento dos links de e-mail | `src/auth/login.ts` (por `type=`) e `src/auth/recoveryGuard.ts` |
| Deep links (app) | `src/native/DeepLinks.ts`, `public/.well-known/` |
