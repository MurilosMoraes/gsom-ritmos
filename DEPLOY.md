# 🚀 Deploy GDrums na Vercel

## Preparação para Deploy

O projeto já está configurado para deploy na Vercel! Siga os passos abaixo:

## 📋 Pré-requisitos

1. Conta na [Vercel](https://vercel.com)
2. Git instalado
3. Repositório no GitHub (recomendado)

## 🔧 Arquivos de Configuração

Os seguintes arquivos já estão configurados:

- ✅ `vercel.json` - Configuração de build e rotas
- ✅ `vite.config.ts` - Build otimizado
- ✅ `.vercelignore` - Arquivos ignorados no deploy
- ✅ `package.json` - Scripts de build

## 📦 Estrutura de Assets

**IMPORTANTE**: Os arquivos de áudio devem estar na pasta `public/`:

```
rhythm-sequencer/
├── public/
│   ├── midi/          # Arquivos de áudio (.wav, .mp3)
│   │   ├── bumbo.wav
│   │   ├── caixa.wav
│   │   ├── chimbal_fechado.wav
│   │   ├── chimbal_aberto.wav
│   │   ├── prato.mp3
│   │   ├── surdo.wav
│   │   ├── tom_1.wav
│   │   └── tom_2.wav
│   └── rhythm/        # Ritmos salvos (.json)
│       ├── pop.json
│       └── pop-complete.json
```

## 🚀 Opção 1: Deploy via GitHub (Recomendado)

### 1. Criar Repositório no GitHub

```bash
# Inicializar git (se ainda não foi feito)
git init

# Adicionar todos os arquivos
git add .

# Fazer commit
git commit -m "Initial commit: GDrums Studio"

# Adicionar remote do GitHub
git remote add origin https://github.com/seu-usuario/gdrums-studio.git

# Push para o GitHub
git push -u origin main
```

### 2. Conectar na Vercel

1. Acesse [vercel.com](https://vercel.com)
2. Faça login com sua conta GitHub
3. Clique em **"New Project"**
4. Selecione seu repositório `gdrums-studio`
5. Configure o projeto:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build` (já detectado automaticamente)
   - **Output Directory**: `dist` (já detectado automaticamente)
6. Clique em **"Deploy"**

### 3. Variáveis de Ambiente (Opcional)

Se precisar adicionar variáveis de ambiente:
- Vá em **Settings** → **Environment Variables**
- Adicione suas variáveis

## 🚀 Opção 2: Deploy via CLI da Vercel

### 1. Instalar Vercel CLI

```bash
npm install -g vercel
```

### 2. Login na Vercel

```bash
vercel login
```

### 3. Deploy

```bash
# Deploy de teste
vercel

# Deploy para produção
vercel --prod
```

## 📁 Mover Arquivos de Áudio

Se seus arquivos estão em `assets/`, mova-os para `public/`:

```bash
# Criar estrutura
mkdir -p public/midi
mkdir -p public/rhythm

# Mover arquivos MIDI
mv assets/midi/* public/midi/

# Mover arquivos de ritmo
mv assets/rhythm/* public/rhythm/
```

**Ou manualmente:**
1. Crie as pastas `public/midi` e `public/rhythm`
2. Copie os arquivos de `assets/` para `public/`

## ⚙️ Configurações Importantes

### URLs dos Arquivos

O código já está preparado para funcionar na Vercel. Os arquivos em `public/` são servidos na raiz:

- ❌ Errado: `/assets/midi/bumbo.wav`
- ✅ Correto: `/midi/bumbo.wav`

O código em [src/main.ts](src/main.ts) já usa os caminhos corretos.

### Cache e Performance

O `vercel.json` está configurado com:
- Cache de 1 ano para assets estáticos
- Headers de segurança
- Compressão automática

## 🔍 Verificar Deploy

Após o deploy, teste:

1. **Página Principal**: `https://seu-projeto.vercel.app/`
2. **Landing Page**: `https://seu-projeto.vercel.app/landing.html`
3. **Carregar MIDI**: Teste selecionar um arquivo MIDI
4. **Carregar Ritmo**: Teste carregar um ritmo salvo

## 🐛 Troubleshooting

### Arquivos de áudio não carregam

**Erro**: `Failed to fetch /assets/midi/bumbo.wav`

**Solução**:
1. Mova os arquivos para `public/midi/`
2. Verifique se o código usa `/midi/` e não `/assets/midi/`

### Build falha

**Erro**: TypeScript errors

**Solução**:
```bash
# Verificar erros localmente
npm run build

# Se houver erros de tipo, corrija-os
npx tsc --noEmit
```

### 404 ao navegar

**Solução**: O `vercel.json` já tem configuração de SPA (Single Page Application) que redireciona tudo para `index.html`

## 🔄 Atualizações Automáticas

Após conectar o GitHub à Vercel:
- ✅ Todo `git push` no branch `main` faz deploy automático
- ✅ PRs geram preview deployments
- ✅ Rollback fácil via dashboard da Vercel

## 📊 Monitoramento

Acesse o dashboard da Vercel para ver:
- Analytics de uso
- Logs de build
- Performance metrics
- Custos (plano gratuito: 100GB bandwidth/mês)

## 🎯 Domínio Customizado

Para usar seu próprio domínio:
1. Vá em **Settings** → **Domains**
2. Adicione seu domínio
3. Configure os DNS conforme instruções da Vercel

---

## ✅ Checklist Final

Antes de fazer deploy, verifique:

- [ ] Arquivos de áudio estão em `public/midi/`
- [ ] Arquivos de ritmo estão em `public/rhythm/`
- [ ] `npm run build` funciona sem erros
- [ ] Repositório no GitHub está atualizado
- [ ] `.gitignore` está configurado (não commitar `node_modules/`)

## 🎵 Pronto!

Seu GDrums Studio está pronto para o mundo! 🚀

**URL de exemplo**: `https://gdrums-studio.vercel.app`

Para suporte, visite: [Vercel Documentation](https://vercel.com/docs)
