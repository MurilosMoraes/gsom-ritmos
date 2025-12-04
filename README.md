# Sequenciador de Ritmos MIDI

Um sequenciador de ritmos interativo para web com 3 canais e 8 steps.

## Recursos

- **3 Canais de Áudio**: Importe seus próprios samples de áudio
- **Grade 8x3**: 8 steps por canal para criar padrões rítmicos
- **Controles Principais**:
  - **PLAY/STOP**: Inicia e para a reprodução
  - **FILL**: Toca até o fim da sequência atual
  - **END**: Para no fim da sequência atual
- **Controle de BPM**: Ajuste o tempo de 40 a 240 BPM
- **Web Audio API**: Reprodução precisa e sincronizada

## Como Usar

### 1. Instalação

```bash
cd rhythm-sequencer
npm install
```

### 2. Compilar TypeScript

```bash
npm run build
```

### 3. Executar

```bash
npm run dev
```

Ou abra o arquivo `index.html` diretamente no navegador.

## Instruções de Uso

1. **Importar Áudio**: Clique em "Importar Áudio" em cada canal para carregar samples (WAV, MP3, etc.)
2. **Criar Padrão**: Clique nos steps da grade para ativar/desativar beats
3. **Ajustar BPM**: Modifique o tempo usando o controle de BPM
4. **Tocar**: Pressione PLAY para iniciar a reprodução
5. **Fill**: Durante a reprodução, pressione FILL para tocar até o fim
6. **End**: Durante a reprodução, pressione END para parar no fim da sequência

## Tecnologias

- HTML5
- CSS3 (Grid, Flexbox, Animations)
- TypeScript
- Web Audio API

## Desenvolvimento

Para desenvolvimento com recompilação automática:

```bash
npm run watch
```

Em outro terminal:

```bash
npm run dev
```
