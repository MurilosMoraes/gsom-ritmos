-- ─────────────────────────────────────────────────────────────────────
-- COMUNIDADE — detalhes, "meus posts" e EXCLUSÃO (dono + admin)
--
-- ADENDO: rode DEPOIS de 20260730_community.sql e _community_identity.sql.
--
-- SEGURANÇA (importante):
-- O site não tem autenticação real (nome/e-mail são digitados, sem senha),
-- e a chave anon é pública. Então NENHUMA exclusão pode confiar no e-mail:
-- qualquer um chamaria a RPC por fora se dependesse disso.
--   * DONO   -> ao publicar, o servidor gera um `manage_token` secreto e
--               devolve pra quem publicou. Só quem tem o token apaga.
--   * ADMIN  -> senha secreta, guardada aqui só como HASH (sha256+salt).
--               A tabela do hash não é legível por anon; a conferência
--               acontece dentro da função (security definer).
--
-- Exclusão é SUAVE (active = false): some de tudo no site (vitrine, busca,
-- números, meus posts e download), mas o registro continua no banco pra
-- eventual recuperação.
--
-- Aplicar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- A senha de admin NÃO fica neste arquivo (só o placeholder) — no banco vai
-- apenas o hash. Ver o bloco do insert mais abaixo.
-- ─────────────────────────────────────────────────────────────────────

-- ─── Token de gerenciamento por post (dono) ────────────────────────────
alter table public.gdrums_community
  add column if not exists manage_token uuid not null default gen_random_uuid();

-- ─── Senha de admin (só o hash) ────────────────────────────────────────
create table if not exists public.gdrums_community_admin (
  id          int primary key default 1,
  secret_hash text not null,
  updated_at  timestamptz not null default now(),
  constraint gdrums_community_admin_single check (id = 1)
);

alter table public.gdrums_community_admin enable row level security;
revoke all on public.gdrums_community_admin from anon, authenticated;

-- Hash = sha256(senha + salt). sha256() é nativo do Postgres (11+).
create or replace function public.community_hash_secret(p_secret text)
returns text
language sql immutable security definer set search_path = public
as $$
  select encode(sha256(convert_to(coalesce(p_secret, '') || '::gdrums_community::2026', 'utf8')), 'hex');
$$;
revoke execute on function public.community_hash_secret(text) from anon, authenticated;

-- ⚠️ TROQUE 'DEFINA_AQUI_A_SENHA' pela senha desejada ANTES de rodar.
-- No banco fica só o hash; a senha em texto puro nunca é gravada nem versionada.
-- (Já aplicada em produção — este bloco só é necessário num banco novo ou
--  pra trocar a senha; veja também o comando de troca no fim do arquivo.)
insert into public.gdrums_community_admin (id, secret_hash)
values (1, public.community_hash_secret('DEFINA_AQUI_A_SENHA'))
on conflict (id) do update
  set secret_hash = excluded.secret_hash, updated_at = now();

-- ─── Publicar: agora devolve o código E o token do dono ────────────────
drop function if exists public.community_publish(text, text, int, int, text[], text, text, jsonb);

create or replace function public.community_publish(
  p_type         text,
  p_title        text,
  p_bpm          int,
  p_song_count   int,
  p_rhythms      text[],
  p_poster_name  text,
  p_poster_email text,
  p_payload      jsonb
) returns jsonb
-- Devolve {"code": "...", "token": "..."}. Retorna JSON (e não uma table com
-- colunas `code`/`token`) de propósito: nomes de saída iguais aos das colunas
-- deixam o RETURNING ambíguo no plpgsql ("column reference code is ambiguous").
language plpgsql security definer set search_path = public
as $$
declare
  v_code  text;
  v_token uuid;
  v_alpha text := '0123456789';
  i int;
begin
  if p_type not in ('rhythm','setlist') then raise exception 'bad_type'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'empty_title'; end if;
  if coalesce(btrim(p_poster_name), '') = '' then raise exception 'empty_poster'; end if;
  if p_payload is null then raise exception 'empty_payload'; end if;
  if octet_length(p_payload::text) > 5000000 then raise exception 'payload_too_big'; end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1);
    end loop;
    exit when not exists(select 1 from public.gdrums_community where code = v_code);
  end loop;

  insert into public.gdrums_community
    (code, type, title, bpm, song_count, rhythms, poster_name, poster_email, payload)
  values
    (v_code, p_type, left(btrim(p_title), 80), p_bpm, p_song_count,
     coalesce(p_rhythms, '{}'), left(btrim(p_poster_name), 40),
     nullif(lower(btrim(coalesce(p_poster_email, ''))), ''), p_payload)
  returning manage_token into v_token;

  return jsonb_build_object('code', v_code, 'token', v_token);
