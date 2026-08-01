-- ─────────────────────────────────────────────────────────────────────
-- COMUNIDADE — identidade de quem posta (nome + e-mail)
--
-- ADENDO ao 20260730_community.sql (rode DEPOIS dele). Guarda o e-mail
-- junto do post pra saber quem publicou (o nome já aparecia no card; o
-- e-mail NÃO é exposto na vitrine — community_list não devolve ele).
--
-- Aplicar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- Idempotente: pode rodar mais de uma vez sem quebrar.
-- ─────────────────────────────────────────────────────────────────────

alter table public.gdrums_community
  add column if not exists poster_email text;

create index if not exists gdrums_community_email_idx
  on public.gdrums_community(poster_email);

-- Republica a função com o e-mail. A assinatura muda, então dropa a antiga.
drop function if exists public.community_publish(text, text, int, int, text[], text, jsonb);

create or replace function public.community_publish(
  p_type         text,
  p_title        text,
  p_bpm          int,
  p_song_count   int,
  p_rhythms      text[],
  p_poster_name  text,
  p_poster_email text,
  p_payload      jsonb
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
     nullif(lower(btrim(coalesce(p_poster_email, ''))), ''), p_payload);

  return v_code;
end;
$$;

grant execute on function
  public.community_publish(text, text, int, int, text[], text, text, jsonb)
  to anon, authenticated;

-- ─── Selo oficial na vitrine ───────────────────────────────────────────
-- community_list passa a devolver `official`: true quando o post é de um
-- e-mail da equipe. O e-mail em si NUNCA é exposto — só o booleano.
-- Muda o tipo de retorno, então precisa dropar antes do create.
drop function if exists public.community_list(int, int, text, text, text, text);

create or replace function public.community_list(
  p_limit  int  default 30,
  p_offset int  default 0,
  p_sort   text default 'recent',
  p_rhythm text default null,
  p_type   text default null,
  p_search text default null
) returns table(
  code text, type text, title text, bpm int, song_count int,
  rhythms text[], poster_name text, likes int, downloads int,
  created_at timestamptz, official boolean
)
language sql security definer set search_path = public
as $$
  select c.code, c.type, c.title, c.bpm, c.song_count, c.rhythms,
         c.poster_name, c.likes, c.downloads, c.created_at,
         (c.poster_email = any(array['staner_bass7@hotmail.com'])) as official
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

grant execute on function public.community_list(int, int, text, text, text, text)
  to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.community_publish(text, text, int, int, text[], text, text, jsonb);
--   alter table public.gdrums_community drop column if exists poster_email;
-- (e re-rode o bloco community_publish do 20260730_community.sql)
-- ─────────────────────────────────────────────────────────────────────
