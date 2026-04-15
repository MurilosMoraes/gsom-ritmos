# GDrums — Data Safety Form (Google Play)

Respostas exatas pra cada pergunta do questionário "Segurança dos dados"
no Play Console. Cole exatamente como tá aqui.

---

## Visão geral

O Play Console pergunta **3 categorias**:
1. **Coleta de dados** — quais dados você coleta dos usuários?
2. **Compartilhamento** — você compartilha com terceiros?
3. **Segurança** — encriptação, deleção etc.

---

## 1. Coleta de dados — DADOS QUE COLETAMOS

### Informações pessoais

| Tipo de dado | Coletado? | Compartilhado? | Obrigatório? | Por quê |
|---|---|---|---|---|
| Nome | ✅ Sim | ❌ Não | Obrigatório | Personalização da conta, comunicação |
| Endereço de email | ✅ Sim | ❌ Não | Obrigatório | Login, comunicação, recuperação de senha |
| ID do usuário | ✅ Sim | ❌ Não | Obrigatório | Funcionalidade do app, gestão de conta |
| Endereço | ❌ Não | — | — | — |
| Número de telefone | ✅ Sim | ❌ Não | Obrigatório | Recuperação de conta, prevenção de fraude (uma conta por telefone) |
| Raça / etnia | ❌ Não | — | — | — |
| Crenças políticas / religiosas | ❌ Não | — | — | — |
| Orientação sexual | ❌ Não | — | — | — |
| Outra info pessoal | ✅ Sim — **CPF (hashed)** | ❌ Não | Obrigatório | Prevenção de fraude (uma conta por CPF, evitar abuso de trial) — armazenamos só hash SHA-256, não o CPF em si |

### Informações financeiras

| Tipo de dado | Coletado? | Compartilhado? | Obrigatório? | Por quê |
|---|---|---|---|---|
| Informações de pagamento (cartão) | ❌ Não | — | — | App não processa pagamento. Pagamento é feito no site (gdrums.com.br), via gateway externo (InfinitePay). |
| Histórico de compras | ✅ Sim — registro de transações pagas no site | ❌ Não | Funcionalidade do app | Validar acesso aos recursos pagos do app |
| Pontuação de crédito | ❌ Não | — | — | — |
| Outras informações financeiras | ❌ Não | — | — | — |

### Saúde e fitness

Tudo **❌ Não** coletado.

### Mensagens

Tudo **❌ Não** coletado.

### Fotos e vídeos

Tudo **❌ Não** coletado.

### Arquivos de áudio

| Tipo de dado | Coletado? | Compartilhado? | Obrigatório? | Por quê |
|---|---|---|---|---|
| Gravações de voz ou áudio | ❌ Não | — | — | — |
| Arquivos de música | ❌ Não | — | — | App reproduz samples próprios já incluídos. Não acessa biblioteca de música do user. |
| Outros arquivos de áudio | ❌ Não | — | — | — |

### Arquivos e documentos

| Tipo de dado | Coletado? | Compartilhado? | Obrigatório? | Por quê |
|---|---|---|---|---|
| Arquivos e documentos | ✅ Sim — **JSON de ritmos personalizados** que o user salva | ❌ Não | Opcional | Permitir ao user salvar e restaurar seus ritmos personalizados |

### Calendário

Tudo **❌ Não**.

### Contatos

Tudo **❌ Não**.

### Atividade no app

| Tipo de dado | Coletado? | Compartilhado? | Obrigatório? | Por quê |
|---|---|---|---|---|
| Interações no app | ✅ Sim — uso de funções (qual ritmo tocou, repertório montado) | ❌ Não | Opcional | Análise interna (sem terceiros), melhorias do app |
| Histórico de busca no app | ❌ Não | — | — | — |
| Outras ações no app | ✅ Sim — favoritos, ritmos pessoais salvos | ❌ Não | Opcional | Persistir preferências do user |

### Histórico de navegação

Tudo **❌ Não**.

### Pesquisa na Web

Tudo **❌ Não**.

### Apps instalados

Tudo **❌ Não**.

### Outras ações do usuário

Tudo **❌ Não**.

### Informações e desempenho do app

