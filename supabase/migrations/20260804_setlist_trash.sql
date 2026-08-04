-- ─────────────────────────────────────────────────────────────────────
-- LIXEIRA DE REPERTÓRIOS (interna, só pra suporte)
--
-- JÁ APLICADA EM PRODUÇÃO em 2026-08-04. Este arquivo é o registro.
--
-- POR QUE EXISTE: excluir repertório grava um TOMBSTONE que propaga pra
-- todos os aparelhos e não tem desfazer. Um cliente perdeu um repertório
-- de 14 músicas com um toque acidental. As MÚSICAS sobrevivem (moram em
-- gdrums_user_rhythms, tabela separada) — o que some é a LISTA que
-- agrupava elas, e remontar na mão leva tempo.
--
-- NÃO TEM INTERFACE NO APP, de propósito. Quem acessa é o suporte, por
-- consulta direta com credencial de administrador, quando o cliente pede.
-- Por isso não existe RPC de leitura nem de restauração aqui: o app só
-- deposita, nunca lê.
--
-- CONSULTA DE SUPORTE (dashboard -> SQL Editor):
--   select t.deleted_at, t.setlist->>'name' as repertorio,
--          jsonb_array_length(t.setlist->'items') as musicas, t.setlist
--   from public.gdrums_setlist_trash t
--   join auth.users u on u.id = t.user_id
--   where u.email = 'email-do-cliente@exemplo.com'
--   order by t.deleted_at desc;
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.gdrums_setlist_trash (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  setlist    jsonb not null,   -- {id, name, items, deletedAt} como estava
  deleted_at timestamptz not null default now()
);

create index if not exists gdrums_setlist_trash_user_idx
  on public.gdrums_setlist_trash(user_id, deleted_at desc);

alter table public.gdrums_setlist_trash enable row level security;
-- Sem policy e sem grant: ninguém alcança a tabela direto, só a RPC abaixo.
revoke all on public.gdrums_setlist_trash from anon, authenticated;

-- ─── Guardar na lixeira (chamada pelo app ao excluir) ──────────────────
-- Amarrada no auth.uid(): o app não escolhe de quem é o registro, então
-- não dá pra poluir a lixeira de outro usuário. Best-effort — o cliente
-- ignora o retorno, porque backup falhando não pode travar a exclusão.
create or replace function public.setlist_trash_add(p_setlist jsonb)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_setlist is null then return false; end if;
  -- Lista vazia não tem o que recuperar.
  if coalesce(jsonb_array_length(p_setlist->'items'), 0) = 0 then return false; end if;
  if octet_length(p_setlist::text) > 2000000 then return false; end if;

  insert into public.gdrums_setlist_trash (user_id, setlist)
  values (v_uid, p_setlist);
  return true;
end;
$$;

grant execute on function public.setlist_trash_add(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK:
--   drop function if exists public.setlist_trash_add(jsonb);
--   drop table if exists public.gdrums_setlist_trash;
-- ─────────────────────────────────────────────────────────────────────
