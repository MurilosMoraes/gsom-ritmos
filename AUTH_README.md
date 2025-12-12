# Sistema de Autenticação e Admin - GDrums

## 📋 Visão Geral

Sistema completo de autenticação, controle de acesso e painel administrativo para o GDrums.

## 🎯 Funcionalidades Implementadas

### 1. **Páginas de Autenticação**
- ✅ Login (`login.html`) - Design profissional com animações
- ✅ Registro (`register.html`) - Validação de senha e termos
- ✅ Estilos modernos (`auth-styles.css`) - Gradientes, blur effects, responsivo

### 2. **Painel Administrativo**
- ✅ Dashboard (`admin.html`) - Interface completa
- ✅ Estilos admin (`admin-styles.css`) - Design profissional
- **Seções:**
  - Dashboard com estatísticas
  - Gerenciamento de usuários
  - Gerenciamento de assinaturas
  - Configurações

### 3. **Controle de Acesso**
- ✅ Service de autenticação (`AuthService.ts`)
- ✅ Proteção anti-compartilhamento com device fingerprinting
- ✅ Sistema de JWT (simulado, pronto para integração real)
- ✅ Controle de dispositivos por usuário

### 4. **Segurança**
- Device fingerprinting único
- Limite de dispositivos por usuário (2 padrão)
- Validação de assinatura
- Status de conta (active, inactive, blocked)

## 📁 Estrutura de Arquivos

```
rhythm-sequencer/
├── login.html                 # Página de login
├── register.html              # Página de registro
├── admin.html                 # Dashboard administrativo
├── auth-styles.css            # Estilos de autenticação
├── admin-styles.css           # Estilos do admin
└── src/
    └── auth/
        ├── AuthService.ts     # Serviço de autenticação
        ├── login.ts           # Script da página de login
        ├── register.ts        # [PENDENTE] Script de registro
        └── admin.ts           # [PENDENTE] Script do dashboard

```

## 🔧 Próximos Passos para Implementação

### Scripts TypeScript Faltantes:

1. **register.ts** - Script da página de registro
   - Validação de senha forte
   - Verificação de e-mail duplicado
   - Indicador de força da senha
   - Aceite de termos

2. **admin.ts** - Script do dashboard admin
   - Estatísticas em tempo real
   - CRUD completo de usuários
   - Gerenciamento de assinaturas
   - Filtros e busca
   - Modais de edição/exclusão
   - Gráficos com Chart.js

### Backend/API:

3. **API Endpoints** (implementar no servidor):
   ```
   POST   /api/auth/register     - Criar conta
   POST   /api/auth/login        - Login
   POST   /api/auth/logout       - Logout
   GET    /api/auth/me           - Obter usuário atual
   GET    /api/admin/users       - Listar usuários
   POST   /api/admin/users       - Criar usuário
   PUT    /api/admin/users/:id   - Atualizar usuário
   DELETE /api/admin/users/:id   - Deletar usuário
   GET    /api/admin/stats       - Estatísticas
   PUT    /api/subscriptions/:id - Atualizar assinatura
   ```

4. **Banco de Dados** (schema sugerido):
   - users (id, name, email, password_hash, role, status, created_at)
   - subscriptions (id, user_id, plan, status, start_date, expiry_date, auto_renew)
   - devices (id, user_id, fingerprint, name, last_access, ip, user_agent)
   - payments (id, user_id, subscription_id, amount, status, date)

### Integrações:

5. **Gateway de Pagamento**
   - Integração com Stripe/Mercado Pago
   - Webhooks para renovações
   - Gerenciamento de planos

6. **E-mail Service**
   - Envio de e-mail de confirmação
   - Reset de senha
   - Notificações de vencimento

## 🎨 Design System

### Cores
```css
--primary: #00d4ff        /* Cyan principal */
--primary-dark: #0099ff   /* Azul escuro */
--success: #00ff88        /* Verde sucesso */
--error: #ff3366          /* Vermelho erro */
--warning: #ffaa00        /* Amarelo aviso */
--bg-dark: #0a0a0f        /* Fundo escuro */
```

