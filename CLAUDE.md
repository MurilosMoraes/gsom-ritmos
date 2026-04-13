# GDrums — Sequenciador de Ritmos MIDI (Mapa do Projeto)

> Documento de referência para agentes de IA que vão trabalhar neste repositório. Foi gerado a partir de uma varredura completa do código, do schema Supabase e das políticas RLS. **Mantenha atualizado** — se algo mudar, corrija este arquivo.

---

## 1. O que é este projeto

**GDrums** é um **sequenciador de ritmos / baterista virtual** para músicos tocarem ao vivo. Oferece acompanhamento profissional com ritmos programados (vaneira, sertanejo, gospel, rock, forró, etc.), viradas (fills), intros, finalizações (ends) e controle via **pedal Bluetooth** (que simula teclado — setas).

- **Domínio:** https://gdrums.com.br
- **Tipo:** Webapp responsivo (PWA) + app nativo iOS/Android via **Capacitor 8**
- **Modelo de negócio:** SaaS por assinatura (trial 48h → plano mensal/trimestral/semestral/anual/3-anos)
- **Gateway de pagamento:** **InfinitePay** (handle `checkout-gdrums`)
- **Backend:** **Supabase** (Postgres + Auth + Edge Functions + Storage não usado)
- **Deploy web:** **Vercel**
- **Autoria:** Murilo Silva Moraes

### Público e tom
- Público: músicos BR (cantor/violonista que toca sozinho e quer "banda completa" no celular).
- Copy em PT-BR informal, tom gaúcho/brasileiro ("Show!", "Bora fazer música", "Sua banda vai parar em...").
- Teclado do projeto pode "comer" acentos — código tolerante a `ç`/acentos, mas strings mistam com/sem acento (ex.: `Anunciação.json` vs `Xote Nordestino.json`). **Não "normalize" isso sem pedir.**

---

## 2. Stack, dependências e versões

**package.json:**
- `typescript ^5.3.3`, `vite ^7.2.7`
- `@supabase/supabase-js ^2.99.3`
- `@capacitor/core ^8.0.0`, `/cli`, `/ios ^8.2.0`, `/android ^8.0.0`
- `@capacitor/haptics ^8.0.1`, `/push-notifications ^8.0.2`, `/status-bar ^8.0.1`
- `@capacitor-community/keep-awake ^7.1.0`
- `vite-plugin-pwa ^1.2.0`

**Scripts:**
```bash
npm run dev            # vite dev server na porta 3000 (auto-open)
npm run build          # tsc && vite build  →  outputs em dist/
npm run preview        # preview do build
npm run build:mobile   # build + copia dist/ → www/ (usado pelo Capacitor)
npm run copy:www       # rm -rf www && mkdir -p www && cp -r dist/* www/
```

**TypeScript** (`tsconfig.json`): target ES2020, module ES2020, `strict: true`, `rootDir: ./src`, `outDir: ./dist`. **Exclui `app.ts`** (arquivo legado, ver §11).

---

## 3. Estrutura de diretórios

