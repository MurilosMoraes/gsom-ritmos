-- ─────────────────────────────────────────────────────────────────────
-- COMUNIDADE GDrums — vitrine pública de músicas e repertórios
-- (site separado: comunidade.gdrums.com.br)
--
-- Diferente do compartilhamento privado (gdrums_shared, por código), aqui o
-- conteúdo é PÚBLICO e NAVEGÁVEL: qualquer um posta (sem login) colando um
-- link do app, e qualquer um lista/baixa/curte. Guarda CÓPIA PRÓPRIA do
-- payload (sobrevive mesmo se o autor apagar o share original).
--
-- Categoria = ritmo(s) usado(s), extraído do conteúdo (campo `base`). Sem
-- gênero/categoria manual.
--
-- Aplicar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- Reverter: rodar o bloco "ROLLBACK" no fim (comentado).
-- Isolado: cria coisas NOVAS, não toca em nenhuma tabela existente.
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.gdrums_community (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,                 -- código próprio (6 dígitos)
  type        text not null check (type in ('rhythm','setlist')),
  title       text not null,                        -- nome da música / repertório
  bpm         int,                                  -- só música (null p/ repertório)
  song_count  int,                                  -- só repertório (null p/ música)
  rhythms     text[] not null default '{}',         -- ritmos usados (p/ filtro)
  poster_name text not null,                        -- nome que a pessoa se deu
  payload     jsonb not null,                       -- cópia auto-contida do conteúdo
  likes       int  not null default 0,
  downloads   int  not null default 0,
  active      bool not null default true,           -- moderação: admin oculta = false
  created_at  timestamptz not null default now()
);

-- Índices da vitrine: por recentes, por curtidas e filtro por ritmo.
create index if not exists gdrums_community_recent_idx  on public.gdrums_community(active, created_at desc);
create index if not exists gdrums_community_likes_idx   on public.gdrums_community(active, likes desc);
create index if not exists gdrums_community_rhythms_idx on public.gdrums_community using gin(rhythms);

alter table public.gdrums_community enable row level security;

-- Acesso à tabela é SÓ via RPC (security definer). Ninguém lê/escreve direto.
revoke all on public.gdrums_community from anon, authenticated;

-- ─── Publicar (qualquer um, sem login) ─────────────────────────────────
-- O site cola o link, decodifica o payload, extrai os metadados e chama aqui.
-- Gera código numérico único de 6 dígitos. Payload até 5 MB. Retorna o código.
create or replace function public.community_publish(
  p_type        text,
  p_title       text,
  p_bpm         int,
  p_song_count  int,
  p_rhythms     text[],
  p_poster_name text,
  p_payload     jsonb
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code  text;
  v_alpha text := '0123456789';
  i int;
begin
  if p_type not in ('rhythm','setlist') then raise exception 'bad_type'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'empty_title'; end if;
  if coalesce(btrim(p_poster_name), '') = '' then raise exception 'empty_poster'; end if;
  if p_payload is null then raise exception 'empty_payload'; end if;
  if octet_length(p_payload::text) > 5000000 then raise exception 'payload_too_big'; end if;

  -- gera código único de 6 dígitos
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random()*length(v_alpha))::int, 1);
    end loop;
    exit when not exists(select 1 from public.gdrums_community where code = v_code);
  end loop;

  insert into public.gdrums_community
    (code, type, title, bpm, song_count, rhythms, poster_name, payload)
  values
    (v_code, p_type, left(btrim(p_title), 80), p_bpm, p_song_count,
     coalesce(p_rhythms, '{}'), left(btrim(p_poster_name), 40), p_payload);

  return v_code;
end;
$$;

