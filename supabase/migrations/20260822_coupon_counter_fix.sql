-- Contador de uso do cupom: teto + fim da contagem dupla.
--
-- A RPC incrementava SEM TETO ("current_uses + 1", sem where), entao nada
-- impedia o contador de passar do max_uses.
--
-- Pior: ela era chamada em DOIS lugares por compra — no payment-webhook
-- (servidor) e no payment-success (navegador). O contador ficou em ~2x o uso
-- real em quase todo cupom. Efeito pratico: campanha morria na METADE do
-- previsto, porque o max_uses era atingido com metade das vendas.
--
-- Correcoes: (1) esta RPC ganha teto; (2) o incremento do navegador foi
-- removido; (3) no webhook ele passou pra dentro da 1a confirmacao.
--
-- DROP necessario: a versao antiga retornava void e o Postgres nao permite
-- trocar o tipo de retorno com CREATE OR REPLACE.
drop function if exists public.increment_coupon_uses(text);

create function public.increment_coupon_uses(coupon_code text)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.gdrums_coupons
     set current_uses = current_uses + 1
   where upper(code) = upper(coupon_code)
     and current_uses < max_uses
  returning current_uses;
$$;

grant execute on function public.increment_coupon_uses(text) to anon, authenticated, service_role;
