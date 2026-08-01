-- ─────────────────────────────────────────────────────────────────────
-- COMUNIDADE — contas com senha (cadastro, login e recuperação pelo admin)
--
-- ADENDO: rode DEPOIS de _community.sql, _community_identity.sql e
-- _community_manage.sql.
--
-- COMO A SENHA É GUARDADA (leia antes de mexer):
-- NUNCA em texto puro. Guardamos sha256(senha + sal_do_usuario + pepper),
-- com um SAL ALEATÓRIO POR USUÁRIO. Consequências práticas:
--   * Ninguém — nem o admin, nem quem tiver o banco — consegue LER a senha.
--   * Duas pessoas com a mesma senha geram hashes diferentes (o sal muda),
--     então um vazamento não permite quebrar todas de uma vez.
--   * "Esqueci a senha" se resolve REDEFININDO (community_admin_set_password),
--     não consultando. O usuário volta pra conta na mesma hora.
-- Isso protege o usuário (que reusa senha em banco/e-mail) e protege você
-- de responder por dado sensível guardado sem proteção (LGPD).
--
-- Sessão: o login devolve um token. Ele é a prova de identidade nas ações
-- (excluir post), e vale em qualquer aparelho — diferente do manage_token,
-- que só existia no navegador onde o post foi criado.
--
-- Aplicar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.gdrums_community_users (
  email         text primary key,
  name          text not null,
  pass_salt     uuid not null default gen_random_uuid(),
  pass_hash     text not null,
  session_token uuid,
  downloads     int not null default 0,  -- quantos itens ESTA pessoa baixou
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Bancos que já rodaram uma versão anterior deste arquivo:
alter table public.gdrums_community_users
  add column if not exists downloads int not null default 0;

create index if not exists gdrums_community_users_session_idx
  on public.gdrums_community_users(session_token);

alter table public.gdrums_community_users enable row level security;
-- Acesso só via RPC (security definer). Ninguém lê a tabela direto.
revoke all on public.gdrums_community_users from anon, authenticated;

-- Hash com sal por usuário. Nunca exposto por nenhuma RPC.
create or replace function public.community_pass_hash(p_password text, p_salt uuid)
returns text
language sql immutable security definer set search_path = public
as $$
  select encode(sha256(convert_to(
    coalesce(p_password, '') || '|' || p_salt::text || '|gdrums_community_pepper_2026', 'utf8')), 'hex');
$$;
revoke execute on function public.community_pass_hash(text, uuid) from anon, authenticated;

-- ─── Cadastro ──────────────────────────────────────────────────────────
-- Retorna {"ok":true,"token":"...","name":"..."} ou {"ok":false,"error":"..."}
create or replace function public.community_signup(
  p_email text, p_name text, p_password text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_salt  uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
begin
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_email');
  end if;
  if v_name is null or length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if length(coalesce(p_password, '')) < 4 then
    return jsonb_build_object('ok', false, 'error', 'weak_password');
  end if;
  if exists(select 1 from public.gdrums_community_users where email = v_email) then
    return jsonb_build_object('ok', false, 'error', 'email_taken');
  end if;

  insert into public.gdrums_community_users (email, name, pass_salt, pass_hash, session_token)
  values (v_email, left(v_name, 40), v_salt,
          public.community_pass_hash(p_password, v_salt), v_token);

  return jsonb_build_object('ok', true, 'token', v_token, 'name', left(v_name, 40));
end;
$$;
grant execute on function public.community_signup(text, text, text) to anon, authenticated;

-- ─── Login ─────────────────────────────────────────────────────────────
create or replace function public.community_login(
  p_email text, p_password text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_row   public.gdrums_community_users%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_row from public.gdrums_community_users where email = v_email;
  -- Mesma resposta pra e-mail inexistente e senha errada (não entrega quais
  -- e-mails existem na base).
  if not found or v_row.pass_hash <> public.community_pass_hash(p_password, v_row.pass_salt) then
    return jsonb_build_object('ok', false, 'error', 'bad_credentials');
  end if;

  update public.gdrums_community_users
    set session_token = v_token, updated_at = now()
    where email = v_email;

  return jsonb_build_object('ok', true, 'token', v_token, 'name', v_row.name);
end;
$$;
grant execute on function public.community_login(text, text) to anon, authenticated;

-- ─── Quem é o dono de uma sessão (uso interno) ─────────────────────────
create or replace function public.community_session_email(p_token uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select email from public.gdrums_community_users where session_token = p_token;
$$;
revoke execute on function public.community_session_email(uuid) from anon, authenticated;

-- ─── Excluir post estando LOGADO (funciona em qualquer aparelho) ───────
create or replace function public.community_delete_session(p_code text, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := public.community_session_email(p_token);
  v_ok boolean;
begin
  if v_email is null then return false; end if;
  update public.gdrums_community
    set active = false
    where code = p_code and active and poster_email = v_email;
  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end;
$$;
grant execute on function public.community_delete_session(text, uuid) to anon, authenticated;

-- ─── Contar download de quem está logado ───────────────────────────────
-- Chamado quando a pessoa clica em "Baixar". Silencioso: sem sessão, não
-- conta e não reclama (dá pra baixar sem estar logado).
create or replace function public.community_track_download(p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  update public.gdrums_community_users
    set downloads = downloads + 1
    where session_token = p_token;
  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end;
$$;
grant execute on function public.community_track_download(uuid) to anon, authenticated;

-- ─── ADMIN: painel de cadastros (SEM senha — ela não é legível) ────────
-- Por pessoa: nome, e-mail, data, quantos itens COMPARTILHOU e quantos
-- BAIXOU, e quantas curtidas os posts dela receberam.
create or replace function public.community_admin_users(p_secret text)
returns table(
  email text, name text, created_at timestamptz,
  posts bigint, downloads int, likes_received bigint
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.community_admin_check(p_secret) then
    raise exception 'bad_secret';
  end if;
  return query
    select u.email, u.name, u.created_at,
           (select count(*) from public.gdrums_community c
             where c.poster_email = u.email and c.active),
           u.downloads,
           (select coalesce(sum(c.likes), 0) from public.gdrums_community c
             where c.poster_email = u.email and c.active)
    from public.gdrums_community_users u
    order by u.created_at desc
    limit 500;
end;
$$;
grant execute on function public.community_admin_users(text) to anon, authenticated;

-- ─── ADMIN: redefinir a senha de alguém que esqueceu ───────────────────
-- É assim que se "recupera" um acesso: gera uma senha nova e passa pra
-- pessoa (que deve trocar depois). Ler a senha antiga é impossível — e é
-- justamente essa impossibilidade que protege o usuário.
create or replace function public.community_admin_set_password(
  p_secret text, p_email text, p_new_password text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_salt  uuid := gen_random_uuid();
  v_ok    boolean;
begin
  if not public.community_admin_check(p_secret) then
    raise exception 'bad_secret';
  end if;
  if length(coalesce(p_new_password, '')) < 4 then
    raise exception 'weak_password';
  end if;

  update public.gdrums_community_users
    set pass_salt = v_salt,
        pass_hash = public.community_pass_hash(p_new_password, v_salt),
        session_token = null,   -- derruba as sessões abertas
        updated_at = now()
    where email = v_email;
  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end;
$$;
grant execute on function public.community_admin_set_password(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.community_admin_set_password(text, text, text);
--   drop function if exists public.community_admin_users(text);
--   drop function if exists public.community_track_download(uuid);
--   drop function if exists public.community_delete_session(text, uuid);
--   drop function if exists public.community_session_email(uuid);
--   drop function if exists public.community_login(text, text);
--   drop function if exists public.community_signup(text, text, text);
--   drop function if exists public.community_pass_hash(text, uuid);
--   drop table if exists public.gdrums_community_users;
-- ─────────────────────────────────────────────────────────────────────
