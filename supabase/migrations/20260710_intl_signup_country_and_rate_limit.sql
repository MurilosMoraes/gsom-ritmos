-- Cadastro internacional: país da conta + rate limit da rota pública.
-- APLICADA EM PRODUÇÃO em 2026-07-10 (via MCP apply_migration).
--
-- SEGURO PRA BASE ATUAL: a coluna entra com DEFAULT 'BR' e NOT NULL, então
-- os 4805 perfis existentes viraram 'BR' (que é a verdade) sem downtime.
-- Nenhum código anterior lê essa coluna; é puramente aditivo.

alter table public.gdrums_profiles
  add column if not exists country text not null default 'BR';

comment on column public.gdrums_profiles.country is
  'ISO-3166 do país declarado no cadastro. BR exige CPF (anti-trial-farming). Fora do BR: sem CPF, protegido por rate limit + confirmação de e-mail.';

-- Tentativas de cadastro INTERNACIONAL (a rota BR não escreve aqui).
-- Base do rate limit por IP. Só a service_role (edge function) enxerga.
create table if not exists public.gdrums_signup_attempts (
  id          bigserial primary key,
  ip          text        not null,
  email       text,
  country     text,
  user_agent  text,
  outcome     text        not null default 'attempt', -- attempt | blocked | created
  created_at  timestamptz not null default now()
);

create index if not exists gdrums_signup_attempts_ip_time_idx
  on public.gdrums_signup_attempts (ip, created_at desc);
create index if not exists gdrums_signup_attempts_email_time_idx
  on public.gdrums_signup_attempts (email, created_at desc);

alter table public.gdrums_signup_attempts enable row level security;
-- Sem policies = ninguém (anon/authenticated) lê ou escreve. Só service_role.

comment on table public.gdrums_signup_attempts is
  'Rate limit do cadastro internacional. Escrito só pela edge function register-account (service_role). RLS sem policies = inacessível pelo cliente.';