### Componentes
- Botões primários com gradiente
- Inputs com border focus animado
- Modais com blur backdrop
- Cards com hover effects
- Status badges coloridos
- Tabelas responsivas

## 🔐 Segurança Implementada

### Anti-Compartilhamento
O sistema usa **device fingerprinting** para identificar dispositivos únicos:

```typescript
getDeviceFingerprint() {
  // Combina:
  - User Agent
  - Idioma
  - Hardware (núcleos CPU)
  - Resolução de tela
  - Profundidade de cor
  - Timezone
  - Plataforma
}
```

### Limites
- Máximo 2 dispositivos por conta (configurável)
- Bloqueio automático ao exceder
- Admin pode ajustar limite por usuário

### Validação de Sessão
```typescript
async checkAccess() {
  1. Verificar token JWT
  2. Verificar status da conta
  3. Verificar assinatura ativa
  4. Verificar dispositivo registrado
  5. Validar limite de dispositivos
}
```

## 🚀 Como Usar

### Desenvolvimento Local

1. **Iniciar servidor de desenvolvimento:**
```bash
npm run dev
```

2. **Acessar páginas:**
   - Login: http://localhost:5173/login.html
   - Registro: http://localhost:5173/register.html
   - Admin: http://localhost:5173/admin.html (requer login admin)

### Credenciais de Teste (Mock)

**Admin:**
- Email: admin@gdrums.com
- Senha: qualquer

**Usuário:**
- Email: user@gdrums.com
- Senha: qualquer

## 📊 Dashboard Admin - Funcionalidades

### Estatísticas
- Total de usuários
- Assinaturas ativas
- Receita mensal (MRR)
- Taxa de crescimento

### Gerenciamento de Usuários
- Lista paginada de usuários
- Busca por nome/email
- Filtro por status
- Editar usuário (modal)
- Bloquear/Desbloquear
- Ajustar limite de dispositivos
- Ver dispositivos ativos
- Excluir usuário (confirmação)

### Gerenciamento de Assinaturas
- Lista de todas as assinaturas
- Filtro por status
- Renovar manualmente
- Cancelar assinatura
- Alterar data de vencimento
- Toggle auto-renovação

## 🛣️ Fluxo do Usuário

### 1. Novo Usuário
```
Landing Page → Criar Conta → Pagamento → Login → App
```

### 2. Usuário Existente
```
Login → Validação de Dispositivo → App
```

### 3. Excesso de Dispositivos
```
Login → Dispositivo Não Autorizado → Erro/Contato Suporte
```

## 💳 Planos de Assinatura

### Profissional
- R$ 49/mês
- 150+ ritmos
- Editor completo
- Exportação MIDI ilimitada
- Suporte prioritário
- 2 dispositivos

## ⚙️ Configurações Importantes

```typescript
// AuthService.ts
private readonly TOKEN_KEY = 'gdrums_token';
private readonly USER_KEY = 'gdrums_user';
private readonly DEVICE_KEY = 'gdrums_device';

// Configurável por usuário:
maxDevices: 2          // Máximo de dispositivos
autoRenew: true        // Renovação automática
status: 'active'       // Status da conta
```

## 🔄 Próximas Atualizações

- [ ] Implementar backend real (Node.js/Express ou similar)
- [ ] Integração com gateway de pagamento
- [ ] Sistema de recuperação de senha
- [ ] E-mails transacionais
- [ ] Gráficos no dashboard
- [ ] Logs de auditoria
- [ ] Relatórios exportáveis
- [ ] API REST documentada
- [ ] Testes unitários e E2E

## 📞 Suporte

Para dúvidas ou problemas, entre em contato através de:
- Email: suporte@gdrums.com
- WhatsApp: (XX) XXXXX-XXXX

---

**Versão:** 1.0.0
**Última atualização:** Dezembro 2025
**Desenvolvido por:** Claude Code com Anthropic
