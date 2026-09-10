-- Textos de contato (WhatsApp) editáveis pelo admin.
--
-- Antes ficavam fixos no código (admin.ts): pra trocar uma vírgula era
-- preciso deploy. Agora o time edita direto no painel.
--
-- Segurança: RLS ligada e SEM policy = ninguém acessa via anon/authenticated.
-- O painel lê e grava pela edge function admin-api (service_role), que já
-- confere role='admin' no banco. Mesmo padrão do resto do admin.

create table if not exists public.gdrums_message_templates (
  key         text primary key,
  label       text not null,
  descricao   text,
  corpo       text not null,
  variaveis   text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

alter table public.gdrums_message_templates enable row level security;

-- Conteúdo inicial: cópia EXATA do que o código já mandava hoje, pra
-- ninguém perceber diferença no dia do deploy. Variáveis em {{chave}}.
insert into public.gdrums_message_templates (key, label, descricao, corpo, variaveis) values
(
  'lead_whatsapp',
  'Lead — primeiro contato',
  'Enviada pelo botão WhatsApp na tela de Leads (quem se cadastrou e não assinou).',
  'Oi{{saudacao_nome}}! Tudo bem? Aqui é a Camila.

Recebemos seu cadastro no nosso Aplicativo de ritmos GDrums e liberamos um cupom especial de 30% OFF pra você!

Posso te enviar por aqui?',
  array['saudacao_nome']
),
(
  'tx_confirmed',
  'Transação — pagamento confirmado',
  'Botão WhatsApp na tela de Transações, quando a compra foi confirmada.',
  'Oi{{saudacao_nome}}! Tudo bem? Aqui é o pessoal do GDrums 🥁

Vi que sua assinatura do plano {{plano}} está ativa. Qualquer dúvida pra usar o app é só me chamar por aqui!',
  array['saudacao_nome','plano']
),
(
  'tx_pending',
  'Transação — pagamento pendente',
  'Botão WhatsApp na tela de Transações, quando o pagamento ficou pendente.',
  'Oi{{saudacao_nome}}! Tudo bem? Aqui é o pessoal do GDrums 🥁

Vi que você começou a assinatura do plano {{plano}} mas o pagamento ficou pendente. Posso te ajudar a finalizar?',
  array['saudacao_nome','plano']
),
(
  'tx_expired',
  'Transação — assinatura expirada',
  'Botão WhatsApp na tela de Transações, quando a assinatura venceu.',
  'Oi{{saudacao_nome}}! Tudo bem? Aqui é o pessoal do GDrums 🥁

Vi que sua assinatura do plano {{plano}} expirou. Quer que eu te ajude a renovar? Posso liberar uma condição especial pra você.',
  array['saudacao_nome','plano']
),
(
  'renovacao',
  'Renovação — aviso de vencimento',
  'Botão WhatsApp na tela de Renovações (quem vence nos próximos dias).',
  'Oi{{saudacao_nome}}! Tudo certo? 🥁

Aqui é do GDrums. Teu plano {{plano}} {{quando}} — não quero que tu fique sem a tua banda no palco!{{bloco_cupom}}

Quer que eu te ajude a renovar?',
  array['saudacao_nome','plano','quando','bloco_cupom']
),
(
  'renovacao_cupom',
  'Renovação — trecho do cupom',
  'Colado no lugar de {{bloco_cupom}} SÓ quando um cupom está selecionado na tela de Renovações.',
  '

E pra renovar agora, usa o cupom *{{cupom}}* que tem desconto. 😉',
  array['cupom']
)
on conflict (key) do nothing;
