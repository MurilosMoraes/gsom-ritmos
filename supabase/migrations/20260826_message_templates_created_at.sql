-- A tela Mensagens dava 500 ao carregar (admin-api -> 500).
--
-- Causa: adminFetch(), usado por TODAS as telas do admin, ordena por
-- created_at por padrao:
--   params: { select: '*', order: { column: 'created_at', ascending: false } }
-- A tabela nasceu sem essa coluna, entao o Postgres erra e a edge function
-- devolve 500 antes de retornar qualquer texto.
--
-- Corrigido na TABELA, nao no adminFetch: todas as outras tabelas gdrums_
-- tem created_at, entao adicionar aqui mantem o padrao em vez de abrir uma
-- excecao no helper que serve o admin inteiro.
alter table public.gdrums_message_templates
  add column if not exists created_at timestamptz not null default now();