| Tipo de dado | Coletado? | Compartilhado? | Obrigatório? | Por quê |
|---|---|---|---|---|
| Registros de falhas | ❌ Não | — | — | (Se quiser ativar Crashlytics no futuro, marca SIM aqui) |
| Diagnósticos | ❌ Não | — | — | — |
| Outras infos de desempenho | ❌ Não | — | — | — |

### Dispositivo ou outros IDs

| Tipo de dado | Coletado? | Compartilhado? | Obrigatório? | Por quê |
|---|---|---|---|---|
| ID do dispositivo | ❌ Não | — | — | — |

---

## 2. Compartilhamento de dados

**Você compartilha algum dos dados coletados com terceiros?**

✅ **Sim** — para o nosso processador de pagamentos.

| Dado | Compartilhado com | Motivo |
|---|---|---|
| Nome | InfinitePay | Processar assinatura no site (não no app) |
| Email | InfinitePay | Recibo de pagamento no site (não no app) |

> ⚠️ Importante: o app NÃO compartilha esses dados com a InfinitePay. O **site** sim. Pra evitar confusão na review do Play, é honesto declarar que dados podem ser compartilhados via processador de pagamento, já que o user da loja vai assinar pelo site usando esses mesmos dados.

---

## 3. Segurança

| Pergunta | Resposta |
|---|---|
| Os dados são criptografados em trânsito? | ✅ **Sim** — todo tráfego é HTTPS (TLS) |
| Você fornece uma forma para os usuários solicitarem a exclusão dos dados? | ✅ **Sim** — botão "Excluir minha conta" no app + suporte WhatsApp |
| Sua coleta de dados está em conformidade com a Política de famílias do Google Play? | **Não aplicável** — app não é direcionado a crianças. Categoria: Adultos (18+). |

---

## 4. URL da Política de Privacidade

```
https://gdrums.com.br/privacy
```

---

## 5. Tags pra "Por que você coleta esse dado"

Pra cada dado coletado, Google pede categoria do **propósito**. Use estes:

| Dado | Propósito principal |
|---|---|
| Nome | Funcionalidade do app + Comunicação |
| Email | Funcionalidade do app + Comunicação + Gestão de conta |
| Telefone | Prevenção de fraude, segurança e cumprimento legal |
| ID do usuário | Funcionalidade do app + Gestão de conta |
| CPF (hash) | Prevenção de fraude, segurança e cumprimento legal |
| Histórico de compras | Funcionalidade do app |
| Arquivos (ritmos pessoais) | Funcionalidade do app |
| Interações no app | Análise interna |
| Outras ações (favoritos) | Funcionalidade do app |

---

## 6. Coleta de dados em tempo real (efêmera)

Google pergunta se o app processa algum dado em tempo real **sem armazenar**:

- ✅ **Sim** — áudio gerado pelo motor (samples MIDI) é processado em tempo real no device, sem ser enviado a servidor nem armazenado.
- Mas isso é processamento local, não conta como "coleta de dados".

Marcar **Não** se a pergunta for "coleta dados sem armazenar pra terceiros".

---

## 7. Perguntas que podem aparecer

### "Os dados podem ser excluídos pelo usuário?"

✅ **Sim** — botão "Excluir minha conta" no app no Minha Conta. Backup interno mantido por 90 dias pra recuperação em caso de exclusão acidental, depois apagado.

### "Você usa esses dados para publicidade ou marketing?"

❌ **Não** — sem ads, sem marketing automático. Comunicações são apenas operacionais (recibo, expiração de trial).

### "Os dados são usados para análise de comportamento?"

✅ **Sim** — apenas internamente, sem terceiros. Métricas no admin dashboard pra entender uso.

---

## ✅ Resumo final pra colar resumido

> O GDrums é um app de música ao vivo (sequenciador rítmico). Coletamos email, nome, telefone, ID e CPF (hash) para autenticação e prevenção de abuso. Salvamos opcionalmente ritmos personalizados e favoritos do usuário no nosso servidor para sincronização. Não compartilhamos dados com terceiros, exceto o processador de pagamento (InfinitePay), que recebe nome e email durante a assinatura — feita exclusivamente no nosso site (gdrums.com.br), não no app. Todo tráfego é via HTTPS. Usuários podem excluir a conta pelo próprio app.
