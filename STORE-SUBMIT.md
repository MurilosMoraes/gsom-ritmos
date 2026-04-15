# GDrums — Guia de Submissão Play Store

Documento completo com tudo que precisa ser feito pra publicar o app no Google Play Store.
Mantenha atualizado a cada release.

---

## 📋 Pré-requisitos

- [x] Conta Play Console paga ($25 one-time) — **OK**
- [x] Android Studio instalado — **OK**
- [x] SQL `delete_my_account` aplicado no Supabase — **OK**
- [x] Email de suporte: `staner@gdrums.com.br`
- [x] Política de privacidade pública: `https://gdrums.com.br/privacy`
- [x] Termos de uso públicos: `https://gdrums.com.br/terms`
- [x] Bundle ID padronizado: `com.gdrums.app`
- [x] Permissions limpas no AndroidManifest
- [x] Compliance reader app (esconder pagamento no nativo)
- [x] Account deletion in-app

**Falta:**
- [ ] Gerar keystore de release (ver §1)
- [ ] Build do AAB assinado (ver §2)
- [ ] Criar app no Play Console (ver §3)
- [ ] Upload e configuração (ver §4)

---

## 1. Gerar Keystore de Release

**Faça apenas UMA vez.** Se perder essa keystore, nunca mais conseguirá publicar updates desse app — você teria que mudar bundle ID e perder todos os usuários.

```bash
cd ~/Documents
keytool -genkey -v \
  -keystore gdrums-release.keystore \
  -alias gdrums \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Vai pedir:
- **Senha do keystore**: anota e guarda no 1Password/Bitwarden
- **Senha da chave**: pode ser igual à do keystore (mais simples)
- Nome, organização, cidade, estado, país (BR)

**⚠️ AÇÕES CRÍTICAS:**
1. Faz backup do `gdrums-release.keystore` em pelo menos 2 lugares (Drive + 1Password attachment)
2. Anota as senhas em local seguro
3. **NUNCA** commita o `.keystore` no git — adicionar `*.keystore` no `.gitignore` se ainda não tiver

---

## 2. Build do AAB Assinado

Antes do build, sincroniza o Capacitor:

```bash
cd /Users/murilosilvamoraes/Desktop/Projetos/gdrums/gsom-ritmos
npm run build:mobile
npx cap sync android
```

Abrir Android Studio:

```bash
npx cap open android
```

No Android Studio:

1. **Build → Clean Project** (garante build limpo)
2. **Build → Generate Signed Bundle / APK**
3. Escolher **Android App Bundle** (AAB, não APK)
4. Selecionar keystore: `~/Documents/gdrums-release.keystore`
5. Senha do keystore + alias `gdrums` + senha da chave
6. **release** build variant
7. Build types: `release`
8. Aguardar build (1-3 min)
9. Output: `android/app/release/app-release.aab`

---

## 3. Criar App no Play Console

Acesse https://play.google.com/console e clica em **Criar app**:

### Detalhes do app

| Campo | Valor |
|---|---|
| Nome do app | `GDrums` |
| Idioma padrão | `Português (Brasil)` |
| App ou jogo | `App` |
| Gratuito ou pago | `Gratuito` |

Marca as 3 declarações obrigatórias (programas de desenvolvedor, políticas, leis EUA).

### Configuração do app (lado esquerdo, "Configurar app")

#### Acesso ao app

- **Existe acesso restrito ou todo acesso é gratuito?**
  - Selecionar: **"Todas as funções estão disponíveis sem restrições especiais"**
  - Justificativa: oferece trial 48h sem login + cadastro grátis. Para revisar funções pagas, fornecer credenciais de teste:
    ```
    Email: staner@gdrums.com.br
    Senha: [criar conta de teste premium pro Google]
    ```

#### Anúncios

- **Seu app contém anúncios?** → **Não**

#### Classificação de conteúdo

- Rodar questionário. Categoria **Música**. Sem violência, sem nudez, sem álcool, sem nada.
- Resultado esperado: **Livre / L** (todas as idades)

#### Público-alvo

- **Público-alvo**: Adultos (18+) — porque tem cobrança via cartão. Pode marcar 13+ se quiser ampliar.
- App não atrai crianças intencionalmente

#### Notícias

- **App é de notícias?** → **Não**

#### Aplicativos COVID-19

- **Não**

#### Segurança dos dados (Data Safety)

⚠️ **Crítico — passo demorado.** Ver `STORE-DATA-SAFETY.md` (também na raiz do repo).

#### Categoria do app, contato e tags

| Campo | Valor |
|---|---|
| Categoria | `Música e áudio` |
| Tag (opcional) | Música |
| Email | `staner@gdrums.com.br` |
| Telefone (opcional) | `+55 51 999-XXXX` |
| Site | `https://gdrums.com.br` |

