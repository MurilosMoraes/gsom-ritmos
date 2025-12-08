# 🚀 Deploy Rápido na Vercel

## ✅ Pré-requisitos Já Configurados

- ✅ Pasta `public/` com arquivos MIDI e ritmos
- ✅ `vercel.json` configurado
- ✅ `vite.config.ts` atualizado
- ✅ Build testado e funcionando
- ✅ Landing page incluída

## 📦 Opção 1: Deploy via GitHub (Recomendado)

### 1. Criar repositório no GitHub

Vá para [github.com/new](https://github.com/new) e crie um novo repositório

### 2. Fazer push do código

```bash
# Se ainda não iniciou o git
git init
git add .
git commit -m "feat: GDrums Studio - Sequenciador profissional de bateria"

# Adicionar remote (substitua seu-usuario)
git remote add origin https://github.com/seu-usuario/gdrums-studio.git

# Push
git branch -M main
git push -u origin main
```

### 3. Deploy na Vercel

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Conecte sua conta GitHub
3. Selecione o repositório `gdrums-studio`
4. Clique em **Deploy** (já está tudo configurado!)

## 📦 Opção 2: Deploy via CLI da Vercel

```bash
# Instalar CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

## 🎯 URLs após Deploy

- **App**: `https://seu-projeto.vercel.app/`
- **Landing Page**: `https://seu-projeto.vercel.app/landing.html`

## ⚡ Comandos Úteis

```bash
# Build local
npm run build

# Preview do build
npm run preview

# Desenvolvimento
npm run dev
```

## 🔧 Estrutura de Arquivos

```
rhythm-sequencer/
├── public/              ✅ Arquivos servidos na raiz
│   ├── midi/           ✅ Áudio (.wav, .mp3)
│   └── rhythm/         ✅ Ritmos salvos (.json)
├── src/                ✅ Código TypeScript
├── dist/               ✅ Build de produção
├── index.html          ✅ App principal
├── landing.html        ✅ Landing page
└── vercel.json         ✅ Configuração Vercel
```

## ✨ O que já está configurado

1. **Build otimizado** com Vite
2. **Cache de assets** (MIDI = 1 ano, Ritmos = 1 dia)
3. **Headers de segurança** (XSS, Content-Type, Frame)
4. **SPA routing** (index.html serve todas as rotas)
5. **Landing page** com gradientes modernos
6. **TypeScript** compilado automaticamente

## 🎵 Pronto para Produção!

Seu GDrums Studio está 100% pronto para deploy na Vercel! 🚀

Basta fazer o push para o GitHub e conectar na Vercel.