```
/
├── src/                          ← código fonte TS ativo (usado pelo Vite)
│   ├── main.ts                   ← ENTRY do app principal (4659 linhas) — RhythmSequencer
│   ├── demo.ts                   ← entry do modo demo (/demo) — DemoPlayer
│   ├── types/index.ts            ← interfaces compartilhadas (MAX_CHANNELS=12, SequencerState, Setlist, etc.)
│   ├── utils/
│   │   ├── helpers.ts            ← createEmptyPattern/Volumes/Channels, base64<->ArrayBuffer, expandPattern/Volumes, normalizeMidiPath
│   │   └── cpf.ts                ← validateCPF, formatCPF, hashCPF (SHA-256 + salt "gdrums_2026_cpf_salt")
│   ├── core/                     ← motor do sequenciador (agnóstico de UI)
│   │   ├── StateManager.ts       ← fonte única do state; observer pattern (subscribe/notify por evento)
│   │   ├── AudioManager.ts       ← Web Audio API; cache de buffers por path; scheduleStepFromSnapshot (imutável); corte de sample anterior por canal com fade de 5ms (desktop) / 12ms (mobile)
│   │   ├── Scheduler.ts          ← loop de scheduling ancorado no AudioContext.currentTime; lookahead 0.25s (desktop) / 0.5s (mobile); tick 12ms / 25ms; UI sync via rAF
│   │   ├── PatternEngine.ts      ← transições main↔fill↔end↔intro; cálculo matemático de entry-point pro fill terminar no fim do ciclo
│   │   ├── SetlistManager.ts     ← repertório do show; persiste em localStorage ('gdrums-setlist') + gdrums_favorites no Supabase (upsert fire-and-forget)
│   │   └── UserRhythmService.ts  ← ritmos personalizados do usuário; localStorage ('gdrums-user-rhythms') + gdrums_user_rhythms; flag `synced` e retry
│   ├── io/FileManager.ts         ← salvar/carregar projeto (.json); formatos v1.3 (pattern) e v1.5 (project); lê tanto formato novo (variations) quanto legado (patterns unique)
│   ├── ui/
│   │   ├── UIManager.ts          ← update DOM do sequenciador (steps, play/stop, performance grid, variation buttons)
│   │   ├── ModalManager.ts       ← modais glass-morphism custom (não usa lib); toast p/ success/info curtos
│   │   └── SetlistEditorUI.ts    ← overlay fullscreen do editor de setlist com drag-drop (mouse + touch)
│   ├── native/                   ← wrappers do Capacitor; no-op no browser
│   │   ├── HapticsService.ts     ← light/medium/heavy/success/error
│   │   ├── OfflineCache.ts       ← cache do perfil (localStorage) com assinatura anti-tamper + TTL 7 dias; salt `gD#0ffl1n3$2026!sEq`
│   │   ├── StatusBarService.ts   ← style dark, background #030014
│   │   └── PushService.ts        ← permissão + register; salva token em `gdrums-push-token` (ainda não enviado ao backend)
│   └── auth/                     ← tudo relacionado a Supabase
│       ├── supabase.ts           ← createClient com URL + anon key hardcoded
│       ├── AuthService.ts        ← login/register/logout/isAuthenticated/getUser; traduz mensagens de erro do Supabase p/ PT-BR
│       ├── PaymentService.ts     ← constantes PLANS (5 planos), createCheckoutLink (chama edge fn), verifyPayment (chama InfinitePay direto), calculateTrialExpiry (48h)
│       ├── login.ts              ← LoginPage; após login gera `sessionId = crypto.randomUUID()` e salva em active_session_id
│       ├── register.ts           ← RegisterPage; valida CPF (validação completa), máscaras CPF/telefone, checa cpf_hash + phone duplicados, força de senha visual, trial 48h
│       ├── plans.ts              ← PlansPage; aplica cupom, calcula desconto, checa pedido pendente e reprocessa, crédito proporcional de upgrade
│       ├── payment-success.ts    ← polling pós-pagamento (chama payment-webhook edge fn, fallback polling 5x/2s), incrementa current_uses do cupom
│       └── admin.ts              ← AdminDashboard (1308 linhas): dashboard, users, transactions, coupons, leads, affiliates
├── public/                       ← assets estáticos servidos pelo Vite
│   ├── midi/                     ← 43 samples WAV/MP3 (bumbo, caixa, chimbal, ride, toms, zabumbas, triângulos, congas, blocos, pratos)
│   │   └── manifest.json         ← lista simples {files: [...]}
│   ├── rhythm/                   ← 60 ritmos em JSON + manifest
│   │   └── manifest.json         ← {version: 27, rhythms: [...], categories: {Brasileiro, Pop/Rock, Gaúcho, Gospel, Reggae}}
│   └── img/                      ← logo.png, app-img.png, icon-192/512 (PWA)
├── *.html                        ← 12 entry points do Vite (vite.config.ts → rollupOptions.input)
├── src/auth/*.ts                 ← scripts TS por página (importados via <script type=module>)
├── *.css                         ← styles.css (66KB, app), auth-styles.css, admin-styles.css, landing-styles.css
├── dist/                         ← saída do Vite (ignorada no git; deployada no Vercel)
├── www/                          ← cópia de dist/ usada pelo Capacitor (ignorada no git)
├── ios/                          ← projeto Xcode (App.xcodeproj, Info.plist, Swift entry)
├── android/                      ← projeto Gradle (Capacitor)
├── app.ts                        ← ⚠️ ARQUIVO LEGADO MONOLÍTICO (2379 linhas, 88KB) — NÃO é mais usado pelo build, só existe por histórico (excluído em tsconfig.json). Ver §11.
├── app.js                        ← compilado do legado, no .gitignore
├── vite.config.ts                ← config do build + PWA (globPatterns inclui wav/mp3 até 5MB; runtime caching específico p/ /midi/, /rhythm/, /img/, manifests)
├── vercel.json                   ← rewrites bonitos (/login, /admin, /plans, /register), headers de segurança (CSP, HSTS, XFO=DENY, etc.)
├── capacitor.config.ts           ← appId com.gdrums.app, webDir=www, allowNavigation:['*']
├── scripts/                      ← scripts utilitários de build/manifest (não críticos)
├── backup_*.json                 ← ⚠️ DUMPS DE PRODUÇÃO (usuários, perfis, transações, cupons, favoritos). Ignorados no git, mas existem no disco. NÃO commitar.
└── AUTH_README.md, DEPLOY.md, QUICK-DEPLOY.md, REFACTORING.md  ← docs parciais, todas DESATUALIZADAS (pré-Supabase). Não siga instruções delas; use este CLAUDE.md.
```

---

## 4. Banco de dados (Supabase)

**URL:** `https://qsfziivubwdgtmwyztfw.supabase.co`
**Project ref:** `qsfziivubwdgtmwyztfw`

**Chaves** (estão hardcoded no código — a anon é pública por design; a service_role **nunca** deve aparecer no frontend):
- Anon (publishable) no `src/auth/supabase.ts` e `src/auth/PaymentService.ts`
- Service key: **só nas Edge Functions** (via `Deno.env`)

### 4.1. Tabelas (schema completo, 8 tabelas application + PostGIS)

Todas as tabelas application começam com prefixo `gdrums_`. PostGIS vem de serviços habilitados no Supabase mas não é usado.

#### `gdrums_profiles` (827 linhas em prod na data do mapeamento)
Perfil do usuário; PK = `auth.users.id`. Criado via trigger ao dar `signUp`.
| coluna | tipo | default | notas |
|---|---|---|---|
| `id` | uuid PK | — | = auth.users.id |
| `name` | text NOT NULL | — | de `user_metadata.name` |
| `role` | text NOT NULL | `'user'` | `'user'` \| `'admin'` |
| `subscription_status` | text NOT NULL | `'active'` | `'active'` \| `'trial'` \| `'expired'` \| `'canceled'` |
| `subscription_plan` | text NOT NULL | `'free'` | `'trial'`, `'mensal'`, `'trimestral'`, `'semestral'`, `'anual'`, `'rei-dos-palcos'`, `'free'` |
| `subscription_expires_at` | timestamptz | — | null = sem expiração |
| `max_devices` | int NOT NULL | `2` | atualmente não enforçado (`active_session_id` cuida) |
| `created_at` / `updated_at` | timestamptz NOT NULL | `now()` | |
| `cpf_hash` | text | — | SHA-256(`gdrums_2026_cpf_salt` + CPF limpo). Usado pra impedir 2ª conta com mesmo CPF. Contas criadas antes de 2026-04-03 podem ter null (passam pelo filtro de trial farming). |
| `active_session_id` | text | — | UUID gerado no login/register; se localStorage `gdrums-session-id` != este valor, desloga (sessão única). |
| `phone` | text | — | só dígitos (ex: "51999998888"). Usado como identificador único também. |
| `last_contacted_at` / `contact_method` | timestamptz / text | — | marcado pelo admin ao clicar WhatsApp/Email no painel Leads. |

#### `gdrums_transactions` (193 linhas em prod)
| coluna | tipo | default |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid | FK a `auth.users` (implícita) |
| `order_nsu` | text NOT NULL | formato `<userId>_<planId>_<timestamp>[_<CUPOM>]` (ver `generateOrderNsu`) |
| `transaction_nsu` | text | preenchido pelo InfinitePay no redirect |
| `plan` | text NOT NULL | id do plano |
| `amount_cents` | int NOT NULL | valor final (após cupom/crédito) |
| `original_amount_cents` | int | preço de tabela antes de desconto |
| `status` | text NOT NULL | `'pending'` (default), `'confirmed'`, `'expired'` |
| `payment_method` | text | de `capture_method` do redirect |
| `receipt_url` | text | link do comprovante InfinitePay |
| `coupon_code` | text | se usou cupom |
| `discount_percent` | int | `0` default |
| `affiliate_id` | uuid | FK → `gdrums_affiliates.id` |
| `affiliate_commission` | int | `0` default; centavos; calculado pela edge fn no webhook |
| `created_at` | timestamptz | `now()` |

#### `gdrums_coupons` (2 linhas em prod — ex: TRATORADA 10% 9999 usos)
| coluna | tipo |
|---|---|
| `id` uuid PK | — |
| `code` text NOT NULL | maiúsculo (normalizado no front) |
| `discount_percent` int NOT NULL | |
| `max_uses` int NOT NULL | `1` default |
| `current_uses` int NOT NULL | `0` default |
| `valid_from` / `valid_until` | timestamptz NOT NULL | |
| `active` bool NOT NULL | `true` |
| `created_at` | timestamptz | |

RPC: `public.increment_coupon_uses` existe (mas o código no `payment-success.ts` faz update manual via `current_uses + 1` — race condition possível, baixa prioridade).

#### `gdrums_affiliates` (1 linha em prod)
Programa de afiliados. Gerenciados só via Edge Function `affiliate-api`.
| coluna | default |
|---|---|
| `id` uuid PK | |
| `name`, `email`, `password_hash` NOT NULL | bcrypt ou similar (feito na edge fn) |
| `phone`, `pix_key` | opcional |
| `coupon_code` NOT NULL | código único de afiliado (ex: MURILO20) |
| `commission_percent` int | `20` default |
| `coupon_discount_percent` int | `10` default |
| `total_sales`, `total_revenue`, `total_commission`, `paid_commission` int | `0` (em centavos) |
| `active` bool | `true` |

#### `gdrums_favorites` (184 linhas)
Repertório/setlist persistido por usuário.
- `user_id` uuid (unique — um registro por user)
- `items` jsonb NOT NULL (array de `{name, path, userRhythmId?}`)
- `current_index` int NOT NULL `0` default

#### `gdrums_user_rhythms` (865 linhas)
Ritmos personalizados que o usuário salvou.
- `user_id` uuid NOT NULL
- `name` text NOT NULL
- `bpm` int NOT NULL `80` default
- `rhythm_data` jsonb NOT NULL — o `SavedProject` inteiro

#### `gdrums_demo_access` (11.889 linhas!)
Tracking do `/demo` (página sem login).
- `fingerprint` text — `btoa(lang_screen.w_screen.h_colorDepth_tzOffset).slice(0, 24)` (fraco, só pra estatística)
- `user_agent` text
- Permite INSERT **anônimo** (ver RLS).

#### `gdrums_security_logs` (297 linhas)
Logs de eventos de segurança (ex: `blocked_no_cpf`, trial farming). Escrita via edge fn `security-log`.
- `user_id`, `email`, `name`, `event` (required), `details`, `ip`, `user_agent`

### 4.2. RLS Policies (testadas com anon key)

**Verificado empiricamente** fazendo `SELECT *` com a anon key em 13/Apr/2026:

| Tabela | Leitura anon | Escrita anon | Comentário |
|---|---|---|---|
| `gdrums_profiles` | `[]` bloqueado | bloqueado | SELECT só do próprio user autenticado |
| `gdrums_transactions` | `[]` bloqueado | INSERT permitido (user autenticado) | via código em plans.ts/main.ts |
| `gdrums_affiliates` | `[]` bloqueado | bloqueado (só edge fn) | ok |
| `gdrums_security_logs` | `[]` bloqueado | bloqueado (só edge fn) | ok |
| `gdrums_favorites` | `[]` bloqueado | só próprio user | upsert por user_id |
| `gdrums_user_rhythms` | `[]` bloqueado | só próprio user | |
| `gdrums_demo_access` | `[]` bloqueado | **INSERT aberto** | intencional: tracking anônimo |
| **`gdrums_coupons`** | era público; **a aplicar migration `supabase/migrations/20260413_lock_coupons.sql` no Supabase** | bloqueado | Frontend agora valida cupom via RPC `validate_coupon(coupon_code)` que retorna só `{code, discount_percent, valid_until}` se cupom for válido. Após aplicar o SQL: `REVOKE SELECT` do anon na tabela. **Deploy do frontend só depois do SQL aplicado** — senão `plans.html` quebra. |

### 4.3. RPCs customizadas
- `increment_coupon_uses` (não invocada pelo código atualmente — código faz update manual)
- `notify_expired_trials` (provavelmente usada por cron externo; não invocada no frontend)
- (resto dos `/rpc/*` são PostGIS, ignorar)

### 4.4. Edge Functions (existência confirmada via `curl -X POST`)

**Todas em `https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/<name>`**. O código-fonte delas **NÃO está neste repo** — moram no projeto Supabase. Se precisar editar, use `supabase functions deploy`.

| Função | Chamada por | Validação | Propósito |
|---|---|---|---|
| `create-checkout` | `PaymentService.createCheckoutLink` | valida `items, order_nsu, redirect_url` | chama InfinitePay API e retorna URL do checkout; aceita Bearer `<anon>` |
| `payment-webhook` | `plans.ts`, `payment-success.ts`, `main.ts` (retry pós-redirect) | valida `order_nsu` | verifica pagamento na InfinitePay (usa service key internamente), atualiza `gdrums_transactions.status='confirmed'` + `gdrums_profiles.subscription_*`, credita afiliado se aplicável |
| `admin-api` | `admin.ts` (todas as telas) | Bearer user token, confere `role='admin'` no DB | `action` switch: `fetch`, `update`, `insert`, `ban_user`, `fetch_emails` (lista emails do `auth.users`) |
| `affiliate-api` | `admin.ts` + `affiliate.html` | `action`: `create`, `list`, `login`, `pay` | CRUD de afiliados + login do painel de afiliado |
| `security-log` | `main.ts` (trial farming detect) | `event` required | insere em `gdrums_security_logs` |
| `send` | `admin.ts` (botão "Email" em Leads) | Bearer admin | envia email transacional de recovery (provavelmente via Resend) |

---

## 5. Autenticação e autorização

**Mecanismo:** Supabase Auth (email + senha).

### Fluxo de cadastro (`src/auth/register.ts`)
1. Valida formulário (nome ≥3 chars, CPF com DV, telefone 10-11 dígitos, email regex, senha ≥6 chars, confirma senha, aceita termos).
2. `hashCPF` → SHA-256.
3. **Checa duplicatas** em `gdrums_profiles` por `cpf_hash` e `phone` — impede trial farming.
4. `supabase.auth.signUp({ email, password, options: { data: { name } } })`.
5. Aguarda 500ms (trigger no DB cria o `gdrums_profiles`) e tenta update do `cpf_hash` + `phone` (com retry 5× / 800ms). Se todos falharem, faz upsert direto com status `trial`, `subscription_expires_at = now + 48h`.
6. Gera `sessionId = crypto.randomUUID()` e salva em `active_session_id` + localStorage.
7. Redireciona `/` → `main.ts` checkAccess permite entrada.

### Fluxo de login (`src/auth/login.ts`)
1. `supabase.auth.signInWithPassword`.
2. Gera novo `sessionId`, **sobrescreve** `active_session_id` no banco (invalida outros devices).
3. `getDestination()`: se assinatura ativa/trial → `/`, senão `/plans.html`.

### Fluxo de bloqueio de sessão única (`main.ts:checkAccess`)
- Compara `localStorage['gdrums-session-id']` com `profile.active_session_id`. Se diferente → `signOut + localStorage.clear + redirect /login.html`.
- Sem localStorage session id (primeiro acesso ou limpou cache) → gera novo e grava.

### Fluxo anti-trial-farming (`main.ts:checkAccess`)
- Se `!cpf_hash` e `created_at >= 2026-04-03` e `role !== 'admin'` → chama `security-log` (`event: 'blocked_no_cpf'`), signOut, redirect `/register.html`.

### Offline (`src/native/OfflineCache.ts`)
- Após login online, `main.ts` grava `profile` em localStorage com **assinatura HMAC caseira** (usando salt `gD#0ffl1n3$2026!sEq` e hash incremental duas passadas).
- `hasValidOfflineAccess()`: status ativo/trial + `expires_at > now` + cache age < 7 dias.
- Se `navigator.onLine === false`, usa cache (com modo reduzido: admin não funciona offline).
- Cache invalidado em logout + se assinatura for manipulada (signature fails).
- ⚠️ A assinatura é **anti-casual-tamper**, não crypto — quem descompila o bundle acha o salt. Está OK para o propósito.

### Admin
- `profile.role === 'admin'` é a **única** fonte de verdade. Checada:
  - `main.ts:checkAccess` (guarda em `this.userRole`)
  - `admin.ts:init` (fetcha profile via edge fn, se não admin → redirect `/`)
- Toggle "Modo Admin" no topbar do app é salvo em `localStorage['gdrums-mode']` com um token gerado de `ADMIN_SECRET + userAgent + screen.width` — **defesa em profundidade apenas** (não é segurança real; a segurança real está na edge fn).

### Proteção das rotas
- **Todas as páginas autenticadas** (`/`, `/admin.html`, `/plans.html`, `/payment-success.html`) chamam `isAuthenticated()` ou `checkAccess()` no init.
- `plans.html` permite acesso em trial expirado (é onde o user renova).
- `/demo.html` é **público** (sem login, limite 2 ritmos, timer 3min idle, fingerprint anônimo).

---

## 6. Pagamento (InfinitePay)

**Handle:** `checkout-gdrums`
**API:** `https://api.infinitepay.io/invoices/public/checkout`

### Planos (`src/auth/PaymentService.ts → PLANS`)
| id | nome | preço R$ | meses |
|---|---|---|---|
| `mensal` | Plano Mensal | 29 | 1 |
| `trimestral` | Plano Trimestral | 81 | 3 |
| `semestral` | Plano Semestral | 144 | 6 (popular) |
| `anual` | Plano Anual | 228 | 12 |
| `rei-dos-palcos` | Rei dos Palcos | 522 | 36 |

### Fluxo de checkout
1. User seleciona plano em `plans.html`.
2. Insere transação `pending` em `gdrums_transactions` (ou reutiliza existing do mesmo user+plan).
3. `createCheckoutLink` → edge fn `create-checkout` → InfinitePay API → URL.
4. Redirect pra InfinitePay. User paga.
5. InfinitePay redireciona pra `/payment-success.html?order_nsu=...&transaction_nsu=...&slug=...&capture_method=...`.
6. `payment-success.ts`:
   a. Salva `transaction_nsu` + `payment_method` no banco.
   b. Chama edge fn `payment-webhook` (que confirma via API da InfinitePay e atualiza profile).
   c. Se falhar, faz polling 5× a cada 2s no `gdrums_profiles.subscription_status`.
   d. Em sucesso, incrementa `current_uses` do cupom (fire-and-forget).
7. Fallback: se user fechou a página, `main.ts:checkAccess` encontra a transação `pending` e chama `payment-webhook` uma vez por sessão (`sessionStorage['gdrums-pending-checked']`).

### Cupons
- Validação: `active=true`, `valid_from <= now < valid_until`, `current_uses < max_uses`.
- Código digitado é `.toUpperCase()`.
- Desconto aplicado no `amount_cents` antes do checkout.
- Sufixo `_<CODE>` no `order_nsu` pra tracking.

### Afiliados
- Cupom do afiliado vem do `gdrums_affiliates.coupon_code`.
- Ao criar transação com esse cupom, a edge fn `payment-webhook` deve preencher `affiliate_id` + `affiliate_commission` (valor em centavos).
- Admin registra pagamento de comissão via `affiliate-api {action: 'pay'}`.

---

## 7. Motor do sequenciador (música)

### Conceitos
- **Patterns** (tipos): `main`, `fill`, `end`, `intro`, `transition`. O principal tocando é `activePattern`.
- **Variations:** `main` e `fill` têm 3 slots (3 ritmos diferentes num mesmo arquivo); `end` e `intro` têm 1 só. Total por pattern type em `state.variations[type]`.
- **Steps:** cada variação tem de 4 a 32 steps (padrão 16 p/ main/fill, 8 p/ end, 16 p/ intro).
- **Canais:** `MAX_CHANNELS = 12` canais de áudio por variação.
- **Speed:** cada variação tem `speed` (0.25× a 4×, default 1).
- **Tempo:** BPM global (40-240).
- **Volume:** `masterVolume` (0-2) + `volumes[channel][step]` (0-1).

### Timing (Scheduler)
- **AudioContext clock** é a fonte da verdade. `setTimeout` só agenda o próximo tick, nunca "toca" nada.
- `nextStepTime` em segundos; `scheduleAheadTime` 0.25s (desktop) / 0.5s (mobile).
- Mobile detection via `/Android|iPhone|iPad|iPod/i.test(userAgent)`.
- Se tela voltou do background e o clock atrasou > 0.5s, **pula** pro tempo atual (evita rajada de notas).
- UI sync via `requestAnimationFrame` que drena fila `pendingUISteps` quando `currentTime >= stepTime - 10ms`.
- `visibilitychange` → `audioManager.resume() + scheduler.restart()`.

### Transições inteligentes
- `activateFillWithTiming`: calcula em qual step do ciclo atual entrar pra que o fill **termine exatamente** no fim do ciclo do main. Se já passou do ponto ideal, entra agora e toca só o que couber.
- `playFillToNextRhythm`: agenda fill + muda main variation ao final.
- `playEndAndStop`: cancela fill pendente, agenda end, toca prato no fim (via `onEndCymbal` callback, carrega `/midi/prato.mp3`).

### Fade anti-estralo
- Desktop: 5ms. Mobile: 12ms. Aplicado na entrada (fade-in) e saída (fade-out) de cada sample; também corta sample anterior do mesmo canal com ramp-to-zero antes de iniciar o novo.

### Pedal Bluetooth (`main.ts:setupKeyboardShortcuts`)
- Pedais BT musicais se registram como teclado (enviam `ArrowLeft/Right/Up/Down` ou Space).
- **Tap curto:** single-click pedal esquerdo (500ms de dead zone):
  - Parado: toca intro (se `useIntro`) → play com variação 0
  - Tocando: agenda próxima virada (rotating fill)
- **Duplo tap:** pedal esquerdo 2× <500ms:
  - Tocando: mudar ritmo pra anterior (`playFillToPreviousRhythm`)
- Pedal direito simétrico: parado = prato; tocando = virada; 2× = end/stop.
- **iOS hack:** cria input invisível de 24px colado no bottom, force-focado continuamente (senão iOS não entrega keydown do BT). Há várias salvaguardas pra não roubar foco de inputs de modal (`hasModalOpen()`).
- Mapeamento custom salvo em `localStorage['gdrums_pedal_keys']` = `{left, right}` (ex: `'PageUp'`).

### Haptics (Capacitor — iOS/Android only)
- Step toggle: `light`
- Performance cell click: `medium`
- Virada, final, prato: `heavy`
- Sucesso: `success`

---

## 8. Formato de dados dos ritmos

### `public/rhythm/manifest.json` (v27, 60 ritmos)
```json
{
  "version": 27,
  "rhythms": ["Arrocha.json", ...],
  "categories": {
    "Brasileiro": [...],
    "Pop/Rock": [...],
    "Gaúcho": [...],
    "Gospel": [...],
    "Reggae": [...]
  }
}
```

### Ritmo individual (`public/rhythm/<Nome>.json`) — formato v1.5
```json
{
  "version": "1.5",
  "tempo": 150,
  "beatsPerBar": 4,
  "patternSteps": {"main": 16, "fill": 16, "end": 16, "intro": 8},
  "variations": {
    "main": [  // 3 entradas
      {
        "pattern": [[bool,bool,...], ...],   // [12 canais][N steps]
        "volumes": [[0.8, 1.0, ...], ...],   // paralelo ao pattern
        "audioFiles": [
          {"fileName": "bumbo.wav", "midiPath": "/midi/bumbo.wav", "audioData": ""}
          // audioData é base64 (ritmos novos usam só midiPath; audioData só em projetos exportados avulsos)
        ],
        "steps": 16,
        "speed": 1
      }, ...
    ],
    "fill": [...], "end": [...], "intro": [...]
  },
  "fillStartSound": {"fileName": "prato.mp3", "midiPath": "/midi/prato.mp3"},
  "fillReturnSound": {...},
  "timestamp": "2026-04-09T...",
  "category": "Brasileiro"  // opcional
}
```

Formato **v1.3 legado** (patterns únicos sem variations) ainda é carregável pelo `FileManager.loadProject`.

### `midi/manifest.json`
Apenas lista plana: `{"files": ["bumbo.wav", "caixa.wav", ...]}` — 43 samples.

---

## 9. PWA, Capacitor e cache

### PWA (Vite plugin)
- `registerType: 'autoUpdate'` + `skipWaiting + clientsClaim` — SW novo ativa imediatamente.
- `globPatterns`: `**/*.{js,css,html,ico,svg,woff2,json,wav,mp3,png}` até 5MB cada.
- **Runtime caching:**
  - `/midi/*.{wav,mp3}`: CacheFirst, 30 dias, 100 entries
  - `/rhythm/*.json`: StaleWhileRevalidate, 7 dias, 200 entries
  - `/rhythm/manifest.json`: NetworkFirst, 1 dia
  - `/midi/manifest.json`: NetworkFirst, 1 dia
  - `/img/*.{png,jpg,svg}`: CacheFirst, 30 dias, 30 entries

### Capacitor
- `appId: com.gdrums.app`, `appName: GDrums`, `webDir: www`.
- iOS: `scheme: GDrums`, `contentInset: automatic`, `preferredContentMode: mobile`.
- Android: buildOptions vazio (signing via CI).
- Plugins: SplashScreen (launchShowDuration 0), StatusBar (dark, #030014), PushNotifications (badge+sound+alert).
- `allowNavigation: ['*']` (precisa pro InfinitePay redirect funcionar).

### Vercel (`vercel.json`)
- `framework: vite`, `outputDirectory: dist`, `cleanUrls: true`.
- **Rewrites bonitos**: `/login` → `/login.html`, `/admin`, `/plans`, `/register`, `/landing`.
- **Headers de segurança:**
  - HSTS 1 ano, XFO DENY, X-Content-Type-Options nosniff, X-XSS-Protection, Referrer-Policy strict-origin, Permissions-Policy (camera=(), microphone=(), etc.)
  - **CSP**: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.abacatepay.com; frame-ancestors 'none'`. (Note: menciona `abacatepay` que NÃO é usada no código atual — provavelmente gateway antigo; InfinitePay chama direto. Considerar remover.)
- Cache control: `/midi/*` 30d, `/rhythm/*` 1h+swr 1d, `/img/*` 30d.

### 3 pastas que precisam ficar em sync
- `public/` → fonte primária (ed. manual aqui)
- `dist/` → build do Vite (só ler; recriada pelo `npm run build`)
- `www/` → cópia do `dist/` pro Capacitor (recriada pelo `npm run copy:www`)
- `ios/App/App/public/` → cópia dentro do Xcode project (gerenciada pelo `npx cap copy ios`)

**Ao adicionar ritmo novo:** arrastar JSON pra `public/rhythm/`, atualizar `manifest.json` bumpando `version` e adicionando na lista + categoria, rodar `npm run build:mobile`, `npx cap copy`.

---

## 10. Admin Dashboard (`/admin`)

Acesso: só para `role='admin'`. Verifica via Edge Function `admin-api`.

### Seções
1. **Dashboard** — KPIs (users, pagos, faturamento, trials, expirados, conversão, demo únicos/total), alertas de expiração (hoje, 3 dias), distribuição por plano e região (DDD → estado), últimas transações, completude de dados (CPF/tel/email %).
2. **Usuários** — lista paginada (20/pág), busca nome/id, filtro por status, editar plano/status/expiração, bloquear/desbloquear (chama `admin-api ban_user`).
3. **Transações** — paginada, filtro status/busca nome, totais confirmado/pendente, botão "Expirar pendentes >48h" em lote.
4. **Cupons** — CRUD completo, ativar/desativar, código único validado no backend.
5. **Leads** — usuários não-pagos (trial/expirado), filtros (expirando hoje, 3 dias, últimos 7d expirados), botões "WhatsApp" (abre `wa.me/55<phone>` com msg template) e "Email" (chama edge fn `send`). Ambos marcam `last_contacted_at` + `contact_method`.
6. **Afiliados** — CRUD via `affiliate-api`, ver comissões pendentes/pagas, pagar comissão (atualiza `paid_commission`).

### Mapeamento DDD → Estado (`admin.ts:265`)
Usa `DDD_STATE` dict (11=SP, 51=RS, 21=RJ, etc.) pra mostrar distribuição geográfica a partir do campo `phone`.

---

## 11. Código legado (`app.ts` / `app.js`)

- `app.ts` (2379 linhas) é a **versão monolítica original** do sequenciador. Tem tudo junto: state, UI, audio, scheduling, I/O.
- **Não é compilado pelo build atual** (`tsconfig.json` o exclui; `vite.config.ts` não o referencia).
- Foi refatorado em `src/` (ver `REFACTORING.md` pra histórico, mas está desatualizado).
- **Não apagar ainda** — pode ter lógica sutil (especialmente em timing/sync) não migrada 100%. Se for alterar comportamento, comparar.
- **Nunca mais editar** `app.ts` — qualquer mudança vai em `src/`.

---

## 12. Segurança — estado atual, buracos e política

### ✅ Bem feito
- Service key **nunca** aparece no frontend; tudo sensível passa por Edge Function.
- RLS efetivo em profiles/transactions/affiliates/security_logs/favorites/user_rhythms.
- CSP restritivo; HSTS; XFO DENY.
- CPF armazenado como hash (SHA-256 + salt).
- Sessão única via `active_session_id` (invalida device antigo ao logar em novo).
- Anti-trial-farming: CPF único + phone único + bloqueio de contas pós-2026-04-03 sem CPF.
- Validação de CPF com dígitos verificadores (real, não só length).
- OfflineCache tem assinatura anti-tamper + TTL.
- Rate limiting natural: edge fn é o único jeito de atingir rotas administrativas.

### ⚠️ Pontos de atenção
1. ~~**`gdrums_coupons` legível por anon**~~ — **mitigado (13/Apr/2026)**: migration em `supabase/migrations/20260413_lock_coupons.sql` cria RPC `validate_coupon(code)` e revoga SELECT direto. `plans.ts` já chama a RPC. **Aplicar SQL no Supabase antes do próximo deploy** (dashboard → SQL Editor → colar conteúdo da migration).
2. **Anon key hardcoded no código-fonte e no bundle** — correto (chave pública), mas se alguém rotacionar, tem que fazer deploy.
3. ~~**Incremento de `current_uses` não atômico**~~ — **corrigido (13/Apr/2026)**: `payment-success.ts:incrementCouponUse` agora chama `supabase.rpc('increment_coupon_uses', { coupon_code })` (RPC atômica já existente no DB, assinatura testada).
4. **`OfflineCache` salt está no bundle** — ok pra casual tamper; não depender disso pra autorização real (só é UX).
5. **`active_session_id` não é enforçado a cada request** — só na carga inicial do `/`. Se sessão for roubada, o token JWT vale até expirar (Supabase default 1h). Aceitável.
6. **`backup_*.json` no disco contém dados reais de prod** (827 perfis, 297 logs, etc.) — estão no `.gitignore` (seguro no git) mas existem no seu sistema de arquivos. Deletar após uso ou guardar cifrado.
7. **CSP permite `'unsafe-inline'` e `'unsafe-eval'`** em script-src — exigência do Vite dev + alguns helpers. Em produção idealmente seria mais restritivo (nonce). Baixa prioridade.
8. **`allowNavigation: ['*']` no Capacitor** — necessário pro redirect InfinitePay, mas abre a webview pra qualquer URL. Considerar whitelist específico.
9. ~~**CSP menciona `abacatepay`**~~ — **removido (13/Apr/2026)**: CSP em `vercel.json` agora libera só `api.infinitepay.io` (gateway real).
10. **Edge Functions source não está no repo** — risco de drift/perda. Espelhar no repo ou em outro monorepo.
11. **Fingerprint do demo é fraco** — `btoa(lang_screen_etc).slice(0, 24)`. Qualquer um pode limpar localStorage e gerar outro. Aceitável pro propósito (estatística, não bloqueio duro).

### Regra de ouro
> **Nunca** colocar secret/service key no código do frontend. Se precisar privilégio admin, **sempre** via Edge Function com validação do `role` no DB.

---

## 13. Convenções, armadilhas e padrões

### Convenções
- Comentários em **PT-BR** (reflexo da base de código).
- Nomes de tabelas: sempre com prefixo `gdrums_`.
- Nomes de chaves localStorage: sempre começam com `gdrums-` ou `gdrums_` (inconsistência histórica: `gdrums-setlist`, `gdrums_pedal_keys`).
- Moeda: sempre em **centavos** (`int`) no DB. Formatar pra display com `/ 100`.
- Datas: sempre ISO 8601 UTC (`new Date().toISOString()`).
- IDs: `crypto.randomUUID()` ou do Postgres (`gen_random_uuid()`).
- Strings de UI: PT-BR, tom informal, sem emoji exceto nos What's New (`🎵 📶 🎼 🎛️ 🤝 🚀`).

### Armadilhas (coisas que quebram de forma sutil)
- **Não colocar `await` antes de `audioContext.resume()` no handler de gesto do iOS** — quebra a cadeia de gesto e o áudio fica mudo. Sempre síncrono dentro do click.
- **No iOS, inputs invisíveis (`opacity: 0` ou `height < 2px`) não recebem keydown do pedal BT** — por isso o input do pedal tem 24px de altura e opacidade real.
- **`setTimeout` morre no background do Safari** — daí o `visibilitychange` faz `scheduler.restart()`.
- **3 pastas com HTMLs duplicados** (`/`, `dist/`, `www/`, `ios/App/App/public/`) — não edite em `dist/`, `www/` ou `ios/...` diretamente; edite na raiz e rode o build.
- **InfinitePay handle precisa ser `checkout-gdrums`** em todas as chamadas, verificadas nos commits recentes.
- **Trigger do DB cria `gdrums_profiles`** após `auth.users`; o `register.ts` espera 500ms + retry 5× porque às vezes demora.
- **Ao criar conta via API (bypass UI), não há `cpf_hash`** — por isso a verificação de `blocked_no_cpf` em `checkAccess`.
- **`active_session_id` é sobrescrito no login** — se user logar em 2 devices, o primeiro é deslogado na próxima carga do `/`.
- **`WhatsApp` template** em `admin.ts` usa número com prefixo `55` (Brasil only).

### Padrões
- **Snapshot imutável no scheduler** — `AudioManager.scheduleStepFromSnapshot` recebe um snapshot congelado; mutations durante scheduling não afetam nota já agendada.
- **Fire-and-forget Supabase** — `SetlistManager.notify()` dispara save remoto sem await (UI não espera rede).
- **Retry + fallback offline** — `UserRhythmService.save` tenta Supabase mas sempre salva local primeiro; `synced: false` até confirmar.
- **Observer pattern no StateManager** — `subscribe(event, callback)` / `notify(event)`. Eventos: `playState`, `tempo`, `patterns`, `volumes`, `variations`, `currentStep`, `activePattern`, `patternSteps`, `pendingFill`, `pendingEnd`, etc.
- **Edge Function como gateway admin** — `admin.ts` nunca fala direto com DB; sempre via `admin-api {action}`.

---

## 14. Pedal Bluetooth — guia de teclas mapeadas

(de `main.ts:1049-1204`)

| Tecla (keyCode) | Ação padrão |
|---|---|
| `ArrowLeft` (37) | Pedal esquerdo (default) |
| `ArrowDown` (40) | Pedal esquerdo |
| `ArrowRight` (39) | Pedal direito (default) |
| `ArrowUp` (38) | Pedal direito |
| `Space` (32) | Toggle play/stop |
| `PageUp` (33) / `PageDown` (34) | Custom (via mapper) |

Double-tap = 2 cliques em <500ms (dead zone).

---

## 15. Comandos rápidos

```bash
# Dev
npm run dev                                    # http://localhost:3000

# Build web
npm run build                                  # gera dist/

# Build mobile (web + sync pra Capacitor)
npm run build:mobile
npx cap copy ios
npx cap copy android
npx cap open ios                               # abre Xcode
npx cap open android                           # abre Android Studio

# Deploy
git push                                       # Vercel auto-deploy da branch main/homolog

# Supabase (ajustar schema)
# — não usa CLI local no repo; alterações de schema são feitas no dashboard ou via psql direto.
# Se for mexer em edge fns:
supabase functions deploy <name> --project-ref qsfziivubwdgtmwyztfw
```

---

## 16. O que NÃO fazer

- **Não** editar `app.ts` / `app.js` (legado).
- **Não** editar `dist/`, `www/`, `ios/App/App/public/` diretamente.
- **Não** commitar `backup_*.json`.
- **Não** colocar service key, secret ou token no frontend.
- **Não** chamar `supabase.from(...)` com privilégios admin do frontend — sempre via edge fn.
- **Não** assumir online — sempre ter fallback localStorage.
- **Não** remover o `500ms` de espera em `register.ts` (trigger precisa de tempo).
- **Não** mudar o handle `checkout-gdrums` da InfinitePay.
- **Não** normalizar nomes de arquivos de ritmos (acentos, espaços) — vai quebrar o manifest.
- **Não** apagar `backup_*.json` sem avisar o usuário (pode ter dado não-replicado).

---

## 17. Contatos e recursos externos

- **WhatsApp suporte/comunidade:** https://chat.whatsapp.com/CnTLQogcUNFEVeFkyKzkyK
- **Supabase dashboard:** https://supabase.com/dashboard/project/qsfziivubwdgtmwyztfw
- **Vercel:** deploy via push (repositório conectado)
- **InfinitePay:** https://api.infinitepay.io — docs oficiais; handle `checkout-gdrums`
- **Site:** https://gdrums.com.br
- **Landing alternativa:** https://gdrums.com.br/landing (pro SEO / captação)
- **Demo:** https://gdrums.com.br/demo (sem login, 2 ritmos)
- **Painel de afiliados:** https://gdrums.com.br/affiliate
