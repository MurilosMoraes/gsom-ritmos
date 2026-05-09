# IAP Apple — Guia de Setup

> **Leitura obrigatória antes de subir build pra TestFlight com IAP.**
> Cada passo bloqueia o próximo. Não pula.

---

## TL;DR — O que está implementado

**Cliente (iOS app):**
- `src/native/IAPService.ts` — wrapper do `@capgo/native-purchases`
- `src/auth/plans.ts` — branch `isIOSNative()` chama IAP em vez de InfinitePay; esconde campo de cupom; adiciona botão "Restaurar compras" (Apple obriga)
- `src/auth/payment-success.ts` — entende `?ios_iap=1` e curto-circuita o polling InfinitePay

**Servidor (Supabase Edge Functions):**
- `supabase/functions/apple-iap-verify/index.ts` — chamada pelo cliente após compra; valida JWS + ativa profile + insere transaction
- `supabase/functions/apple-iap-webhook/index.ts` — chamada pela Apple (V2 notifications) em renovações/refunds/expirações

**Não mudou nada:**
- Web (Vercel) → continua InfinitePay
- Android → continua InfinitePay
- Edge Functions InfinitePay (`create-checkout`, `payment-webhook`) → intactas

---

## Passo 1 — Criar produtos no App Store Connect

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → seu app → **Monetization** → **Subscriptions**

1. Criar **Subscription Group**: `GDrums Pro`
2. Adicionar 5 subscriptions (manter os IDs EXATAMENTE como abaixo — bate com `IAPService.ts`):

| Reference Name | Product ID | Duração | Preço (Brasil) |
|---|---|---|---|
| Mensal | `com.gdrums.app.mensal` | 1 mês | R$ 29,00 |
| Trimestral | `com.gdrums.app.trimestral` | 3 meses | R$ 81,00 |
| Semestral | `com.gdrums.app.semestral` | 6 meses | R$ 144,00 |
| Anual | `com.gdrums.app.anual` | 1 ano | R$ 228,00 |
| Rei dos Palcos | `com.gdrums.app.reidospalcos` | — | R$ 522,00 |

> **Atenção sobre "Rei dos Palcos" (3 anos):** Apple não oferece duração de 36 meses como assinatura. Opções:
> - (a) Vender como **non-consumable IAP** (compra única, vitalícia) — mas aí não tem auto-renovação e dá pra restaurar pra sempre. Recomendo isso.
> - (b) Vender como anual e renovar automaticamente. Aí o user pagaria R$ 522 todo ano. Não é o que tu queria.
>
> **Decisão sugerida:** transformar "Rei dos Palcos" em non-consumable. Eu ajusto o código quando tu confirmar.

3. Pra cada subscription:
   - **Subscription Duration**: igual à tabela
   - **Price**: cadastra em BRL
   - **Localizations** (pt-BR):
     - Display Name: igual ao display do site
     - Description: copiar dos cards no [plans.html](plans.html)
   - **Review Information**:
     - Screenshot: tira print da tela `/plans` no simulator iOS mostrando o plano
     - Review Notes: "Subscription unlocks all 100+ rhythms and live performance features."

4. **Status** dos produtos: vai ficar "Missing Metadata" → preenche → "Ready to Submit". Eles ficam em "Waiting for Review" junto com o build.

---

## Passo 2 — Configurar o webhook V2 da Apple

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → seu app → **App Information** → role até **App Store Server Notifications**.

1. **Production Server URL V2**:
   ```
   https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/apple-iap-webhook
   ```
2. **Sandbox Server URL V2**: mesma URL (a edge fn diferencia pelo campo `environment` do JWS)
3. **Version**: V2 (NÃO V1)

> Se tu não configurar isso, o app **funciona** mas: refunds/cancelamentos não vão se refletir no Supabase. Acesso continua liberado até a `expiresDate` original. **Apple aprova mesmo sem webhook V2** (só recomenda).

---

## Passo 3 — Deploy das Edge Functions

```bash
# Da raiz do projeto:
supabase functions deploy apple-iap-verify --project-ref qsfziivubwdgtmwyztfw
supabase functions deploy apple-iap-webhook --project-ref qsfziivubwdgtmwyztfw
```

Se o comando falhar com "function exists", normal — o `deploy` faz upsert.

**Verificar que subiu:**
```bash
curl -X POST https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/apple-iap-verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy" \
  -H "apikey: sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy" \
  -d '{}'
```
Deve retornar `{"success":false,"error":"userId ausente"}` (200 ou 400). Se vier 404, não subiu.

---

## Passo 4 — Testar com Sandbox

### 4.1. Criar Sandbox Tester

ASC → **Users and Access** → **Sandbox Testers** → **+**

- Nome qualquer (ex: "GDrums Test 1")
- Email qualquer (NÃO precisa ser real, ex: `gdrums-sandbox-1@gdrums.com.br`)
- Senha qualquer
- Region: **Brazil**

### 4.2. Configurar device

iPhone físico → **Settings** → **App Store** → role até "**Sandbox Account**" (lá embaixo) → faz login com o sandbox tester

> **Importante:** simulator iOS **não funciona** com IAP em todos os cenários. Use device físico.

### 4.3. Build e instalar via Xcode

```bash
cd /Users/murilosilvamoraes/Desktop/Projetos/gdrums/gsom-ritmos
npm run build:mobile
npx cap sync ios
npx cap open ios
```

No Xcode:
- Selecionar device físico (não simulator)
- Run (Cmd+R)

### 4.4. Fluxo de teste

1. Cria conta nova no app (ou usa uma existente sem assinatura)
2. Vai em **Planos**
3. Verifica:
   - Campo de cupom **NÃO aparece**
   - Botão **"Restaurar compras"** aparece embaixo dos planos
