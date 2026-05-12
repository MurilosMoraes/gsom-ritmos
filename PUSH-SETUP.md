# Push Notifications — Setup

Implementação completa em código. **Falta apenas configuração manual** no Supabase Dashboard pra ativar.

## ✅ O que está pronto no código

- SDK Web OneSignal carrega automaticamente após login
- User dá permissão via banner soft (não martelado)
- `onesignal_id` é salvo em `gdrums_profiles` automaticamente
- Aba "Push" no admin pra disparar manualmente (segmentação por status, expiring, etc.)
- Edge fn `send-push` pro envio manual (já deployada)
- Edge fn `cron-push-notifications` pro envio automático (já deployada)
- Tabelas `gdrums_push_log` (histórico) + `gdrums_push_sent` (idempotência)

## ⚠️ O que falta configurar (5 minutos)

### 1. Service Worker do OneSignal

OneSignal usa um Service Worker próprio em `OneSignalSDKWorker.js`. Precisa estar acessível em `https://gdrums.com.br/OneSignalSDKWorker.js`.

**Como fazer:**
- O OneSignal serve isso automaticamente via subdomínio CDN dele (`os.tc/...`)
- Verifica no painel OneSignal → Settings → Platforms → Web → deve mostrar "Default Service Worker" ✓
- Se aparecer erro de service worker no console do browser, me avisa

### 2. Env vars na Edge Function

No Supabase Dashboard → **Edge Functions** → **Secrets**:

Adiciona estas 3 vars:

```
ONESIGNAL_APP_ID=<APP_ID público do OneSignal Dashboard>
ONESIGNAL_API_KEY=<COLAR DO DASHBOARD do OneSignal — começa com os_v2_app_>
CRON_SECRET=<gere uma string random aqui, qualquer coisa, ex: openssl rand -hex 32>
```

> ⚠️ **Nunca commitar o valor real da API Key nesse arquivo nem em outro arquivo do repo.** Cola direto no Supabase Dashboard → Edge Functions → Secrets.

A `CRON_SECRET` protege a edge fn de cron de ser chamada por qualquer um. Eu sugiro `openssl rand -hex 32` no terminal pra gerar.

### 3. Agendar o cron (pg_cron)

Depois que as env vars estiverem configuradas, roda este SQL no Supabase Dashboard → SQL Editor:

```sql
-- Roda a cada hora. Substitua <CRON_SECRET> pela que você setou acima.
SELECT cron.schedule(
  'gdrums_push_cron',
  '0 * * * *',  -- todo minuto 0 de toda hora
  $$
  SELECT net.http_post(
    url := 'https://qsfziivubwdgtmwyztfw.supabase.co/functions/v1/cron-push-notifications?secret=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
```

Pra verificar se tá ativo:
```sql
SELECT * FROM cron.job WHERE jobname = 'gdrums_push_cron';
```

Pra desativar (caso queira parar os pushes automáticos):
```sql
SELECT cron.unschedule('gdrums_push_cron');
```

## Como funciona

### Disparo manual (admin)
1. `/admin` → aba "Push"
2. Preenche título, corpo, URL opcional, escolhe segmento
3. Mostra preview da audiência estimada
4. Clica "Enviar push"
5. Aba "Histórico" mostra todos os pushes enviados (manuais e automáticos)

### Disparos automáticos
A cada hora o cron roda e dispara:
- **trial_24h**: trial expirando entre 22-26h → push "⏰ Seu teste grátis acaba amanhã"
- **expired_today**: trial expirou nas últimas 6h → push "🔥 Trial expirado — oferta especial"

Idempotência: cada user só recebe **um** push por evento (a tabela `gdrums_push_sent` previne duplicatas).

### Segmentos disponíveis no admin
- **Todos os subscribers**: tudo que aceitou push
- **Trial expirando em 24h**: mesma audiência do cron, mas pra disparar agora
- **Expirados últimos 7 dias**: pra campanhas de winback
- **Por status**: trial / active / expired (granular)

## Plataformas

- ✅ **Web (Chrome, Firefox, Edge, Safari macOS)**: funciona já
- ⚠️ **Safari iOS comum**: NÃO funciona (Apple bloqueia web push em browser comum)
- ⚠️ **iOS PWA instalado**: funciona em iOS 16.4+
- ❌ **Android nativo (APK)**: não funciona ainda — precisa instalar plugin Capacitor do OneSignal e configurar FCM. Vem na próxima.
- ❌ **iOS nativo (IPA)**: precisa configurar APNS no OneSignal + plugin Capacitor

## Como testar

1. Abre `gdrums.com.br` no Chrome (PC ou Android)
2. Loga
3. Espera ~10s — banner soft aparece no rodapé
4. Clica "Permitir" → browser pede permissão → aceita
5. Vai no admin → aba "Push" → vê "1 subscriber"
6. Compor mensagem teste → segment = "Todos" → enviar
7. Notificação aparece no canto do PC ou na bandeja do Android

## Estatísticas

Painel admin mostra:
- Total de subscribers ativos
- Porcentagem dos users que aceitou push
- Histórico de pushes enviados (último 50)

## Próximas evoluções (não agora)

- Plugin Capacitor OneSignal pra Android nativo + iOS nativo
- Templates de mensagem pré-prontas (selecionar e personalizar)
- A/B test (2 versões da msg, OneSignal divide audiência)
- Deep link com parâmetros (ex: `/plans?from=push_trial_24h` pra rastrear conversão)
