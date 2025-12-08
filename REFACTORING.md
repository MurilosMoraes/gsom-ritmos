# Plano de Refatoração e Componentização

## Situação Atual

### Arquivos
- **app.ts**: 3110 linhas - código monolítico
- **app.js**: 122KB - gerado automaticamente (deve ser ignorado no git)
- **index.html**: 360 linhas
- **styles.css**: 1589 linhas

### Problemas Identificados
1. ❌ **app.js está versionado** - deveria ser ignorado (.gitignore)
2. ❌ **app.ts monolítico** - 3110 linhas em um único arquivo
3. ❌ **Baixa manutenibilidade** - difícil encontrar e modificar funcionalidades
4. ❌ **Sem separação de responsabilidades** - UI, lógica e dados misturados

## Estrutura Proposta

```
rhythm-sequencer/
├── src/
│   ├── types/
│   │   └── index.ts              # ✅ CRIADO - Interfaces e tipos
│   ├── utils/
│   │   └── helpers.ts             # ✅ CRIADO - Funções auxiliares
│   ├── core/
│   │   ├── AudioManager.ts        # ✅ CRIADO - Gerenciamento de áudio
│   │   ├── StateManager.ts        # ⏳ Gerenciamento de estado
│   │   ├── PatternEngine.ts       # ⏳ Lógica de padrões
│   │   └── Scheduler.ts           # ⏳ Scheduling de steps
│   ├── ui/
│   │   ├── AdminMode.ts           # ⏳ Interface admin
│   │   ├── UserMode.ts            # ⏳ Interface usuário
│   │   ├── GridEditor.ts          # ⏳ Editor de grade
│   │   └── ControlPanel.ts        # ⏳ Controles (play, tempo, etc)
│   ├── io/
│   │   ├── FileManager.ts         # ⏳ Salvar/carregar projetos
│   │   └── MIDILoader.ts          # ⏳ Carregar arquivos MIDI
│   └── main.ts                    # ⏳ Entry point principal
├── assets/
│   ├── midi/                      # Arquivos de áudio
│   └── rhythm/                    # Ritmos salvos
├── index.html
├── styles.css
├── tsconfig.json
├── package.json
└── .gitignore                     # ✅ ATUALIZADO
```

## Fases de Refatoração

### Fase 1: Preparação ✅
- [x] Criar estrutura de diretórios
- [x] Criar tipos e interfaces
- [x] Criar funções auxiliares
- [x] Atualizar .gitignore
- [x] Documentar arquitetura

### Fase 2: Core Modules ⏳
**AudioManager.ts** - Gerenciamento de áudio
```typescript
- loadAudioFromFile()
- loadAudioFromPath()
- playSound()
- scheduleStep()
```

**StateManager.ts** - Estado da aplicação
```typescript
- Centralizar SequencerState
- Métodos para atualizar estado
- Observers para mudanças de estado
```

**PatternEngine.ts** - Lógica de padrões
```typescript
- Gerenciamento de variações
- Entrada sincronizada de fills/ends
- Rotação de padrões
```

**Scheduler.ts** - Scheduling preciso
```typescript
- nextStep()
- scheduleAheadTime
- Controle de velocidade (fillSpeed, endSpeed)
```

### Fase 3: UI Modules ⏳
**AdminMode.ts**
```typescript
- Grid editor
- Variação slots
- Pattern tabs
- MIDI selector
```

**UserMode.ts**
```typescript
- Performance grid 3x3
- Rhythm selector
- Quick controls
```

**GridEditor.ts**
```typescript
- toggleStep()
- updateStepVisual()
- showVolumeControl()
- Pattern steps selector
```

**ControlPanel.ts**
```typescript
- Play/Stop
- Tempo controls
- Fill/End triggers
```

### Fase 4: I/O Modules ⏳
**FileManager.ts**
```typescript
- saveProject()
- loadProject()
- savePattern()
- loadPattern()
```

**MIDILoader.ts**
```typescript
- loadAvailableMidi()
- handleMidiSelect()
- handleCustomMidiUpload()
```

### Fase 5: Integration ⏳
- Criar main.ts como entry point
- Conectar todos os módulos
- Testar funcionalidades
- Atualizar index.html para usar main.js

## Priorização

### Alta Prioridade (Fazer primeiro)
1. **StateManager** - Centralizar estado
2. **AudioManager** - Isolar lógica de áudio
3. **Scheduler** - Separar scheduling

### Média Prioridade
4. **PatternEngine** - Lógica de padrões
5. **FileManager** - I/O de projetos

### Baixa Prioridade
6. **UI Modules** - Refatorar UI

## Benefícios Esperados

### Manutenibilidade
- ✅ Código organizado por responsabilidade
- ✅ Fácil localizar funcionalidades
- ✅ Módulos independentes e testáveis

### Escalabilidade
- ✅ Fácil adicionar novos pattern types
- ✅ Plugins e extensões
- ✅ Testes unitários possíveis

### Performance
- ✅ Import apenas do necessário
- ✅ Code splitting possível
- ✅ Tree shaking otimizado

### Desenvolvimento
- ✅ Múltiplos desenvolvedores
- ✅ Menos conflitos de merge
- ✅ Reuso de código

## Decisões de Arquitetura

### ✅ Manter app.js ignorado
```
.gitignore:
app.js          # Gerado automaticamente
app.js.map      # Source map
*.js.map        # Todos os source maps
```

### ⚠️ Migração Gradual
- Manter app.ts funcionando
- Migrar funcionalidades gradualmente
- Testar cada módulo isoladamente
- Substituir app.ts apenas quando todos módulos estiverem prontos

### 🔄 Build Process
```json
{
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "dev": "npx http-server . -p 8080 -o",
    "clean": "rm -f app.js app.js.map"
  }
}
```

## Próximos Passos Recomendados

1. **Extrair StateManager** (1-2h)
   - Mover SequencerState para módulo
   - Criar getters/setters
   - Implementar observers

2. **Extrair AudioManager** (2-3h)
   - Mover lógica de áudio
   - Consolidar playSound
   - Simplificar scheduleStep

3. **Extrair Scheduler** (2-3h)
   - Mover nextStep()
   - Isolar timing logic
   - Melhorar precisão

4. **Refatorar UI** (4-6h)
   - Separar AdminMode
   - Separar UserMode
   - Componentizar controles

5. **Consolidar I/O** (2-3h)
   - FileManager para projetos
   - MIDILoader para samples

Total estimado: **12-18 horas** de refatoração

## Notas Importantes

⚠️ **NÃO deletar app.ts ainda** - mantê-lo até migração completa
⚠️ **Testar cada módulo** - garantir funcionamento
⚠️ **Commitar frequentemente** - pequenos commits funcionais
✅ **app.js NÃO deve ser editado** - sempre recompilar do TypeScript
