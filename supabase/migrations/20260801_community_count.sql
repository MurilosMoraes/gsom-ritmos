-- ─────────────────────────────────────────────────────────────────────
-- COMUNIDADE — total de itens (pra paginação da vitrine)
--
-- ADENDO: rode DEPOIS das migrations 20260730_community*.
--
-- Por que uma função nova em vez de mexer na community_list: mudar o
-- retorno dela exigiria DROP + CREATE, e um erro ali derruba a vitrine
-- inteira. Esta é puramente aditiva — se falhar, nada quebra.
--
-- Recebe os MESMOS filtros da community_list, senão a contagem não bate
-- com o que está sendo listado (ex.: buscar "vaneira" mostraria 1 página
-- de resultados mas o seletor ofereceria 5).
--
-- Aplicar no Supabase: Dashboard -> SQL Editor -> colar tudo -> Run.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.community_count(
  p_rhythm text default null,
  p_type   text default null,
  p_search text default null
) returns bigint
language sql stable security definer set search_path = public
as $$
  select count(*)
  from public.gdrums_community c
  where c.active
    and (p_rhythm is null or p_rhythm = any(c.rhythms))
    and (p_type   is null or c.type = p_type)
    and (p_search is null or c.title ilike '%' || p_search || '%');
$$;

grant execute on function public.community_count(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.community_count(text, text, text);
-- ─────────────────────────────────────────────────────────────────────