#### Política de Privacidade

URL: `https://gdrums.com.br/privacy`

---

## 4. Página da loja (Store Listing)

### Detalhes do app

| Campo | Texto |
|---|---|
| Nome | `GDrums` |
| Descrição curta (80 chars) | Veja `STORE-LISTING.md` |
| Descrição completa (4000 chars) | Veja `STORE-LISTING.md` |

### Recursos gráficos

| Recurso | Tamanho | Origem |
|---|---|---|
| Ícone do app | 512×512 PNG | `public/img/icon.png` (redimensiona pra 512) |
| Imagem em destaque | 1024×500 PNG | Você cria — sugestão: logo grande + tagline |
| Capturas de tela telefone | mínimo 2, máximo 8 | Tira no device real (rodando o app) |
| Capturas tablet 7" (opcional) | — | Pode pular se não tiver tablet |
| Capturas tablet 10" (opcional) | — | Pode pular |
| Vídeo promocional (opcional) | YouTube URL | Pode pular pra v1 |

**Como tirar screenshots boas:**
1. Abrir o app no Android (com pedal conectado se possível)
2. Tirar prints das telas: login, app principal, repertório, ritmo selecionado tocando, modal Minha Conta
3. Resolução: 1080×1920 ou similar (Android padrão)
4. Selecionar 4-6 melhores

---

## 5. Upload do AAB

1. Menu lateral → **Versões → Testes → Internos**
2. **Criar nova versão**
3. Upload do `app-release.aab`
4. Notas da versão: "Primeira versão pública. Acompanhamento profissional ao vivo, pedal Bluetooth, 72+ ritmos."
5. **Salvar** → **Revisar versão** → **Iniciar lançamento para teste interno**

Aguardar Play processar (~10-30 min).

Adicionar testers: **Internos → Testers → Adicionar email**. Adiciona seu email + 2-3 amigos pra testar.

Cada tester recebe link **opt-in**. Após aceitar, app aparece no Play Store dele em ~1h.

**Testar exaustivamente antes de promover pra produção:**
- [ ] Cadastro funciona
- [ ] Login funciona
- [ ] Toca ritmos
- [ ] Pedal Bluetooth conecta e funciona
- [ ] Trial expirado → mostra tela "Seu teste acabou" com botão pro site
- [ ] Botão "Excluir minha conta" funciona
- [ ] Áudio em background funciona

## 6. Promover pra Production

Quando teste interno OK:

1. **Versões → Produção → Criar nova versão**
2. **Promover do teste interno** (ou re-upload do AAB)
3. **Países**: Brasil (depois pode expandir)
4. **Notas da versão** (em PT-BR):
   ```
   GDrums chegou! 🎵
   Sua banda completa no celular. Acompanhamento profissional ao vivo
   com mais de 70 ritmos, pedal Bluetooth e modo offline.
   ```
5. **Salvar → Revisar → Iniciar lançamento**

Google revisa em **1-7 dias úteis**.

---

## 7. Após aprovação

- Configurar **Reply to reviews** no Play Console (responder reviews ajuda nota)
- Ativar **Pre-launch report** (Google testa em devices reais e aponta crashes)
- Configurar **Crash & ANR reports** alerts no email
- Acompanhar **Vitals** (performance metrics)

---

## 🔄 Workflow pra próximas versões (updates)

1. Editar código
2. Bumpar versão em `android/app/build.gradle`:
   ```gradle
   versionCode 2  // sempre +1
   versionName "1.1"
   ```
3. `npm run build:mobile && npx cap sync android`
4. Build → Generate Signed Bundle (mesma keystore!)
5. Upload no Play Console como **nova versão**
6. Notas da versão (changelog)
7. Roll out (pode escolher % gradual: 5% → 25% → 100%)

---

## ⚠️ O que NÃO fazer

- Mudar `applicationId` depois de publicado — Google trata como app novo
- Perder a keystore — fim do app
- Esquecer de bumpar `versionCode` — upload bloqueia
- Mostrar preço/checkout dentro do app nativo — rejeição certa
- Coletar dados sensíveis sem declarar no Data Safety
- Subir build debug/unsigned

---

## 📞 Suporte técnico Play Console

- Email: googleplay-developer-support@google.com
- Help: https://support.google.com/googleplay/android-developer