-- ─── Listar a vitrine (público) ────────────────────────────────────────
-- Sem o payload (mantém leve). Ordena por 'recent' (padrão) ou 'likes'.
-- Filtros opcionais: por ritmo (rhythms[]), por tipo (rhythm/setlist) e
-- busca por nome (ilike). Drop antes: assinatura antiga não pode coexistir.
drop function if exists public.community_list(int, int, text, text);
create or replace function public.community_list(
  p_limit  int  default 30,
  p_offset int  default 0,
  p_sort   text default 'recent',
  p_rhythm text default null,
  p_type   text default null,
  p_search text default null
) returns table(
  code text, type text, title text, bpm int, song_count int,
  rhythms text[], poster_name text, likes int, downloads int, created_at timestamptz
)
language sql security definer set search_path = public
as $$
  select c.code, c.type, c.title, c.bpm, c.song_count, c.rhythms,
         c.poster_name, c.likes, c.downloads, c.created_at
  from public.gdrums_community c
  where c.active
    and (p_rhythm is null or p_rhythm = any(c.rhythms))
    and (p_type   is null or c.type = p_type)
    and (p_search is null or c.title ilike '%' || p_search || '%')
  order by
    case when p_sort = 'likes' then c.likes end desc nulls last,
    c.created_at desc
  limit  least(greatest(coalesce(p_limit, 30), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ─── Lista de ritmos que aparecem na vitrine (p/ montar o filtro) ───────
-- p_type limita ao tipo da aba (rhythm/setlist); null = tudo.
drop function if exists public.community_rhythms();
create or replace function public.community_rhythms(p_type text default null)
returns table(rhythm text, n bigint)
language sql security definer set search_path = public
as $$
  select r as rhythm, count(*) as n
  from public.gdrums_community c, unnest(c.rhythms) as r
  where c.active and (p_type is null or c.type = p_type)
  group by r
  order by n desc, r asc;
$$;

-- ─── Números da comunidade (hero do site) ──────────────────────────────
create or replace function public.community_stats()
returns table(rhythm_count bigint, setlist_count bigint, downloads bigint, likes bigint)
language sql security definer set search_path = public
as $$
  select
    count(*) filter (where type = 'rhythm'),
    count(*) filter (where type = 'setlist'),
    coalesce(sum(downloads), 0),
    coalesce(sum(likes), 0)
  from public.gdrums_community
  where active;
$$;

-- ─── Baixar (público) — devolve o payload e conta +1 download ───────────
create or replace function public.community_get(p_code text)
returns table(type text, title text, payload jsonb)
language plpgsql security definer set search_path = public
as $$
begin
  update public.gdrums_community set downloads = downloads + 1
    where code = p_code and active;
  return query
    select c.type, c.title, c.payload
    from public.gdrums_community c
    where c.code = p_code and c.active;
end;
$$;

-- ─── Curtir (público) — +1 e devolve o total. Trava de "1x por navegador"
--     é no cliente (localStorage); aqui é incremento simples. ────────────
create or replace function public.community_like(p_code text)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_likes int;
begin
  update public.gdrums_community set likes = likes + 1
    where code = p_code and active
    returning likes into v_likes;
  return coalesce(v_likes, 0);
end;
$$;

grant execute on function public.community_publish(text, text, int, int, text[], text, jsonb) to anon, authenticated;
grant execute on function public.community_list(int, int, text, text, text, text)              to anon, authenticated;
grant execute on function public.community_rhythms(text)                                       to anon, authenticated;
grant execute on function public.community_stats()                                             to anon, authenticated;
grant execute on function public.community_get(text)                                           to anon, authenticated;
grant execute on function public.community_like(text)                                          to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (desfaz tudo — isolado, não toca outros dados):
--   drop function if exists public.community_like(text);
--   drop function if exists public.community_get(text);
--   drop function if exists public.community_stats();
--   drop function if exists public.community_rhythms(text);
--   drop function if exists public.community_list(int, int, text, text, text, text);
--   drop function if exists public.community_publish(text, text, int, int, text[], text, jsonb);
--   drop table if exists public.gdrums_community;
-- ─────────────────────────────────────────────────────────────────────
