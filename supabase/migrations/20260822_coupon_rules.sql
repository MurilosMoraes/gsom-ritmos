-- Regras por cupom: restricao de plano e uso unico por conta.
-- Compativel com o que existia: planos vazio = vale em TODOS, uma_por_conta
-- = false. Os 36 cupons existentes nao mudaram de comportamento.
alter table public.gdrums_coupons
  add column if not exists planos text[] not null default '{}',
  add column if not exists uma_por_conta boolean not null default false;

comment on column public.gdrums_coupons.planos is
  'Planos em que o cupom vale. Vazio = todos. Ex: {anual,rei-dos-palcos}';
comment on column public.gdrums_coupons.uma_por_conta is
  'true = cada conta so pode usar este cupom uma vez (checado por transacao confirmada).';

-- validate_coupon passa a considerar as regras novas e devolve `planos`
-- (o front aplica o cupom ANTES de escolher o plano, entao precisa saber em
-- quais planos mostrar o desconto).
-- DROP antes: parametro com DEFAULT criaria sobrecarga e a chamada de 1
-- argumento ficaria ambigua.
drop function if exists public.validate_coupon(text);
drop function if exists public.validate_coupon(text, text);

create or replace function public.validate_coupon(
  coupon_code text,
  plan_id     text default null
)
returns table (code text, discount_percent int, valid_until timestamptz, planos text[])
language sql
security definer
set search_path = public
as $$
  select c.code, c.discount_percent, c.valid_until, c.planos
  from public.gdrums_coupons c
  where upper(c.code) = upper(coupon_code)
    and c.active = true
    and c.valid_from <= now()
    and c.valid_until > now()
    and c.current_uses < c.max_uses
    and (
      cardinality(c.planos) = 0
      or plan_id is null
      or plan_id = any(c.planos)
    )
    -- auth.uid() vem do token de quem chamou: o cliente nao mente sobre quem e
    and (
      c.uma_por_conta = false
      or auth.uid() is null
      or not exists (
        select 1 from public.gdrums_transactions t
        where t.user_id = auth.uid()
          and upper(t.coupon_code) = upper(coupon_code)
          and t.status = 'confirmed'
      )
    )
  limit 1;
$$;

grant execute on function public.validate_coupon(text, text) to anon, authenticated;
