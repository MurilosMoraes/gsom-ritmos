-- Fecha a exposição pública de gdrums_coupons.
--
-- Hoje qualquer anon pode listar todos os cupons via REST. Esta migration
-- revoga o SELECT direto e cria uma RPC `validate_coupon(code)` que devolve
-- só o mínimo necessário pro frontend validar um cupom específico.
--
-- Aplicar no SQL Editor do Supabase (dashboard) ou via `supabase db push`.

-- 1. RPC de validação: dado um código, retorna só os campos que o frontend precisa.
--    Retorna linha vazia se cupom inexistente, inativo, fora da janela ou esgotado.
CREATE OR REPLACE FUNCTION public.validate_coupon(coupon_code text)
RETURNS TABLE (
  code              text,
  discount_percent  integer,
  valid_until       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.code, c.discount_percent, c.valid_until
  FROM public.gdrums_coupons c
  WHERE upper(c.code) = upper(coupon_code)
    AND c.active = true
    AND c.valid_from <= now()
    AND c.valid_until > now()
    AND c.current_uses < c.max_uses
  LIMIT 1;
$$;

-- Permitir anon/authenticated chamar a RPC
GRANT EXECUTE ON FUNCTION public.validate_coupon(text) TO anon, authenticated;

-- 2. Revogar SELECT direto na tabela para anon.
--    Mantém permissão para authenticated (o admin usa via Edge Function
--    com token do user admin; se preferir, revogar também e acessar via
--    service_role na edge fn, que é o caminho ideal).
REVOKE SELECT ON public.gdrums_coupons FROM anon;

-- Se houver policy permissiva, removê-la (ajustar nome da policy se necessário):
-- DROP POLICY IF EXISTS "Anyone can read coupons" ON public.gdrums_coupons;
-- DROP POLICY IF EXISTS "Public read" ON public.gdrums_coupons;

-- Garantir RLS ligado
ALTER TABLE public.gdrums_coupons ENABLE ROW LEVEL SECURITY;

-- 3. Sanity check: a RPC increment_coupon_uses já existe e é atômica.
--    Se não existir no seu projeto, descomentar:
-- CREATE OR REPLACE FUNCTION public.increment_coupon_uses(coupon_code text)
-- RETURNS void
-- LANGUAGE sql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
--   UPDATE public.gdrums_coupons
--      SET current_uses = current_uses + 1
--    WHERE upper(code) = upper(coupon_code);
-- $$;
-- GRANT EXECUTE ON FUNCTION public.increment_coupon_uses(text) TO anon, authenticated;