4. Clica em qualquer plano → sheet da Apple aparece (sandbox)
5. Confirma → "Compra concluída"
6. Volta pro app → assinatura ativa

**Verificar no Supabase:**
```sql
SELECT subscription_status, subscription_plan, subscription_expires_at, updated_at
FROM gdrums_profiles WHERE id = '<seu user id>';

SELECT order_nsu, transaction_nsu, plan, status, payment_method, created_at
FROM gdrums_transactions
WHERE user_id = '<seu user id>'
ORDER BY created_at DESC LIMIT 5;
```

`payment_method` deve ser `apple_iap_sandbox` no teste.

---

## Passo 5 — Submeter pra TestFlight

1. Bumpar versão no [Info.plist](ios/App/App/Info.plist):
   - `CFBundleShortVersionString` 1.0.1 → **1.0.2**
   - `CFBundleVersion` 33 → **34**
2. Build:
   ```bash
   npm run build:mobile && npx cap sync ios && npx cap open ios
   ```
3. Xcode → Product → Archive → Distribute App → App Store Connect → Upload
4. Aguardar processamento (5-15min)
5. ASC → TestFlight → adicionar a build à lista de testers internos

**Importante na submissão pra Review (não TestFlight):**
- Marcar os 5 IAPs pra serem submetidos **junto** com a build
- Review Notes:
  ```
  This update introduces in-app purchases for premium subscription access.

  iOS uses Apple In-App Purchase exclusively for digital subscriptions.
  Android and web (gdrums.com.br) use a different payment provider
  because Apple's payment policies do not apply to those platforms.

  Discount coupons are not available on iOS — they are only offered on
  the web/Android version.

  Test account:
  Email: <criar conta de teste com trial ativo>
  Password: <senha>

  Bluetooth pedal is an optional accessory; the app is fully functional
  via touch controls without it.
  ```

---

## Resolução de problemas

### "Compra retornou sem token"
O plugin `@capgo/native-purchases` retornou objeto sem `jwsRepresentation` nem `receipt`. Isso acontece quando:
- Sandbox tester não tá logado no device
- Bundle ID do app não bate com ASC
- Produtos no ASC ainda em "Missing Metadata"

### "Validação falhou: bundleId inválido"
O `EXPECTED_BUNDLE_ID` em [supabase/functions/apple-iap-verify/index.ts:32](supabase/functions/apple-iap-verify/index.ts#L32) não bate com o do app. Confirmar com:
```bash
grep CFBundleIdentifier ios/App/App/Info.plist
grep PRODUCT_BUNDLE_IDENTIFIER ios/App/App.xcodeproj/project.pbxproj | head -1
```
Hoje deve ser `com.gdrums.app`. Se mudar, atualizar nos 2 arquivos: `apple-iap-verify` e `apple-iap-webhook`.

### "Validação falhou: productId não bate"
Algum dos IDs no ASC não bate com `PRODUCT_TO_PLAN` em [supabase/functions/apple-iap-verify/index.ts:36-42](supabase/functions/apple-iap-verify/index.ts#L36).

### Webhook V2 não chega
- Confirmar URL no ASC bate **exatamente** com a URL deployada
- Verificar logs em Supabase → Edge Functions → `apple-iap-webhook` → Logs
- Apple só envia webhook em produção real e sandbox real (não testou? não envia)
- Tester sandbox: Apple acelera renovações pra 5 min/3 min/etc. ([doc oficial](https://developer.apple.com/documentation/storekit/testing-auto-renewable-subscriptions))

### Refund de produção não corta acesso
- Verificar se `subscription_status` ficou `canceled` e `subscription_expires_at` foi atualizada pro now
- Se não, webhook V2 não tá chegando — ver passo anterior

---

## Riscos conhecidos / TODOs

1. **Verificação JWS hoje é por decode + check de campos**, não por assinatura criptográfica. Cliente pode em teoria forjar JWS — mas pra forjar com bundleId correto + productId correto + appAccountToken correto + transactionId único + expiresDate futura é bem improvável (não impossível). **Mitigação:** segundo passo é integrar a [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi) pra fazer GET `/inApps/v1/transactions/{id}` e bater bit-a-bit com o que veio do cliente. Requer chave privada `.p8` do ASC.

2. **Preço (`amount_cents`) sempre vem 0** nas transactions IAP — a Apple não envia preço no JWS. Pra ver receita real precisaríamos consultar App Store Server API. Por enquanto o relatório no admin vai mostrar R$ 0 pra essas transactions. Não bloqueia compliance, só relatório fica chato.

3. **"Rei dos Palcos" 3 anos não existe como subscription** — ver caixa azul no Passo 1.

4. **CSP do Vercel** ([vercel.json](vercel.json)) só libera `api.infinitepay.io` — IAP não passa por aí (compra é nativa, não browser), então não precisa mexer.

---

## Glossário rápido

- **JWS** = JSON Web Signature. É o formato que a Apple usa pra "assinar" cada compra. Como JWT mas pra dados de compra.
- **StoreKit 2** = framework moderno da Apple pra IAP (iOS 15+). Substitui o `verifyReceipt` antigo.
- **Sandbox** = ambiente de teste da Apple. Não cobra cartão; renovação é acelerada.
- **App Store Server Notifications V2** = webhook que a Apple manda pro nosso servidor quando algo muda (refund, renovação, etc).
- **Original Transaction ID** = identificador da compra "raiz" (primeira). Renovações têm transactionId novo mas mesmo originalTransactionId. Idempotência usa o original.
- **appAccountToken** = UUID que o app passa na compra pra correlacionar com user interno. Usamos `user.id` do Supabase aqui.