end;
$$;

grant execute on function
  public.community_publish(text, text, int, int, text[], text, text, jsonb)
  to anon, authenticated;

-- ─── Detalhe de um post (pro modal) ────────────────────────────────────
-- Read-only: NÃO conta download (quem conta é community_get). Devolve o
-- payload (receita leve) pra listar as músicas de um repertório.
create or replace function public.community_detail(p_code text)
returns table(
  code text, type text, title text, bpm int, song_count int,
  rhythms text[], poster_name text, likes int, downloads int,
  created_at timestamptz, official boolean, payload jsonb
)
language sql security definer set search_path = public
as $$
  select c.code, c.type, c.title, c.bpm, c.song_count, c.rhythms,
         c.poster_name, c.likes, c.downloads, c.created_at,
         coalesce(c.poster_email = any(array['staner_bass7@hotmail.com']), false),
         c.payload
  from public.gdrums_community c
  where c.code = p_code and c.active;
$$;
grant execute on function public.community_detail(text) to anon, authenticated;

-- ─── "Meus posts" (por e-mail) ─────────────────────────────────────────
-- Os posts já são públicos na vitrine; filtrar por e-mail não revela nada
-- novo. O botão de excluir continua dependendo do token (no navegador).
create or replace function public.community_mine(p_email text)
returns table(
  code text, type text, title text, bpm int, song_count int,
  rhythms text[], poster_name text, likes int, downloads int,
  created_at timestamptz, official boolean
)
language sql security definer set search_path = public
as $$
  select c.code, c.type, c.title, c.bpm, c.song_count, c.rhythms,
         c.poster_name, c.likes, c.downloads, c.created_at,
         coalesce(c.poster_email = any(array['staner_bass7@hotmail.com']), false)
  from public.gdrums_community c
  where c.active
    and c.poster_email = nullif(lower(btrim(coalesce(p_email, ''))), '')
  order by c.created_at desc
  limit 60;
$$;
grant execute on function public.community_mine(text) to anon, authenticated;

-- ─── Excluir: DONO (precisa do token secreto) ──────────────────────────
create or replace function public.community_delete(p_code text, p_token uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  update public.gdrums_community
    set active = false
    where code = p_code and manage_token = p_token and active;
  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end;
$$;
grant execute on function public.community_delete(text, uuid) to anon, authenticated;

-- ─── Conferir a senha de admin (sem apagar nada) ───────────────────────
create or replace function public.community_admin_check(p_secret text)
returns boolean
language sql security definer set search_path = public
as $$
  select exists(
    select 1 from public.gdrums_community_admin
    where id = 1 and secret_hash = public.community_hash_secret(p_secret)
  );
$$;
grant execute on function public.community_admin_check(text) to anon, authenticated;

-- ─── Excluir: ADMIN (qualquer post, com a senha) ───────────────────────
create or replace function public.community_delete_admin(p_code text, p_secret text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_ok boolean;
begin
  if not public.community_admin_check(p_secret) then
    raise exception 'bad_secret';
  end if;
  update public.gdrums_community
    set active = false
    where code = p_code and active;
  get diagnostics v_ok = row_count;
  return coalesce(v_ok, false);
end;
$$;
grant execute on function public.community_delete_admin(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Recuperar um post apagado (rode manualmente se precisar):
--   update public.gdrums_community set active = true where code = 'CODIGO';
--
-- Trocar a senha de admin depois:
--   update public.gdrums_community_admin
--     set secret_hash = public.community_hash_secret('NOVA_SENHA'), updated_at = now()
--     where id = 1;
--
-- ROLLBACK:
--   drop function if exists public.community_delete_admin(text, text);
--   drop function if exists public.community_admin_check(text);
--   drop function if exists public.community_delete(text, uuid);
--   drop function if exists public.community_mine(text);
--   drop function if exists public.community_detail(text);
--   drop function if exists public.community_hash_secret(text);
--   drop table if exists public.gdrums_community_admin;
--   alter table public.gdrums_community drop column if exists manage_token;
--   (e re-rode o bloco community_publish do _community_identity.sql)
-- ─────────────────────────────────────────────────────────────────────
