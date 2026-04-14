-- RPC delete_my_account: user autenticado exclui a própria conta.
-- Obrigatório pelo Google Play (desde 2023) e App Store.
--
-- Estratégia:
-- 1. ARQUIVA todos os dados do user na tabela gdrums_deleted_accounts
--    (backup completo — se user excluiu sem querer e reclamar, dá pra
--    reverter manualmente com o admin).
-- 2. Limpa dados pessoais do profile (cpf_hash, phone, name) — libera
--    esses identificadores pra re-cadastro futuro se o user quiser voltar.
-- 3. Deleta favoritos e user_rhythms (também ficam no backup em JSON).
-- 4. Marca profile como 'deleted' + invalida active_session_id.
-- 5. Frontend faz signOut() logo em seguida.
--
-- Aplicar no SQL Editor do Supabase.
--
-- ═══════════════════════════════════════════════════════════════════════
-- PARA RECUPERAR UMA CONTA EXCLUÍDA (uso admin, manual):
-- ═══════════════════════════════════════════════════════════════════════
-- 1. Achar o backup:
--    SELECT * FROM gdrums_deleted_accounts WHERE email = 'cara@x.com';
-- 2. Restaurar o profile:
--    UPDATE gdrums_profiles SET
--      name = (SELECT name FROM gdrums_deleted_accounts WHERE user_id = 'UUID'),
--      cpf_hash = (SELECT cpf_hash FROM gdrums_deleted_accounts WHERE user_id = 'UUID'),
--      phone = (SELECT phone FROM gdrums_deleted_accounts WHERE user_id = 'UUID'),
--      subscription_status = (SELECT subscription_status FROM gdrums_deleted_accounts WHERE user_id = 'UUID'),
--      subscription_plan = (SELECT subscription_plan FROM gdrums_deleted_accounts WHERE user_id = 'UUID'),
--      subscription_expires_at = (SELECT subscription_expires_at FROM gdrums_deleted_accounts WHERE user_id = 'UUID')
--    WHERE id = 'UUID';
-- 3. Restaurar ritmos pessoais / favoritos a partir do JSON arquivado
--    (colunas rhythms_backup / favorites_backup).
-- ═══════════════════════════════════════════════════════════════════════

-- Tabela de arquivo: todos os dados pessoais + conteúdo antes da exclusão.
-- Mantém histórico pra:
-- 1. Recuperação em caso de exclusão acidental
-- 2. Compliance LGPD (registro de solicitação de deleção + data)
-- 3. Ver se o user tinha plano pago no momento da exclusão (reembolso)
CREATE TABLE IF NOT EXISTS public.gdrums_deleted_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,                                    -- buscado do auth.users
  name text,
  cpf_hash text,
  phone text,
  role text,
  subscription_status text,
  subscription_plan text,
  subscription_expires_at timestamptz,
  profile_created_at timestamptz,                -- quando criou a conta
  last_contacted_at timestamptz,
  contact_method text,
  rhythms_backup jsonb,                          -- JSON array de todos gdrums_user_rhythms
  favorites_backup jsonb,                        -- JSON do gdrums_favorites
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_via text DEFAULT 'self',               -- 'self' ou 'admin' no futuro
  client_info text                               -- user_agent opcional
);

-- Só admin (via service role ou edge fn) pode ler o arquivo.
-- RLS: nada de SELECT pra anon/authenticated.
ALTER TABLE public.gdrums_deleted_accounts ENABLE ROW LEVEL SECURITY;

-- Índice pra buscar por email (caso comum do suporte)
CREATE INDEX IF NOT EXISTS idx_gdrums_deleted_accounts_email
  ON public.gdrums_deleted_accounts (email);
CREATE INDEX IF NOT EXISTS idx_gdrums_deleted_accounts_user_id
  ON public.gdrums_deleted_accounts (user_id);
CREATE INDEX IF NOT EXISTS idx_gdrums_deleted_accounts_deleted_at
  ON public.gdrums_deleted_accounts (deleted_at DESC);

-- RPC de exclusão com arquivo completo
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  caller_email text;
  v_rhythms jsonb;
  v_favorites jsonb;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Buscar email do auth.users (pra facilitar o find no admin depois)
  SELECT email INTO caller_email FROM auth.users WHERE id = caller_id;

  -- Empacotar ritmos pessoais + favoritos em JSON
  SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
    INTO v_rhythms
    FROM public.gdrums_user_rhythms r
   WHERE r.user_id = caller_id;

  SELECT row_to_json(f)::jsonb
    INTO v_favorites
    FROM public.gdrums_favorites f
   WHERE f.user_id = caller_id;

  -- 1. ARQUIVAR: copia profile + conteúdo pra tabela de deletados
  INSERT INTO public.gdrums_deleted_accounts (
    user_id, email, name, cpf_hash, phone, role,
    subscription_status, subscription_plan, subscription_expires_at,
    profile_created_at, last_contacted_at, contact_method,
    rhythms_backup, favorites_backup, deleted_via
  )
  SELECT
    p.id, caller_email, p.name, p.cpf_hash, p.phone, p.role,
    p.subscription_status, p.subscription_plan, p.subscription_expires_at,
    p.created_at, p.last_contacted_at, p.contact_method,
    v_rhythms, v_favorites, 'self'
  FROM public.gdrums_profiles p
  WHERE p.id = caller_id;

  -- 2. Limpar dados pessoais do profile + marcar como deletado
  --    (row continua em gdrums_profiles pra manter histórico de transações,
  --    mas sem informação pessoal — LGPD compliant)
  UPDATE public.gdrums_profiles
     SET cpf_hash = NULL,
         phone = NULL,
         name = 'Usuário Removido',
         subscription_status = 'deleted',
         subscription_plan = 'free',
         subscription_expires_at = NULL,
         active_session_id = NULL,
         last_contacted_at = NULL,
         contact_method = NULL,
         updated_at = now()
   WHERE id = caller_id;

  -- 3. Deletar favoritos/setlist (já estão no backup JSON)
  DELETE FROM public.gdrums_favorites WHERE user_id = caller_id;

  -- 4. Deletar ritmos pessoais (já estão no backup JSON)
  DELETE FROM public.gdrums_user_rhythms WHERE user_id = caller_id;

  -- 5. Log de segurança
  INSERT INTO public.gdrums_security_logs (user_id, email, event, details)
  VALUES (caller_id, caller_email, 'account_deleted',
          'User solicitou exclusão da própria conta');
END;
$$;

-- Permitir que user autenticado chame
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- VIEW ADMIN: queries rápidas da tabela de deletados
-- ═══════════════════════════════════════════════════════════════════════
-- Use no admin.ts via edge function pra listar/buscar:
-- - Últimas 30 dias de exclusões
-- - Por plano ativo (risco de reembolso)
-- - Por email pra busca manual
CREATE OR REPLACE VIEW public.gdrums_deleted_accounts_summary AS
SELECT
  id,
  user_id,
  email,
  name,
  subscription_status,
  subscription_plan,
  subscription_expires_at,
  CASE
    WHEN subscription_status = 'active'
     AND subscription_expires_at > deleted_at
    THEN 'HAD_ACTIVE_PLAN'  -- possível reembolso
    ELSE 'OK'
  END AS refund_flag,
  deleted_at,
  deleted_via,
  jsonb_array_length(rhythms_backup) AS rhythms_count
FROM public.gdrums_deleted_accounts
ORDER BY deleted_at DESC;

