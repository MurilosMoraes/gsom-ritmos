-- Conta "incompleta" passa a respeitar o PAÍS e o WhatsApp OPCIONAL.
--
-- Antes:
--   check_email_status → 'incomplete' se faltasse CPF OU telefone, pra
--     qualquer conta. Resultado: (1) todo estrangeiro (sem CPF por
--     definição) seria mandado pro /completar-cadastro e ficaria preso lá;
--     (2) brasileiro que pulou o WhatsApp (opcional no cadastro desde o v7,
--     Apple 5.1.1) também era preso. Em set/2026: 20 contas BR nessa
--     situação, nenhuma virou pagante.
--   complete_my_profile → exigia telefone.
--
-- Agora:
--   - só conta do Brasil (country = 'BR') precisa de CPF;
--   - telefone nunca torna a conta incompleta;
--   - complete_my_profile aceita telefone vazio (mantém o que já existir) e,
--     se vier preenchido, valida formato e duplicidade como antes.
--
-- Compatível com os apps já instalados: eles sempre mandam telefone
-- preenchido nessa tela, e o caminho com telefone é o mesmo de antes.
-- DEPLOY: aplicar ANTES do site novo (o site novo pode mandar p_phone nulo).

CREATE OR REPLACE FUNCTION public.check_email_status(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user_id uuid;
  v_cpf_hash text;
  v_country text;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(trim(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT cpf_hash, COALESCE(country, 'BR') INTO v_cpf_hash, v_country
  FROM public.gdrums_profiles
  WHERE id = v_user_id;

  -- CPF é documento brasileiro: só conta do Brasil precisa dele.
  IF v_country = 'BR' AND v_cpf_hash IS NULL THEN
    RETURN jsonb_build_object('status', 'incomplete');
  END IF;

  RETURN jsonb_build_object('status', 'complete');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_my_profile(p_cpf_hash text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_user_id uuid;
  v_existing_cpf int;
  v_existing_phone int;
  v_phone text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_cpf_hash IS NULL OR length(p_cpf_hash) <> 64 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_cpf');
  END IF;

  -- Telefone opcional: vazio = não mexe no que já existe.
  v_phone := NULLIF(trim(COALESCE(p_phone, '')), '');
  IF v_phone IS NOT NULL AND (length(v_phone) < 10 OR length(v_phone) > 11) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_phone');
  END IF;

  -- Verifica duplicatas (excluindo o próprio user)
  SELECT count(*) INTO v_existing_cpf
  FROM gdrums_profiles
  WHERE cpf_hash = p_cpf_hash AND id <> v_user_id;
  IF v_existing_cpf > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'cpf_duplicate');
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT count(*) INTO v_existing_phone
    FROM gdrums_profiles
    WHERE phone = v_phone AND id <> v_user_id;
    IF v_existing_phone > 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'phone_duplicate');
    END IF;
  END IF;

  UPDATE gdrums_profiles
  SET cpf_hash = p_cpf_hash,
      phone = COALESCE(v_phone, phone),
      updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;
