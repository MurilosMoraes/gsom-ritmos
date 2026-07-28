-- ─────────────────────────────────────────────────────────────────────
-- Compartilhamento de ritmos e repertórios por LINK CURTO (gdrums.com.br/r/CÓDIGO)
--
-- Modelo: quem compartilha publica um "retrato" (payload jsonb auto-contido)
-- e ganha um CÓDIGO curto. Quem recebe abre /r/CÓDIGO -> o app lê via RPC e
-- clona na conta. Leitura NÃO é direta na tabela (anti-varredura): só pela
-- função get_shared(). Publicar é só do dono (RLS + RPC).
--
-- Aplicar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- Reverter (se não gostar): rodar o bloco "ROLLBACK" no fim (comentado).
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.gdrums_shared (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('rhythm','setlist')),
  title       text not null,
  payload     jsonb not null,
  downloads   int  not null default 0,
  active      bool not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- re-compartilhar o MESMO item (mesmo tipo+título) atualiza o registro
  -- existente e mantém o mesmo código (link estável).
  unique (owner_id, type, title)
);

create index if not exists gdrums_shared_owner_idx on public.gdrums_shared(owner_id);

alter table public.gdrums_shared enable row level security;

-- Dono gerencia os próprios registros. (Leitura pública é só via RPC.)
drop policy if exists gdrums_shared_owner_all on public.gdrums_shared;
create policy gdrums_shared_owner_all on public.gdrums_shared
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Ninguém lê a tabela direto sem ser o dono (anti-enumeração de códigos).
revoke all on public.gdrums_shared from anon;

-- ─── Publicar (dono) ───────────────────────────────────────────────────
-- Gera código único (6 chars, alfabeto sem 0/O/1/I/L). Limites: 30 shares
-- ativos por usuário; payload até 5 MB. Retorna o código.
create or replace function public.publish_share(
  p_type text, p_title text, p_payload jsonb
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text;
  v_alpha text := '0123456789'; -- código numérico (link fica gdrums.com.br/123456)
  v_exists bool;
  i int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_type not in ('rhythm','setlist') then raise exception 'bad_type'; end if;
  if octet_length(p_payload::text) > 5000000 then raise exception 'payload_too_big'; end if;

  select exists(
    select 1 from public.gdrums_shared
    where owner_id = v_uid and type = p_type and title = p_title
  ) into v_exists;

  -- Limite só conta pra registros NOVOS (re-share do mesmo item atualiza).
  if not v_exists then
    if (select count(*) from public.gdrums_shared where owner_id = v_uid and active) >= 30 then
      raise exception 'share_limit';
    end if;
    -- gera código único
    loop
      v_code := '';
      for i in 1..6 loop
        v_code := v_code || substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1);
      end loop;
      exit when not exists(select 1 from public.gdrums_shared where code = v_code);
    end loop;
  end if;

  insert into public.gdrums_shared (code, owner_id, type, title, payload)
  values (coalesce(v_code, ''), v_uid, p_type, p_title, p_payload)
  on conflict (owner_id, type, title) do update
    set payload = excluded.payload,
        updated_at = now(),
        active = true
  returning code into v_code;

  return v_code;
end;
$$;

-- ─── Ler por código (público) ──────────────────────────────────────────
-- Retorna o conteúdo de um código ATIVO e conta +1 download. Não expõe o
-- dono nem permite listar/varrer.
create or replace function public.get_shared(p_code text)
returns table(type text, title text, payload jsonb)
language plpgsql security definer set search_path = public
as $$
begin
  update public.gdrums_shared set downloads = downloads + 1
    where code = p_code and active;
  return query
    select s.type, s.title, s.payload
    from public.gdrums_shared s
    where s.code = p_code and s.active;
end;
$$;

grant execute on function public.publish_share(text, text, jsonb) to authenticated;
grant execute on function public.get_shared(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (se quiser desfazer tudo — isolado, não toca outros dados):
--   drop function if exists public.get_shared(text);
--   drop function if exists public.publish_share(text, text, jsonb);
--   drop table if exists public.gdrums_shared;
-- ─────────────────────────────────────────────────────────────────────
