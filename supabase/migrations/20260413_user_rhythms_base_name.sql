-- Adiciona base_rhythm_name em gdrums_user_rhythms.
--
-- Guarda o nome do ritmo de referência (ex: "Vaneira") no momento em que o
-- usuário salvou a versão personalizada (ex: "Vaneira do João"). Permite
-- mostrar essa referência na barra de repertório.
--
-- Campo opcional — ritmos salvos antes dessa migration têm null (sem base).
-- Aplicar no SQL Editor do Supabase.

ALTER TABLE public.gdrums_user_rhythms
  ADD COLUMN IF NOT EXISTS base_rhythm_name text;
