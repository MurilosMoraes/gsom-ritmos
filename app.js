"use strict";
class RhythmSequencer {
    constructor() {
        this.intervalId = null;
        this.scheduleAheadTime = 0.1;
        this.nextStepTime = 0;
        this.audioContext = new AudioContext();
        const emptyPattern = () => [
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
        ];
        const emptyVolumes = () => [
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        ];
        const emptyChannels = () => [
            { buffer: null, fileName: '', midiPath: '' },
            { buffer: null, fileName: '', midiPath: '' },
            { buffer: null, fileName: '', midiPath: '' },
            { buffer: null, fileName: '', midiPath: '' },
            { buffer: null, fileName: '', midiPath: '' },
            { buffer: null, fileName: '', midiPath: '' },
            { buffer: null, fileName: '', midiPath: '' },
            { buffer: null, fileName: '', midiPath: '' },
        ];
        this.state = {
            isPlaying: false,
            currentStep: 0,
            tempo: 80,
            fillSpeed: 1, // Velocidade normal
            endSpeed: 1, // Velocidade normal
            fillSteps: 16, // Tamanho padrão da virada
            patterns: {
                main: emptyPattern(),
                fill: emptyPattern(),
                end: emptyPattern(),
            },
            volumes: {
                main: emptyVolumes(),
                fill: emptyVolumes(),
                end: emptyVolumes(),
            },
            activePattern: 'main',
            editingPattern: 'main',
            nextPattern: null,
            patternQueue: [], // Fila vazia inicialmente
            variations: {
                main: [{ pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels() }],
                fill: [{ pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels() }],
                end: [{ pattern: emptyPattern(), volumes: emptyVolumes(), channels: emptyChannels() }],
            },
            currentMainVariation: 0,
            currentFillVariation: 0,
            currentEndVariation: 0,
            fillStartSound: {
                buffer: null,
                fileName: '',
                midiPath: ''
            }, // Som de início do ritmo
            fillReturnSound: {
                buffer: null,
                fileName: '',
                midiPath: ''
            }, // Som de retorno do FILL
            shouldPlayStartSound: false, // Flag para tocar som de início
            shouldPlayReturnSound: false, // Não tocar no início até dar play
            channels: {
                main: emptyChannels(),
                fill: emptyChannels(),
                end: emptyChannels(),
            },
        };
        this.init();
    }
    generateChannelsHTML() {
        const sequencerContainer = document.getElementById('sequencer');
        sequencerContainer.innerHTML = '';
        for (let channel = 0; channel < 8; channel++) {
            const channelDiv = document.createElement('div');
            channelDiv.className = 'channel';
            const channelHeader = document.createElement('div');
            channelHeader.className = 'channel-header';
            channelHeader.innerHTML = `
        <div class="channel-controls">
          <label for="midiSelect${channel + 1}">Canal ${channel + 1}:</label>
          <select id="midiSelect${channel + 1}" class="midi-select">
            <option value="">Selecione um arquivo...</option>
          </select>
          <input type="file" id="customMidiInput${channel + 1}" accept="audio/*" class="file-input">
          <button class="btn btn-custom-midi" data-channel="${channel + 1}">
            <span class="icon">📁</span>
            <span>Arquivo Customizado</span>
          </button>
          <span id="customFileName${channel + 1}" class="custom-file-name"></span>
        </div>
      `;
            const track = document.createElement('div');
            track.className = 'track';
            track.setAttribute('data-channel', (channel + 1).toString());
            for (let step = 0; step < 16; step++) {
                const stepDiv = document.createElement('div');
                stepDiv.className = 'step';
                stepDiv.setAttribute('data-step', step.toString());
                // Adicionar indicador de volume
                const volumeIndicator = document.createElement('div');
                volumeIndicator.className = 'volume-indicator';
                stepDiv.appendChild(volumeIndicator);
                track.appendChild(stepDiv);
            }
            channelDiv.appendChild(channelHeader);
            channelDiv.appendChild(track);
            sequencerContainer.appendChild(channelDiv);
        }
    }
    init() {
        // Gerar HTML dos canais dinamicamente
        this.generateChannelsHTML();
        // Event listeners para os steps
        document.querySelectorAll('.step').forEach((step) => {
            // Clique esquerdo: toggle on/off
            step.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const channel = parseInt(target.closest('.track').getAttribute('data-channel')) - 1;
                const stepIndex = parseInt(target.getAttribute('data-step'));
                this.toggleStep(channel, stepIndex);
            });
            // Clique direito: ajustar volume
            step.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const target = e.currentTarget;
                const channel = parseInt(target.closest('.track').getAttribute('data-channel')) - 1;
                const stepIndex = parseInt(target.getAttribute('data-step'));
                this.showVolumeControl(channel, stepIndex, target);
            });
        });
        // Event listeners para os controles
        const playStopBtn = document.getElementById('playStop');
        playStopBtn.addEventListener('click', () => this.togglePlayStop());
        const fillBtn = document.getElementById('fill');
        fillBtn.addEventListener('click', () => this.triggerFill());
        const endBtn = document.getElementById('end');
        endBtn.addEventListener('click', () => this.triggerEnd());
        const tempoInput = document.getElementById('tempo');
        const tempoSlider = document.getElementById('tempoSlider');
        const tempoDisplay = document.getElementById('tempoDisplay');
        const updateTempo = (value) => {
            this.state.tempo = value;
            tempoInput.value = value.toString();
            tempoSlider.value = value.toString();
            tempoDisplay.textContent = value.toString();
        };
        tempoInput.addEventListener('input', (e) => {
            updateTempo(parseInt(e.target.value));
        });
        tempoSlider.addEventListener('input', (e) => {
            updateTempo(parseInt(e.target.value));
        });
        const tempoUpBtn = document.getElementById('tempoUp');
        tempoUpBtn.addEventListener('click', () => {
            const newTempo = Math.min(240, this.state.tempo + 1);
            updateTempo(newTempo);
        });
        const tempoDownBtn = document.getElementById('tempoDown');
        tempoDownBtn.addEventListener('click', () => {
            const newTempo = Math.max(40, this.state.tempo - 1);
            updateTempo(newTempo);
        });
        // Event listeners para controle de velocidade FILL
        const fillSpeedInput = document.getElementById('fillSpeed');
        const fillSpeedDisplay = document.getElementById('fillSpeedDisplay');
        const updateFillSpeed = (value) => {
            this.state.fillSpeed = value;
            fillSpeedInput.value = value.toString();
            fillSpeedDisplay.textContent = `${value}x`;
        };
        fillSpeedInput.addEventListener('input', (e) => {
            updateFillSpeed(parseFloat(e.target.value));
        });
        const fillSpeedUpBtn = document.getElementById('fillSpeedUp');
        fillSpeedUpBtn.addEventListener('click', () => {
            const newSpeed = Math.min(4, this.state.fillSpeed + 0.25);
            updateFillSpeed(newSpeed);
        });
        const fillSpeedDownBtn = document.getElementById('fillSpeedDown');
        fillSpeedDownBtn.addEventListener('click', () => {
            const newSpeed = Math.max(0.25, this.state.fillSpeed - 0.25);
            updateFillSpeed(newSpeed);
        });
        // Event listeners para controle de velocidade END
        const endSpeedInput = document.getElementById('endSpeed');
        const endSpeedDisplay = document.getElementById('endSpeedDisplay');
        const updateEndSpeed = (value) => {
            this.state.endSpeed = value;
            endSpeedInput.value = value.toString();
            endSpeedDisplay.textContent = `${value}x`;
        };
        endSpeedInput.addEventListener('input', (e) => {
            updateEndSpeed(parseFloat(e.target.value));
        });
        const endSpeedUpBtn = document.getElementById('endSpeedUp');
        endSpeedUpBtn.addEventListener('click', () => {
            const newSpeed = Math.min(4, this.state.endSpeed + 0.25);
            updateEndSpeed(newSpeed);
        });
        const endSpeedDownBtn = document.getElementById('endSpeedDown');
        endSpeedDownBtn.addEventListener('click', () => {
            const newSpeed = Math.max(0.25, this.state.endSpeed - 0.25);
            updateEndSpeed(newSpeed);
        });
        // Event listener para controle de tamanho da virada
        const fillStepsSelect = document.getElementById('fillSteps');
        fillStepsSelect.addEventListener('change', (e) => {
            const select = e.target;
            this.state.fillSteps = parseInt(select.value);
            console.log(`Tamanho da virada alterado para: ${this.state.fillSteps} steps`);
        });
        // Event listeners para som de início do ritmo
        const fillStartSelect = document.getElementById('fillStartSelect');
        fillStartSelect.addEventListener('change', (e) => this.handleFillStartSelect(e));
        const fillStartCustomBtn = document.getElementById('fillStartCustomBtn');
        const fillStartCustomInput = document.getElementById('fillStartCustomInput');
        fillStartCustomBtn.addEventListener('click', () => fillStartCustomInput.click());
        fillStartCustomInput.addEventListener('change', (e) => this.handleFillStartCustomUpload(e));
        // Event listeners para controle de som de retorno do FILL
        const fillReturnSelect = document.getElementById('fillReturnSelect');
        fillReturnSelect.addEventListener('change', (e) => this.handleFillReturnSelect(e));
        const fillReturnCustomBtn = document.getElementById('fillReturnCustomBtn');
        const fillReturnCustomInput = document.getElementById('fillReturnCustomInput');
        fillReturnCustomBtn.addEventListener('click', () => fillReturnCustomInput.click());
        fillReturnCustomInput.addEventListener('change', (e) => this.handleFillReturnCustomUpload(e));
        // Event listeners para upload de áudio
        for (let i = 1; i <= 8; i++) {
            const fileInput = document.getElementById(`audio${i}`);
            if (fileInput) {
                fileInput.addEventListener('change', (e) => this.handleFileUpload(e, i - 1));
            }
        }
        // Event listeners para salvar/carregar
        const saveBtn = document.getElementById('savePattern');
        saveBtn.addEventListener('click', () => this.savePattern());
        const loadBtn = document.getElementById('loadPattern');
        loadBtn.addEventListener('click', () => {
            document.getElementById('loadFile').click();
        });
        const loadFileInput = document.getElementById('loadFile');
        loadFileInput.addEventListener('change', (e) => this.loadPattern(e));
        const clearBtn = document.getElementById('clearPattern');
        clearBtn.addEventListener('click', () => this.clearPattern());
        // Event listeners para salvar/carregar projeto completo
        const saveAllBtn = document.getElementById('saveAll');
        saveAllBtn.addEventListener('click', () => this.saveProject());
        const loadAllBtn = document.getElementById('loadAll');
        loadAllBtn.addEventListener('click', () => {
            document.getElementById('loadAllFile').click();
        });
        const loadAllFileInput = document.getElementById('loadAllFile');
        loadAllFileInput.addEventListener('change', (e) => this.loadProject(e));
        // Event listeners para seletor de padrão
        const patternTabs = document.querySelectorAll('.pattern-tab');
        patternTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const patternType = target.getAttribute('data-pattern');
                this.switchEditingPattern(patternType);
            });
        });
        // Event listeners para selects de MIDI
        for (let i = 1; i <= 8; i++) {
            const midiSelect = document.getElementById(`midiSelect${i}`);
            if (midiSelect) {
                midiSelect.addEventListener('change', (e) => this.handleMidiSelect(e, i - 1));
            }
            // Event listeners para botões de arquivo customizado
            const customMidiBtn = document.querySelector(`.btn-custom-midi[data-channel="${i}"]`);
            const customMidiInput = document.getElementById(`customMidiInput${i}`);
            if (customMidiBtn && customMidiInput) {
                customMidiBtn.addEventListener('click', () => customMidiInput.click());
                customMidiInput.addEventListener('change', (e) => this.handleCustomMidiUpload(e, i - 1));
            }
        }
        // Event listeners para carregar ritmos salvos
        const loadRhythmBtn = document.getElementById('loadRhythm');
        loadRhythmBtn.addEventListener('click', () => this.loadSavedRhythm());
        const refreshRhythmsBtn = document.getElementById('refreshRhythms');
        refreshRhythmsBtn.addEventListener('click', () => this.loadAvailableRhythms());
        // Carregar listas de arquivos disponíveis
        this.loadAvailableMidi();
        this.loadAvailableRhythms();
        // ========== MODO USUÁRIO - Event Listeners ==========
        this.setupUserMode();
        // ========== Alternância de Modo ==========
        this.setupModeToggle();
        // ========== Controle de Variações ==========
        this.setupVariations();
    }
    setupUserMode() {
        // Controles de Reprodução do Usuário
        const playStopUserBtn = document.getElementById('playStopUser');
        if (playStopUserBtn) {
            playStopUserBtn.addEventListener('click', () => this.togglePlayStop());
        }
        const fillUserBtn = document.getElementById('fillUser');
        if (fillUserBtn) {
            fillUserBtn.addEventListener('click', () => this.triggerFill());
        }
        const endUserBtn = document.getElementById('endUser');
        if (endUserBtn) {
            endUserBtn.addEventListener('click', () => this.triggerEnd());
        }
        // Controle de Tempo do Usuário
        const tempoSliderUser = document.getElementById('tempoSliderUser');
        const tempoDisplayUser = document.getElementById('tempoDisplayUser');
        const tempoDownUser = document.getElementById('tempoDownUser');
        const tempoUpUser = document.getElementById('tempoUpUser');
        if (tempoSliderUser && tempoDisplayUser) {
            tempoSliderUser.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.state.tempo = value;
                tempoDisplayUser.textContent = value.toString();
                // Sincronizar com controles admin
                const tempoInput = document.getElementById('tempo');
                const tempoSlider = document.getElementById('tempoSlider');
                const tempoDisplay = document.getElementById('tempoDisplay');
                if (tempoInput)
                    tempoInput.value = value.toString();
                if (tempoSlider)
                    tempoSlider.value = value.toString();
                if (tempoDisplay)
                    tempoDisplay.textContent = value.toString();
            });
        }
        if (tempoDownUser) {
            tempoDownUser.addEventListener('click', () => {
                const newTempo = Math.max(40, this.state.tempo - 1);
                this.updateAllTempoDisplays(newTempo);
            });
        }
        if (tempoUpUser) {
            tempoUpUser.addEventListener('click', () => {
                const newTempo = Math.min(240, this.state.tempo + 1);
                this.updateAllTempoDisplays(newTempo);
            });
        }
        // Carregar Ritmo do Usuário
        const loadRhythmUserBtn = document.getElementById('loadRhythmUser');
        const rhythmSelectUser = document.getElementById('rhythmSelectUser');
        if (loadRhythmUserBtn && rhythmSelectUser) {
            loadRhythmUserBtn.addEventListener('click', () => {
                const filePath = rhythmSelectUser.value;
                if (filePath) {
                    this.loadSavedRhythmFromPath(filePath);
                }
                else {
                    alert('Selecione um ritmo primeiro');
                }
            });
        }
        // Sincronizar lista de ritmos do modo usuário com admin
        this.syncRhythmSelects();
        // Botões de Variação no Modo Usuário
        document.querySelectorAll('.variation-btn-user').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const element = e.currentTarget;
                const variationType = element.getAttribute('data-type');
                const variationIndex = parseInt(element.getAttribute('data-variation'));
                this.switchVariation(variationType, variationIndex);
            });
        });
        // Atualizar UI inicial dos botões de variação
        this.updateUserVariationButtons();
    }
    setupVariations() {
        // Event listeners para slots de variação
        document.querySelectorAll('.variation-slot').forEach((slot) => {
            slot.addEventListener('click', (e) => {
                const slotIndex = parseInt(e.currentTarget.getAttribute('data-slot'));
                this.selectVariationSlot(slotIndex);
            });
        });
        // Botão Salvar Variação
        const saveVariationBtn = document.getElementById('saveVariation');
        if (saveVariationBtn) {
            saveVariationBtn.addEventListener('click', () => this.saveCurrentVariation());
        }
        // Botão Carregar Variação
        const loadVariationBtn = document.getElementById('loadVariation');
        if (loadVariationBtn) {
            loadVariationBtn.addEventListener('click', () => this.loadSelectedVariation());
        }
        // Atualizar UI inicial
        this.updateVariationSlotsUI();
    }
    selectVariationSlot(slotIndex) {
        // Atualizar slot selecionado baseado no padrão atual
        const patternType = this.state.editingPattern;
        // Verificar limites
        const maxSlots = patternType === 'end' ? 2 : 3;
        if (slotIndex >= maxSlots) {
            alert(`O padrão ${patternType.toUpperCase()} permite apenas ${maxSlots} variações`);
            return;
        }
        // Atualizar índice da variação atual
        if (patternType === 'main') {
            this.state.currentMainVariation = slotIndex;
        }
        else if (patternType === 'fill') {
            this.state.currentFillVariation = slotIndex;
        }
        else if (patternType === 'end') {
            this.state.currentEndVariation = slotIndex;
        }
        // Atualizar UI
        this.updateVariationSlotsUI();
    }
    saveCurrentVariation() {
        const patternType = this.state.editingPattern;
        let slotIndex = 0;
        // Obter índice do slot atual
        if (patternType === 'main') {
            slotIndex = this.state.currentMainVariation;
        }
        else if (patternType === 'fill') {
            slotIndex = this.state.currentFillVariation;
        }
        else if (patternType === 'end') {
            slotIndex = this.state.currentEndVariation;
        }
        // Clonar padrão e canais atuais
        const patternClone = this.state.patterns[patternType].map(row => [...row]);
        const volumesClone = this.state.volumes[patternType].map(row => [...row]);
        const channelsClone = this.state.channels[patternType].map(ch => ({ ...ch }));
        // Salvar na variação
        this.state.variations[patternType][slotIndex] = {
            pattern: patternClone,
            volumes: volumesClone,
            channels: channelsClone
        };
        console.log(`Variação ${slotIndex + 1} de ${patternType.toUpperCase()} salva`);
        alert(`Variação ${slotIndex + 1} salva com sucesso!`);
        // Atualizar UI
        this.updateVariationSlotsUI();
        // Atualizar botões do usuário para todas as variações
        this.updateUserVariationButtons();
    }
    loadSelectedVariation() {
        const patternType = this.state.editingPattern;
        let slotIndex = 0;
        // Obter índice do slot atual
        if (patternType === 'main') {
            slotIndex = this.state.currentMainVariation;
        }
        else if (patternType === 'fill') {
            slotIndex = this.state.currentFillVariation;
        }
        else if (patternType === 'end') {
            slotIndex = this.state.currentEndVariation;
        }
        const variation = this.state.variations[patternType][slotIndex];
        if (!variation) {
            alert('Nenhuma variação salva neste slot');
            return;
        }
        // Carregar padrão e canais da variação
        this.state.patterns[patternType] = variation.pattern.map((row) => [...row]);
        this.state.volumes[patternType] = variation.volumes.map((row) => [...row]);
        this.state.channels[patternType] = variation.channels.map(ch => ({ ...ch }));
        console.log(`Variação ${slotIndex + 1} de ${patternType.toUpperCase()} carregada`);
        alert(`Variação ${slotIndex + 1} carregada com sucesso!`);
        // Atualizar UI do sequenciador
        this.updateSequencerUI();
    }
    updateVariationSlotsUI() {
        const patternType = this.state.editingPattern;
        let currentSlot = 0;
        const maxSlots = patternType === 'end' ? 2 : 3;
        // Obter índice do slot atual
        if (patternType === 'main') {
            currentSlot = this.state.currentMainVariation;
        }
        else if (patternType === 'fill') {
            currentSlot = this.state.currentFillVariation;
        }
        else if (patternType === 'end') {
            currentSlot = this.state.currentEndVariation;
        }
        // Atualizar botões de slots
        document.querySelectorAll('.variation-slot').forEach((slot, index) => {
            const slotElement = slot;
            // Remover classes
            slotElement.classList.remove('active', 'has-content');
            // Desabilitar slot 3 para padrão END
            if (patternType === 'end' && index === 2) {
                slotElement.style.opacity = '0.3';
                slotElement.style.pointerEvents = 'none';
            }
            else {
                slotElement.style.opacity = '1';
                slotElement.style.pointerEvents = 'auto';
            }
            // Marcar slot ativo
            if (index === currentSlot) {
                slotElement.classList.add('active');
            }
            // Marcar slots com conteúdo salvo
            const variation = this.state.variations[patternType][index];
            if (variation && variation.pattern) {
                // Verificar se tem algum pad ativo
                const hasContent = variation.pattern.some(row => row.some(step => step === true));
                if (hasContent) {
                    slotElement.classList.add('has-content');
                }
            }
        });
    }
    updateSequencerUI() {
        // Atualizar todos os steps visuais
        for (let channel = 0; channel < 8; channel++) {
            for (let step = 0; step < 16; step++) {
                this.updateStepVisual(channel, step);
            }
        }
    }
    switchVariation(patternType, variationIndex) {
        const variation = this.state.variations[patternType][variationIndex];
        if (!variation || !variation.pattern) {
            alert(`${patternType.toUpperCase()} ${variationIndex + 1} não está disponível. Configure no modo Admin primeiro.`);
            return;
        }
        // Verificar se tem conteúdo
        const hasContent = variation.pattern.some(row => row.some(step => step === true));
        if (!hasContent) {
            alert(`${patternType.toUpperCase()} ${variationIndex + 1} está vazio. Configure no modo Admin primeiro.`);
            return;
        }
        // Atualizar índice da variação atual
        if (patternType === 'main') {
            this.state.currentMainVariation = variationIndex;
        }
        else if (patternType === 'fill') {
            this.state.currentFillVariation = variationIndex;
        }
        else if (patternType === 'end') {
            this.state.currentEndVariation = variationIndex;
        }
        // Carregar padrão da variação
        this.state.patterns[patternType] = variation.pattern.map((row) => [...row]);
        this.state.volumes[patternType] = variation.volumes.map((row) => [...row]);
        this.state.channels[patternType] = variation.channels.map(ch => ({ ...ch }));
        console.log(`${patternType.toUpperCase()} variação ${variationIndex + 1} ativada`);
        // Atualizar UI
        this.updateUserVariationButtons();
        // Se estiver tocando e no padrão correspondente, aplicar a mudança
        if (this.state.isPlaying && this.state.activePattern === patternType) {
            console.log('Mudança será aplicada no próximo ciclo');
        }
    }
    updateUserVariationButtons() {
        document.querySelectorAll('.variation-btn-user').forEach((btn) => {
            const btnElement = btn;
            const patternType = btnElement.getAttribute('data-type');
            const variationIndex = parseInt(btnElement.getAttribute('data-variation'));
            const variation = this.state.variations[patternType][variationIndex];
            // Remover classe active
            btnElement.classList.remove('active');
            // Verificar se tem conteúdo
            if (variation && variation.pattern) {
                const hasContent = variation.pattern.some(row => row.some(step => step === true));
                if (hasContent) {
                    // Habilitar botão
                    btnElement.disabled = false;
                    btnElement.style.opacity = '1';
                    // Marcar como ativo baseado no tipo de padrão
                    let isActive = false;
                    if (patternType === 'main' && variationIndex === this.state.currentMainVariation) {
                        isActive = true;
                    }
                    else if (patternType === 'fill' && variationIndex === this.state.currentFillVariation) {
                        isActive = true;
                    }
                    else if (patternType === 'end' && variationIndex === this.state.currentEndVariation) {
                        isActive = true;
                    }
                    if (isActive) {
                        btnElement.classList.add('active');
                    }
                }
                else {
                    // Desabilitar botão vazio
                    btnElement.disabled = true;
                    btnElement.style.opacity = '0.3';
                }
            }
            else {
                // Desabilitar botão não configurado
                btnElement.disabled = true;
                btnElement.style.opacity = '0.3';
            }
        });
    }
    setupModeToggle() {
        const adminModeToggle = document.getElementById('adminModeToggle');
        const userMode = document.getElementById('userMode');
        const adminMode = document.getElementById('adminMode');
        const modeLabel = document.getElementById('modeLabel');
        const modeIcon = document.getElementById('modeIcon');
        if (adminModeToggle && userMode && adminMode && modeLabel && modeIcon) {
            adminModeToggle.addEventListener('change', (e) => {
                const isAdmin = e.target.checked;
                if (isAdmin) {
                    // Modo Admin
                    userMode.classList.remove('active');
                    adminMode.classList.add('active');
                    modeLabel.textContent = 'Modo Admin';
                    modeIcon.textContent = '⚙️';
                }
                else {
                    // Modo Usuário
                    adminMode.classList.remove('active');
                    userMode.classList.add('active');
                    modeLabel.textContent = 'Modo Usuário';
                    modeIcon.textContent = '👤';
                }
            });
        }
    }
    updateAllTempoDisplays(value) {
        this.state.tempo = value;
        // Admin
        const tempoInput = document.getElementById('tempo');
        const tempoSlider = document.getElementById('tempoSlider');
        const tempoDisplay = document.getElementById('tempoDisplay');
        if (tempoInput)
            tempoInput.value = value.toString();
        if (tempoSlider)
            tempoSlider.value = value.toString();
        if (tempoDisplay)
            tempoDisplay.textContent = value.toString();
        // User
        const tempoSliderUser = document.getElementById('tempoSliderUser');
        const tempoDisplayUser = document.getElementById('tempoDisplayUser');
        if (tempoSliderUser)
            tempoSliderUser.value = value.toString();
        if (tempoDisplayUser)
            tempoDisplayUser.textContent = value.toString();
    }
    syncRhythmSelects() {
        const rhythmSelect = document.getElementById('rhythmSelect');
        const rhythmSelectUser = document.getElementById('rhythmSelectUser');
        if (rhythmSelect && rhythmSelectUser) {
            // Copiar opções do admin para o usuário
            rhythmSelectUser.innerHTML = rhythmSelect.innerHTML;
        }
    }
    async loadSavedRhythmFromPath(filePath) {
        try {
            const response = await fetch(filePath);
            const text = await response.text();
            const data = JSON.parse(text);
            // Verificar se é um padrão individual ou projeto completo
            if (data.patterns) {
                // É um projeto completo
                await this.loadProjectFromData(data);
            }
            else if (data.pattern) {
                // É um padrão individual
                await this.loadPatternFromData(data);
            }
            else {
                throw new Error('Formato de arquivo não reconhecido');
            }
            console.log(`Ritmo carregado: ${filePath}`);
            alert(`Ritmo carregado com sucesso!`);
        }
        catch (error) {
            console.error('Erro ao carregar ritmo:', error);
            alert('Erro ao carregar ritmo salvo');
        }
    }
    switchEditingPattern(patternType) {
        // NÃO para a reprodução ao trocar de aba
        this.state.editingPattern = patternType;
        // Atualizar UI dos tabs
        document.querySelectorAll('.pattern-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        const activeTab = document.querySelector(`[data-pattern="${patternType}"]`);
        activeTab?.classList.add('active');
        // Atualizar visualização da grade
        this.refreshGridDisplay();
        // Atualizar nomes dos arquivos de áudio
        this.updateAudioFileNames();
        // Atualizar UI de variações
        this.updateVariationSlotsUI();
        console.log(`Editando padrão: ${patternType.toUpperCase()}`);
    }
    updateAudioFileNames() {
        const currentChannels = this.state.channels[this.state.editingPattern];
        for (let i = 0; i < 8; i++) {
            const fileNameSpan = document.getElementById(`customFileName${i + 1}`);
            if (fileNameSpan) {
                if (currentChannels[i].fileName) {
                    fileNameSpan.textContent = currentChannels[i].fileName;
                    fileNameSpan.style.color = '#667eea';
                    fileNameSpan.style.fontWeight = '600';
                }
                else {
                    fileNameSpan.textContent = '';
                    fileNameSpan.style.color = '';
                    fileNameSpan.style.fontWeight = '';
                }
            }
            // Restaurar a seleção do MIDI select para o padrão atual
            this.updateMidiSelectForChannel(i);
        }
    }
    updateMidiSelectForChannel(channel) {
        const currentChannels = this.state.channels[this.state.editingPattern];
        const midiSelect = document.getElementById(`midiSelect${channel + 1}`);
        if (midiSelect) {
            const midiPath = currentChannels[channel].midiPath || '';
            // Verificar se a opção existe no select antes de definir
            const optionExists = Array.from(midiSelect.options).some(option => option.value === midiPath);
            if (optionExists || midiPath === '') {
                midiSelect.value = midiPath;
            }
            else {
                // Se a opção não existe, adicionar automaticamente
                const option = document.createElement('option');
                option.value = midiPath;
                option.textContent = midiPath.split('/').pop() || midiPath;
                midiSelect.appendChild(option);
                midiSelect.value = midiPath;
            }
        }
    }
    refreshGridDisplay() {
        for (let channel = 0; channel < 8; channel++) {
            for (let step = 0; step < 16; step++) {
                this.updateStepVisual(channel, step);
            }
        }
    }
    toggleStep(channel, step) {
        const currentPattern = this.state.patterns[this.state.editingPattern];
        currentPattern[channel][step] = !currentPattern[channel][step];
        this.updateStepVisual(channel, step);
    }
    updateStepVisual(channel, step) {
        const tracks = document.querySelectorAll('.track');
        const track = tracks[channel];
        const stepElement = track.querySelector(`[data-step="${step}"]`);
        const currentPattern = this.state.patterns[this.state.editingPattern];
        const currentVolume = this.state.volumes[this.state.editingPattern][channel][step];
        if (currentPattern[channel][step]) {
            stepElement.classList.add('active');
            // Atualizar indicador de volume
            const volumeIndicator = stepElement.querySelector('.volume-indicator');
            if (volumeIndicator) {
                volumeIndicator.style.height = `${currentVolume * 100}%`;
                // Cor única e constante - apenas a altura muda
                volumeIndicator.style.background = '#FFD700';
                volumeIndicator.style.opacity = '1';
                volumeIndicator.style.boxShadow = '0 0 8px rgba(255, 215, 0, 0.9)';
            }
        }
        else {
            stepElement.classList.remove('active');
            const volumeIndicator = stepElement.querySelector('.volume-indicator');
            if (volumeIndicator) {
                volumeIndicator.style.height = '0%';
            }
        }
    }
    showVolumeControl(channel, step, element) {
        const currentPattern = this.state.patterns[this.state.editingPattern];
        // Só mostra controle se o pad estiver ativo
        if (!currentPattern[channel][step]) {
            return;
        }
        const currentVolume = this.state.volumes[this.state.editingPattern][channel][step];
        // Criar popup de controle de volume
        const existingPopup = document.querySelector('.volume-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        const popup = document.createElement('div');
        popup.className = 'volume-popup';
        popup.innerHTML = `
      <div class="volume-popup-content">
        <label>Volume: <span id="volumeValue">${Math.round(currentVolume * 100)}%</span></label>
        <input type="range" id="volumeSlider" min="0" max="100" value="${currentVolume * 100}" step="1">
        <div class="volume-presets">
          <button class="volume-preset" data-volume="0.2">Ghost</button>
          <button class="volume-preset" data-volume="0.5">Médio</button>
          <button class="volume-preset" data-volume="0.8">Forte</button>
          <button class="volume-preset" data-volume="1.0">Max</button>
        </div>
        <button class="volume-close">Fechar</button>
      </div>
    `;
        document.body.appendChild(popup);
        // Posicionar popup próximo ao elemento
        const rect = element.getBoundingClientRect();
        popup.style.left = `${rect.left + window.scrollX}px`;
        popup.style.top = `${rect.top + window.scrollY - 10}px`;
        // Event listeners do popup
        const slider = popup.querySelector('#volumeSlider');
        const valueDisplay = popup.querySelector('#volumeValue');
        slider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value) / 100;
            this.setStepVolume(channel, step, value);
            valueDisplay.textContent = `${Math.round(value * 100)}%`;
        });
        // Presets
        popup.querySelectorAll('.volume-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const volume = parseFloat(e.target.getAttribute('data-volume'));
                this.setStepVolume(channel, step, volume);
                slider.value = (volume * 100).toString();
                valueDisplay.textContent = `${Math.round(volume * 100)}%`;
            });
        });
        // Fechar
        const closeBtn = popup.querySelector('.volume-close');
        closeBtn.addEventListener('click', () => {
            popup.remove();
        });
        // Fechar ao clicar fora
        setTimeout(() => {
            document.addEventListener('click', function closePopup(e) {
                if (!popup.contains(e.target)) {
                    popup.remove();
                    document.removeEventListener('click', closePopup);
                }
            });
        }, 100);
    }
    setStepVolume(channel, step, volume) {
        this.state.volumes[this.state.editingPattern][channel][step] = Math.max(0, Math.min(1, volume));
        this.updateStepVisual(channel, step);
    }
    async handleFileUpload(event, channel) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file)
            return;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            const currentPattern = this.state.editingPattern;
            this.state.channels[currentPattern][channel].buffer = audioBuffer;
            this.state.channels[currentPattern][channel].fileName = file.name;
            // Limpar midiPath quando um arquivo é carregado manualmente
            this.state.channels[currentPattern][channel].midiPath = '';
            // Atualizar UI
            const fileNameSpan = document.querySelector(`[data-channel="${channel + 1}"].file-name`);
            fileNameSpan.textContent = file.name;
            fileNameSpan.style.color = '#667eea';
            fileNameSpan.style.fontWeight = '600';
            // Limpar select MIDI já que foi carregado um arquivo manual
            const midiSelect = document.getElementById(`midiSelect${channel + 1}`);
            if (midiSelect) {
                midiSelect.value = '';
            }
            console.log(`Áudio carregado no padrão ${currentPattern.toUpperCase()}, canal ${channel + 1}: ${file.name}`);
        }
        catch (error) {
            console.error('Erro ao carregar áudio:', error);
            alert('Erro ao carregar arquivo de áudio');
        }
    }
    // Método removido - não é mais usado
    togglePlayStop() {
        if (this.state.isPlaying) {
            this.stop();
        }
        else {
            this.play();
        }
    }
    play() {
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.state.isPlaying = true;
        this.state.nextPattern = null;
        this.state.activePattern = 'main';
        this.state.shouldPlayStartSound = true; // Marcar para tocar som de início
        this.nextStepTime = this.audioContext.currentTime;
        this.scheduler();
        // Atualizar UI Admin
        const playBtn = document.getElementById('playStop');
        playBtn.classList.add('playing');
        playBtn.innerHTML = '<span class="icon">⏸️</span><span>STOP</span>';
        document.getElementById('status').textContent = 'Tocando - MAIN';
        // Atualizar UI Usuário
        const playBtnUser = document.getElementById('playStopUser');
        const statusUser = document.getElementById('statusUser');
        if (playBtnUser) {
            playBtnUser.classList.add('playing');
            playBtnUser.innerHTML = '<span class="icon-large">⏸</span><span class="label">PARAR</span>';
        }
        if (statusUser) {
            statusUser.textContent = 'Tocando';
        }
    }
    stop() {
        this.state.isPlaying = false;
        this.state.currentStep = 0;
        this.state.activePattern = 'main';
        this.state.patternQueue = []; // Limpar fila
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }
        // Limpar botões de fill e end
        const fillBtn = document.getElementById('fill');
        fillBtn.classList.remove('playing');
        const endBtn = document.getElementById('end');
        endBtn.classList.remove('playing');
        // Atualizar UI Admin
        const playBtn = document.getElementById('playStop');
        playBtn.classList.remove('playing');
        playBtn.innerHTML = '<span class="icon">▶️</span><span>PLAY</span>';
        document.getElementById('status').textContent = 'Parado';
        this.updateCurrentStepVisual();
        // Atualizar UI Usuário
        const playBtnUser = document.getElementById('playStopUser');
        const statusUser = document.getElementById('statusUser');
        if (playBtnUser) {
            playBtnUser.classList.remove('playing');
            playBtnUser.innerHTML = '<span class="icon-large">▶</span><span class="label">PLAY</span>';
        }
        if (statusUser) {
            statusUser.textContent = 'Parado';
        }
        console.log('Sequencer parado - fila limpa');
    }
    scheduler() {
        while (this.nextStepTime < this.audioContext.currentTime + this.scheduleAheadTime) {
            this.scheduleStep(this.state.currentStep, this.nextStepTime);
            this.nextStep();
        }
        if (this.state.isPlaying) {
            this.intervalId = window.setTimeout(() => this.scheduler(), 25);
        }
    }
    scheduleStep(step, time) {
        // Usar o padrão ativo atual
        const activePatternType = this.state.activePattern;
        const activePattern = this.state.patterns[activePatternType];
        const activeChannels = this.state.channels[activePatternType];
        // Tocar som de início se for o step 0 e a flag estiver ativada
        if (step === 0 && this.state.shouldPlayStartSound && this.state.fillStartSound.buffer) {
            const source = this.audioContext.createBufferSource();
            source.buffer = this.state.fillStartSound.buffer;
            source.connect(this.audioContext.destination);
            source.start(time);
            console.log('Som de início tocado no step 0');
        }
        // Tocar som de retorno se for o step 0 e a flag estiver ativada
        if (step === 0 && this.state.shouldPlayReturnSound && this.state.fillReturnSound.buffer) {
            const source = this.audioContext.createBufferSource();
            source.buffer = this.state.fillReturnSound.buffer;
            source.connect(this.audioContext.destination);
            source.start(time);
            console.log('Som de retorno tocado no step 0');
        }
        // Tocar sons dos canais ativos neste step
        const activeVolumes = this.state.volumes[activePatternType];
        for (let channel = 0; channel < 8; channel++) {
            if (activePattern[channel][step]) {
                // Agendar reprodução
                if (activeChannels[channel].buffer) {
                    const source = this.audioContext.createBufferSource();
                    source.buffer = activeChannels[channel].buffer;
                    // Criar gainNode para controle de volume
                    const gainNode = this.audioContext.createGain();
                    gainNode.gain.value = activeVolumes[channel][step];
                    source.connect(gainNode);
                    gainNode.connect(this.audioContext.destination);
                    source.start(time);
                }
            }
        }
        // Atualizar UI (agendado para o momento certo)
        const delay = (time - this.audioContext.currentTime) * 1000;
        setTimeout(() => {
            this.updateCurrentStepVisual();
        }, delay);
    }
    nextStep() {
        const secondsPerBeat = 60.0 / this.state.tempo;
        // Aplicar velocidade diferente baseado no padrão ativo
        let speedMultiplier = 1;
        if (this.state.activePattern === 'fill') {
            speedMultiplier = this.state.fillSpeed;
        }
        else if (this.state.activePattern === 'end') {
            speedMultiplier = this.state.endSpeed;
        }
        const secondsPerStep = (secondsPerBeat / 2) / speedMultiplier; // 16th notes com multiplicador
        this.nextStepTime += secondsPerStep;
        this.state.currentStep++;
        // Determinar o número de steps do padrão ativo
        let maxSteps = 16; // Padrão para MAIN e END
        if (this.state.activePattern === 'fill') {
            maxSteps = this.state.fillSteps; // Usar o tamanho configurado da virada
        }
        // Verificar fim do padrão
        if (this.state.currentStep >= maxSteps) {
            this.state.currentStep = 0;
            // Verificar comportamento pós-padrão ANTES de fazer a transição
            const wasEndPattern = this.state.activePattern === 'end';
            const wasFillPattern = this.state.activePattern === 'fill';
            // Verificar comportamento pós-padrão baseado no que ACABOU de tocar
            if (wasFillPattern) {
                // Depois do fill, remover classe playing
                console.log('Padrão FILL completado');
                const fillBtn = document.getElementById('fill');
                fillBtn.classList.remove('playing');
                // Sincronizar com botão do usuário
                const fillBtnUser = document.getElementById('fillUser');
                if (fillBtnUser) {
                    fillBtnUser.classList.remove('playing');
                }
                // Ativar flag para tocar som de retorno no próximo step 0
                this.state.shouldPlayReturnSound = true;
                this.state.shouldPlayStartSound = false; // Desativar som de início
                // Processar próximo da fila ou voltar para main
                if (this.state.patternQueue.length > 0) {
                    const nextPattern = this.state.patternQueue.shift();
                    this.state.activePattern = nextPattern;
                    console.log(`Próximo padrão da fila: ${nextPattern.toUpperCase()}`);
                    this.updateQueueDisplay();
                    // Atualizar botão
                    if (nextPattern === 'end') {
                        const endBtn = document.getElementById('end');
                        endBtn.classList.add('playing');
                    }
                }
                else {
                    this.state.activePattern = 'main';
                    console.log('Fila vazia - voltando para MAIN');
                }
                // Atualizar UI
                const statusText = `Tocando - ${this.state.activePattern.toUpperCase()}`;
                document.getElementById('status').textContent = statusText;
            }
            else if (wasEndPattern) {
                // Depois do end, parar
                console.log('Padrão END completado - parando reprodução');
                const endBtn = document.getElementById('end');
                endBtn.classList.remove('playing');
                // Sincronizar com botão do usuário
                const endBtnUser = document.getElementById('endUser');
                if (endBtnUser) {
                    endBtnUser.classList.remove('playing');
                }
                this.stop();
                return;
            }
            else if (this.state.activePattern === 'main') {
                // Desativar flags de som quando completa um ciclo do MAIN
                this.state.shouldPlayStartSound = false;
                this.state.shouldPlayReturnSound = false;
                // Se estamos em main e há algo na fila, processar
                if (this.state.patternQueue.length > 0) {
                    const nextPattern = this.state.patternQueue.shift();
                    this.state.activePattern = nextPattern;
                    console.log(`Iniciando padrão da fila: ${nextPattern.toUpperCase()}`);
                    this.updateQueueDisplay();
                    // Atualizar UI
                    const statusText = `Tocando - ${nextPattern.toUpperCase()}`;
                    document.getElementById('status').textContent = statusText;
                }
            }
        }
    }
    updateCurrentStepVisual() {
        // Remover highlight anterior
        document.querySelectorAll('.step.current').forEach((el) => {
            el.classList.remove('current');
        });
        // Adicionar highlight ao step atual
        if (this.state.isPlaying) {
            document.querySelectorAll(`.step[data-step="${this.state.currentStep}"]`).forEach((el) => {
                el.classList.add('current');
            });
        }
        // Atualizar indicador de posição Admin
        document.getElementById('currentStep').textContent = this.state.currentStep.toString();
        // Atualizar indicador de posição Usuário
        const currentStepUser = document.getElementById('currentStepUser');
        if (currentStepUser) {
            currentStepUser.textContent = this.state.currentStep.toString();
        }
    }
    triggerFill() {
        if (!this.state.isPlaying)
            return;
        // Adicionar fill à fila
        this.state.patternQueue.push('fill');
        const fillBtn = document.getElementById('fill');
        fillBtn.classList.add('playing');
        // Sincronizar botão do usuário
        const fillBtnUser = document.getElementById('fillUser');
        if (fillBtnUser) {
            fillBtnUser.classList.add('playing');
        }
        // Atualizar display da fila
        this.updateQueueDisplay();
        console.log('Fill adicionado à fila. Fila atual:', this.state.patternQueue);
    }
    triggerEnd() {
        if (!this.state.isPlaying)
            return;
        // Adicionar end à fila
        this.state.patternQueue.push('end');
        const endBtn = document.getElementById('end');
        endBtn.classList.add('playing');
        // Sincronizar botão do usuário
        const endBtnUser = document.getElementById('endUser');
        if (endBtnUser) {
            endBtnUser.classList.add('playing');
        }
        // Atualizar display da fila
        this.updateQueueDisplay();
        console.log('End adicionado à fila. Fila atual:', this.state.patternQueue);
    }
    updateQueueDisplay() {
        // Mostrar fila no console (pode adicionar um display visual depois)
        const queueText = this.state.patternQueue.length > 0
            ? this.state.patternQueue.map(p => p.toUpperCase()).join(' → ')
            : 'Vazia';
        console.log(`Fila: ${queueText}`);
    }
    async savePattern() {
        const patternType = this.state.editingPattern;
        const patternName = patternType.toUpperCase();
        // Converter áudios para base64
        const audioFiles = [];
        const currentChannels = this.state.channels[patternType];
        for (let i = 0; i < currentChannels.length; i++) {
            if (currentChannels[i].fileName && currentChannels[i].buffer) {
                let arrayBuffer = null;
                // Tentar buscar do input de arquivo manual
                const fileInput = document.getElementById(`audio${i + 1}`);
                const file = fileInput?.files?.[0];
                if (file) {
                    arrayBuffer = await file.arrayBuffer();
                }
                else if (currentChannels[i].midiPath) {
                    // Se não há arquivo no input, mas há midiPath, buscar do servidor
                    try {
                        const response = await fetch(currentChannels[i].midiPath);
                        arrayBuffer = await response.arrayBuffer();
                    }
                    catch (error) {
                        console.error(`Erro ao buscar MIDI ${currentChannels[i].midiPath}:`, error);
                    }
                }
                if (arrayBuffer) {
                    const base64 = this.arrayBufferToBase64(arrayBuffer);
                    audioFiles.push({
                        fileName: currentChannels[i].fileName,
                        audioData: base64,
                        midiPath: currentChannels[i].midiPath || '', // Salvar o caminho do MIDI
                    });
                }
            }
        }
        const savedData = {
            version: '1.1',
            type: patternType,
            tempo: this.state.tempo,
            pattern: this.state.patterns[patternType],
            volumes: this.state.volumes[patternType],
            audioFiles: audioFiles,
            timestamp: new Date().toISOString(),
            name: `${patternName} Pattern`,
        };
        const jsonString = JSON.stringify(savedData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rhythm-${patternType}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`Padrão ${patternName} salvo com ${audioFiles.length} arquivos de áudio!`);
        alert(`Padrão ${patternName} salvo com sucesso!\nArquivos de áudio incluídos: ${audioFiles.length}`);
    }
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
    normalizeMidiPath(path) {
        if (!path)
            return '';
        // Remover ./ redundante do caminho
        return path.replace(/\/\.\//g, '/');
    }
    expandPattern(pattern) {
        // Se o padrão já tem 8 canais, retornar como está
        if (pattern.length === 8) {
            // Verificar se precisa expandir os steps de 8 para 16
            return pattern.map(channel => {
                if (channel.length === 16) {
                    return channel;
                }
                else if (channel.length === 8) {
                    // Expandir de 8 steps para 16 steps (completar com false)
                    return [...channel, false, false, false, false, false, false, false, false];
                }
                return channel;
            });
        }
        // Se tem 3 canais, expandir para 8 canais
        if (pattern.length === 3) {
            const expanded = [];
            for (let i = 0; i < 8; i++) {
                if (i < 3) {
                    // Usar os 3 primeiros canais do padrão antigo
                    const channel = pattern[i];
                    if (channel.length === 16) {
                        expanded.push(channel);
                    }
                    else if (channel.length === 8) {
                        // Expandir de 8 steps para 16 steps
                        expanded.push([...channel, false, false, false, false, false, false, false, false]);
                    }
                    else {
                        expanded.push(channel);
                    }
                }
                else {
                    // Canais 4-8 vazios
                    expanded.push([false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]);
                }
            }
            return expanded;
        }
        // Retornar como está se não for 3 nem 8
        return pattern;
    }
    expandVolumes(volumes) {
        // Se já tem 8 canais, retornar como está
        if (volumes.length === 8) {
            // Verificar se precisa expandir os steps de 8 para 16
            return volumes.map(channel => {
                if (channel.length === 16) {
                    return channel;
                }
                else if (channel.length === 8) {
                    // Expandir de 8 steps para 16 steps (completar com 1.0)
                    return [...channel, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
                }
                return channel;
            });
        }
        // Se tem 3 canais, expandir para 8 canais
        if (volumes.length === 3) {
            const expanded = [];
            for (let i = 0; i < 8; i++) {
                if (i < 3) {
                    // Usar os 3 primeiros canais do padrão antigo
                    const channel = volumes[i];
                    if (channel.length === 16) {
                        expanded.push(channel);
                    }
                    else if (channel.length === 8) {
                        // Expandir de 8 steps para 16 steps
                        expanded.push([...channel, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
                    }
                    else {
                        expanded.push(channel);
                    }
                }
                else {
                    // Canais 4-8 com volume padrão 1.0
                    expanded.push([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
                }
            }
            return expanded;
        }
        // Retornar como está se não for 3 nem 8
        return volumes;
    }
    async loadPattern(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file)
            return;
        try {
            const text = await file.text();
            const savedData = JSON.parse(text);
            // Validar estrutura
            if (!savedData.pattern || !Array.isArray(savedData.pattern)) {
                throw new Error('Arquivo JSON inválido');
            }
            // Parar reprodução se estiver tocando
            if (this.state.isPlaying) {
                this.stop();
            }
            // Determinar qual padrão carregar
            const targetPattern = savedData.type || this.state.editingPattern;
            // Carregar padrão no tipo correto (expandir de 3 canais/8 steps para 8 canais/16 steps se necessário)
            this.state.patterns[targetPattern] = this.expandPattern(savedData.pattern);
            this.state.tempo = savedData.tempo || 80;
            // Carregar arquivos de áudio se existirem
            if (savedData.audioFiles && savedData.audioFiles.length > 0) {
                for (let i = 0; i < savedData.audioFiles.length && i < 8; i++) {
                    const audioFile = savedData.audioFiles[i];
                    const arrayBuffer = this.base64ToArrayBuffer(audioFile.audioData);
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                    this.state.channels[targetPattern][i].buffer = audioBuffer;
                    this.state.channels[targetPattern][i].fileName = audioFile.fileName;
                    // Normalizar o caminho do MIDI (remover ./ redundante)
                    const midiPath = audioFile.midiPath || '';
                    this.state.channels[targetPattern][i].midiPath = this.normalizeMidiPath(midiPath);
                }
                console.log(`${savedData.audioFiles.length} arquivos de áudio carregados!`);
            }
            // Mudar para o padrão carregado
            this.switchEditingPattern(targetPattern);
            // Atualizar UI do tempo
            const tempoInput = document.getElementById('tempo');
            const tempoSlider = document.getElementById('tempoSlider');
            const tempoDisplay = document.getElementById('tempoDisplay');
            tempoInput.value = this.state.tempo.toString();
            tempoSlider.value = this.state.tempo.toString();
            tempoDisplay.textContent = this.state.tempo.toString();
            // Atualizar visualização dos steps
            this.refreshGridDisplay();
            // Limpar input para permitir carregar o mesmo arquivo novamente
            input.value = '';
            const audioCount = savedData.audioFiles?.length || 0;
            console.log(`Padrão ${targetPattern.toUpperCase()} carregado com sucesso!`);
            alert(`Padrão ${targetPattern.toUpperCase()} carregado!\nTipo: ${savedData.name || targetPattern}\nTempo: ${this.state.tempo} BPM\nÁudios incluídos: ${audioCount}`);
        }
        catch (error) {
            console.error('Erro ao carregar padrão:', error);
            alert('Erro ao carregar arquivo. Verifique se é um arquivo JSON válido.');
            input.value = '';
        }
    }
    clearPattern() {
        const patternName = this.state.editingPattern.toUpperCase();
        const confirm = window.confirm(`Tem certeza que deseja limpar o padrão ${patternName}?`);
        if (!confirm)
            return;
        // Parar reprodução se estiver tocando
        if (this.state.isPlaying) {
            this.stop();
        }
        // Limpar padrão atual
        this.state.patterns[this.state.editingPattern] = [
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
            [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
        ];
        // Atualizar visualização
        this.refreshGridDisplay();
        console.log(`Padrão ${patternName} limpo!`);
    }
    async saveProject() {
        // Converter áudios de todos os padrões para base64
        const audioFiles = {
            main: [],
            fill: [],
            end: [],
        };
        const patterns = ['main', 'fill', 'end'];
        for (const patternType of patterns) {
            const currentChannels = this.state.channels[patternType];
            for (let i = 0; i < currentChannels.length; i++) {
                if (currentChannels[i].fileName && currentChannels[i].buffer) {
                    let arrayBuffer = null;
                    // Tentar buscar do input de arquivo manual
                    const fileInput = document.getElementById(`audio${i + 1}`);
                    const file = fileInput?.files?.[0];
                    if (file) {
                        arrayBuffer = await file.arrayBuffer();
                    }
                    else if (currentChannels[i].midiPath) {
                        // Se não há arquivo no input, mas há midiPath, buscar do servidor
                        try {
                            const response = await fetch(currentChannels[i].midiPath);
                            arrayBuffer = await response.arrayBuffer();
                        }
                        catch (error) {
                            console.error(`Erro ao buscar MIDI ${currentChannels[i].midiPath}:`, error);
                        }
                    }
                    if (arrayBuffer) {
                        const base64 = this.arrayBufferToBase64(arrayBuffer);
                        audioFiles[patternType].push({
                            fileName: currentChannels[i].fileName,
                            audioData: base64,
                            midiPath: currentChannels[i].midiPath || '', // Salvar o caminho do MIDI
                        });
                    }
                }
            }
        }
        const projectData = {
            version: '1.1',
            tempo: this.state.tempo,
            patterns: {
                main: this.state.patterns.main,
                fill: this.state.patterns.fill,
                end: this.state.patterns.end,
            },
            volumes: {
                main: this.state.volumes.main,
                fill: this.state.volumes.fill,
                end: this.state.volumes.end,
            },
            audioFiles: audioFiles,
            timestamp: new Date().toISOString(),
            name: 'Complete Rhythm Project',
        };
        const jsonString = JSON.stringify(projectData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rhythm-project-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const totalAudio = audioFiles.main.length + audioFiles.fill.length + audioFiles.end.length;
        console.log(`Projeto completo salvo (MAIN + FILL + END) com ${totalAudio} arquivos de áudio!`);
        alert(`Projeto salvo com sucesso!\nInclui todos os 3 padrões (MAIN, FILL, END)\nArquivos de áudio: ${totalAudio}`);
    }
    async loadProject(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file)
            return;
        try {
            const text = await file.text();
            const projectData = JSON.parse(text);
            // Validar estrutura
            if (!projectData.patterns) {
                throw new Error('Arquivo de projeto inválido');
            }
            // Parar reprodução se estiver tocando
            if (this.state.isPlaying) {
                this.stop();
            }
            // Carregar todos os padrões (expandir de 3 canais/8 steps para 8 canais/16 steps se necessário)
            if (projectData.patterns.main) {
                this.state.patterns.main = this.expandPattern(projectData.patterns.main);
            }
            if (projectData.patterns.fill) {
                this.state.patterns.fill = this.expandPattern(projectData.patterns.fill);
            }
            if (projectData.patterns.end) {
                this.state.patterns.end = this.expandPattern(projectData.patterns.end);
            }
            // Carregar volumes (se disponível, senão usar padrão 1.0)
            if (projectData.volumes) {
                if (projectData.volumes.main) {
                    this.state.volumes.main = this.expandVolumes(projectData.volumes.main);
                }
                if (projectData.volumes.fill) {
                    this.state.volumes.fill = this.expandVolumes(projectData.volumes.fill);
                }
                if (projectData.volumes.end) {
                    this.state.volumes.end = this.expandVolumes(projectData.volumes.end);
                }
            }
            this.state.tempo = projectData.tempo || 80;
            // Carregar arquivos de áudio de todos os padrões
            let totalAudio = 0;
            if (projectData.audioFiles) {
                const patterns = ['main', 'fill', 'end'];
                for (const patternType of patterns) {
                    const audioFiles = projectData.audioFiles[patternType];
                    if (audioFiles && audioFiles.length > 0) {
                        for (let i = 0; i < audioFiles.length && i < 8; i++) {
                            const audioFile = audioFiles[i];
                            const arrayBuffer = this.base64ToArrayBuffer(audioFile.audioData);
                            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                            this.state.channels[patternType][i].buffer = audioBuffer;
                            this.state.channels[patternType][i].fileName = audioFile.fileName;
                            // Normalizar o caminho do MIDI (remover ./ redundante)
                            const midiPath = audioFile.midiPath || '';
                            this.state.channels[patternType][i].midiPath = this.normalizeMidiPath(midiPath);
                            totalAudio++;
                        }
                    }
                }
                console.log(`${totalAudio} arquivos de áudio carregados no total!`);
            }
            // Atualizar UI do tempo
            const tempoInput = document.getElementById('tempo');
            const tempoSlider = document.getElementById('tempoSlider');
            const tempoDisplay = document.getElementById('tempoDisplay');
            tempoInput.value = this.state.tempo.toString();
            tempoSlider.value = this.state.tempo.toString();
            tempoDisplay.textContent = this.state.tempo.toString();
            // Atualizar visualização
            this.refreshGridDisplay();
            // Limpar input
            input.value = '';
            console.log('Projeto completo carregado!');
            console.log('Padrões carregados: MAIN, FILL, END');
            alert(`Projeto carregado com sucesso!\nTempo: ${this.state.tempo} BPM\n\nTodos os 3 padrões foram carregados.\nArquivos de áudio: ${totalAudio}`);
        }
        catch (error) {
            console.error('Erro ao carregar projeto:', error);
            alert('Erro ao carregar projeto. Verifique se é um arquivo JSON válido.');
            input.value = '';
        }
    }
    async loadAvailableMidi() {
        try {
            // Lista fixa de arquivos MIDI disponíveis (para funcionar na web hospedada)
            const allMidiFiles = [
                'bumbo.wav',
                'caixa.wav',
                'chimbal_fechado.wav',
                'chimbal_aberto.wav',
                'prato.mp3',
                'surdo.wav',
                'tom_1.wav',
                'tom_2.wav'
            ];
            // Verificar quais arquivos existem
            const midiFiles = [];
            for (const file of allMidiFiles) {
                try {
                    const testResponse = await fetch(`assets/midi/${file}`, { method: 'HEAD' });
                    if (testResponse.ok) {
                        midiFiles.push(file);
                    }
                }
                catch (e) {
                    // Arquivo não existe, ignorar
                }
            }
            // Preencher os selects dos canais
            for (let i = 1; i <= 8; i++) {
                const select = document.getElementById(`midiSelect${i}`);
                if (select) {
                    select.innerHTML = '<option value="">Selecione MIDI...</option>';
                    midiFiles.forEach(file => {
                        const option = document.createElement('option');
                        // Normalizar o caminho ao criar a opção (remover ./ se existir)
                        const normalizedPath = this.normalizeMidiPath(`assets/midi/${file}`);
                        option.value = normalizedPath;
                        option.textContent = file.replace(/^\.\//, ''); // Remover ./ do texto também
                        select.appendChild(option);
                    });
                }
            }
            // Preencher select de som de início
            const fillStartSelect = document.getElementById('fillStartSelect');
            if (fillStartSelect) {
                fillStartSelect.innerHTML = '<option value="">Nenhum</option>';
                midiFiles.forEach(file => {
                    const option = document.createElement('option');
                    const normalizedPath = this.normalizeMidiPath(`assets/midi/${file}`);
                    option.value = normalizedPath;
                    option.textContent = file.replace(/^\.\//, '');
                    fillStartSelect.appendChild(option);
                });
            }
            // Preencher select de som de retorno
            const fillReturnSelect = document.getElementById('fillReturnSelect');
            if (fillReturnSelect) {
                fillReturnSelect.innerHTML = '<option value="">Nenhum</option>';
                midiFiles.forEach(file => {
                    const option = document.createElement('option');
                    const normalizedPath = this.normalizeMidiPath(`assets/midi/${file}`);
                    option.value = normalizedPath;
                    option.textContent = file.replace(/^\.\//, '');
                    fillReturnSelect.appendChild(option);
                });
            }
            console.log(`${midiFiles.length} arquivos MIDI encontrados`);
        }
        catch (error) {
            console.log('Não foi possível listar arquivos MIDI automaticamente');
            // Se falhar, adicionar opções manualmente ou manter vazio
        }
    }
    async loadAvailableRhythms() {
        try {
            // Lista fixa de ritmos disponíveis (para funcionar na web hospedada)
            const rhythmFiles = [
                'pop.json',
                'pop-complete.json'
            ];
            const select = document.getElementById('rhythmSelect');
            select.innerHTML = '<option value="">Selecione um ritmo...</option>';
            // Verificar quais arquivos existem
            for (const file of rhythmFiles) {
                try {
                    const testResponse = await fetch(`assets/rhythm/${file}`, { method: 'HEAD' });
                    if (testResponse.ok) {
                        const option = document.createElement('option');
                        option.value = `assets/rhythm/${file}`;
                        option.textContent = file.replace('.json', '');
                        select.appendChild(option);
                    }
                }
                catch (e) {
                    // Arquivo não existe, ignorar
                    console.log(`Ritmo ${file} não encontrado`);
                }
            }
            console.log('Ritmos carregados');
            // Sincronizar com o select do modo usuário
            this.syncRhythmSelects();
        }
        catch (error) {
            console.log('Não foi possível listar ritmos automaticamente');
        }
    }
    async handleMidiSelect(event, channel) {
        const select = event.target;
        const filePath = select.value;
        if (!filePath)
            return;
        try {
            const response = await fetch(filePath);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            const currentPattern = this.state.editingPattern;
            this.state.channels[currentPattern][channel].buffer = audioBuffer;
            this.state.channels[currentPattern][channel].fileName = filePath.split('/').pop() || filePath;
            // Salvar o caminho do MIDI selecionado para este padrão
            this.state.channels[currentPattern][channel].midiPath = filePath;
            // Atualizar UI
            const fileNameSpan = document.getElementById(`customFileName${channel + 1}`);
            if (fileNameSpan) {
                fileNameSpan.textContent = this.state.channels[currentPattern][channel].fileName;
                fileNameSpan.style.color = '#667eea';
                fileNameSpan.style.fontWeight = '600';
            }
            console.log(`MIDI carregado no padrão ${currentPattern.toUpperCase()}, canal ${channel + 1}: ${filePath}`);
        }
        catch (error) {
            console.error('Erro ao carregar MIDI:', error);
            alert('Erro ao carregar arquivo MIDI');
            select.value = '';
        }
    }
    async handleCustomMidiUpload(event, channel) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file)
            return;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            const currentPattern = this.state.editingPattern;
            this.state.channels[currentPattern][channel].buffer = audioBuffer;
            this.state.channels[currentPattern][channel].fileName = file.name;
            this.state.channels[currentPattern][channel].midiPath = ''; // Arquivo customizado não tem path
            // Atualizar UI
            const fileNameSpan = document.getElementById(`customFileName${channel + 1}`);
            if (fileNameSpan) {
                fileNameSpan.textContent = file.name;
                fileNameSpan.style.color = '#667eea';
                fileNameSpan.style.fontWeight = '600';
            }
            // Limpar seleção do select MIDI
            const midiSelect = document.getElementById(`midiSelect${channel + 1}`);
            if (midiSelect) {
                midiSelect.value = '';
            }
            console.log(`Arquivo customizado carregado no padrão ${currentPattern.toUpperCase()}, canal ${channel + 1}: ${file.name}`);
        }
        catch (error) {
            console.error('Erro ao carregar arquivo customizado:', error);
            alert('Erro ao carregar arquivo de áudio. Verifique se é um formato válido (WAV, MP3, OGG)');
        }
        // Limpar input
        input.value = '';
    }
    async handleFillStartSelect(event) {
        const select = event.target;
        const filePath = select.value;
        if (!filePath) {
            // Limpar som de início
            this.state.fillStartSound.buffer = null;
            this.state.fillStartSound.fileName = '';
            this.state.fillStartSound.midiPath = '';
            const fileNameSpan = document.getElementById('fillStartFileName');
            if (fileNameSpan) {
                fileNameSpan.textContent = '';
            }
            console.log('Som de início removido');
            return;
        }
        try {
            const response = await fetch(filePath);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.state.fillStartSound.buffer = audioBuffer;
            this.state.fillStartSound.fileName = filePath.split('/').pop() || filePath;
            this.state.fillStartSound.midiPath = filePath;
            // Atualizar UI
            const fileNameSpan = document.getElementById('fillStartFileName');
            if (fileNameSpan) {
                fileNameSpan.textContent = this.state.fillStartSound.fileName;
                fileNameSpan.style.color = '#667eea';
                fileNameSpan.style.fontWeight = '600';
            }
            console.log(`Som de início carregado: ${filePath}`);
        }
        catch (error) {
            console.error('Erro ao carregar som de início:', error);
            alert('Erro ao carregar arquivo MIDI de início');
            select.value = '';
        }
    }
    async handleFillStartCustomUpload(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file)
            return;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.state.fillStartSound.buffer = audioBuffer;
            this.state.fillStartSound.fileName = file.name;
            this.state.fillStartSound.midiPath = ''; // Arquivo customizado não tem path
            // Atualizar UI
            const fileNameSpan = document.getElementById('fillStartFileName');
            if (fileNameSpan) {
                fileNameSpan.textContent = file.name;
                fileNameSpan.style.color = '#667eea';
                fileNameSpan.style.fontWeight = '600';
            }
            // Limpar seleção do select
            const fillStartSelect = document.getElementById('fillStartSelect');
            if (fillStartSelect) {
                fillStartSelect.value = '';
            }
            console.log(`Som de início customizado carregado: ${file.name}`);
        }
        catch (error) {
            console.error('Erro ao carregar som de início customizado:', error);
            alert('Erro ao carregar arquivo de áudio. Verifique se é um formato válido (WAV, MP3, OGG)');
        }
        // Limpar input
        input.value = '';
    }
    async handleFillReturnSelect(event) {
        const select = event.target;
        const filePath = select.value;
        if (!filePath) {
            // Limpar som de retorno
            this.state.fillReturnSound.buffer = null;
            this.state.fillReturnSound.fileName = '';
            this.state.fillReturnSound.midiPath = '';
            const fileNameSpan = document.getElementById('fillReturnFileName');
            if (fileNameSpan) {
                fileNameSpan.textContent = '';
            }
            console.log('Som de retorno do FILL removido');
            return;
        }
        try {
            const response = await fetch(filePath);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.state.fillReturnSound.buffer = audioBuffer;
            this.state.fillReturnSound.fileName = filePath.split('/').pop() || filePath;
            this.state.fillReturnSound.midiPath = filePath;
            // Atualizar UI
            const fileNameSpan = document.getElementById('fillReturnFileName');
            if (fileNameSpan) {
                fileNameSpan.textContent = this.state.fillReturnSound.fileName;
                fileNameSpan.style.color = '#667eea';
                fileNameSpan.style.fontWeight = '600';
            }
            console.log(`Som de retorno do FILL carregado: ${filePath}`);
        }
        catch (error) {
            console.error('Erro ao carregar som de retorno:', error);
            alert('Erro ao carregar arquivo MIDI de retorno');
            select.value = '';
        }
    }
    async handleFillReturnCustomUpload(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file)
            return;
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.state.fillReturnSound.buffer = audioBuffer;
            this.state.fillReturnSound.fileName = file.name;
            this.state.fillReturnSound.midiPath = ''; // Arquivo customizado não tem path
            // Atualizar UI
            const fileNameSpan = document.getElementById('fillReturnFileName');
            if (fileNameSpan) {
                fileNameSpan.textContent = file.name;
                fileNameSpan.style.color = '#667eea';
                fileNameSpan.style.fontWeight = '600';
            }
            // Limpar seleção do select
            const fillReturnSelect = document.getElementById('fillReturnSelect');
            if (fillReturnSelect) {
                fillReturnSelect.value = '';
            }
            console.log(`Som de retorno customizado carregado: ${file.name}`);
        }
        catch (error) {
            console.error('Erro ao carregar som de retorno customizado:', error);
            alert('Erro ao carregar arquivo de áudio. Verifique se é um formato válido (WAV, MP3, OGG)');
        }
        // Limpar input
        input.value = '';
    }
    async loadSavedRhythm() {
        const select = document.getElementById('rhythmSelect');
        const filePath = select.value;
        if (!filePath) {
            alert('Selecione um ritmo primeiro');
            return;
        }
        try {
            const response = await fetch(filePath);
            const text = await response.text();
            const data = JSON.parse(text);
            // Verificar se é um padrão individual ou projeto completo
            if (data.patterns) {
                // É um projeto completo
                await this.loadProjectFromData(data);
            }
            else if (data.pattern) {
                // É um padrão individual
                await this.loadPatternFromData(data);
            }
            else {
                throw new Error('Formato de arquivo não reconhecido');
            }
            console.log(`Ritmo carregado: ${filePath}`);
            alert(`Ritmo carregado com sucesso!`);
        }
        catch (error) {
            console.error('Erro ao carregar ritmo:', error);
            alert('Erro ao carregar ritmo salvo');
        }
    }
    async loadPatternFromData(savedData) {
        const targetPattern = savedData.type || this.state.editingPattern;
        // Expandir padrão de 3 canais/8 steps para 8 canais/16 steps se necessário
        this.state.patterns[targetPattern] = this.expandPattern(savedData.pattern);
        // Carregar volumes (se disponível, senão manter padrão 1.0)
        if (savedData.volumes) {
            this.state.volumes[targetPattern] = this.expandVolumes(savedData.volumes);
        }
        this.state.tempo = savedData.tempo || 80;
        if (savedData.audioFiles && savedData.audioFiles.length > 0) {
            for (let i = 0; i < savedData.audioFiles.length && i < 8; i++) {
                const audioFile = savedData.audioFiles[i];
                const arrayBuffer = this.base64ToArrayBuffer(audioFile.audioData);
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.state.channels[targetPattern][i].buffer = audioBuffer;
                this.state.channels[targetPattern][i].fileName = audioFile.fileName;
                // Normalizar o caminho do MIDI (remover ./ redundante)
                const midiPath = audioFile.midiPath || '';
                this.state.channels[targetPattern][i].midiPath = this.normalizeMidiPath(midiPath);
            }
        }
        this.switchEditingPattern(targetPattern);
        this.updateTempo(this.state.tempo);
        this.refreshGridDisplay();
        // Atualizar selects MIDI após carregar
        for (let i = 0; i < 8; i++) {
            this.updateMidiSelectForChannel(i);
        }
    }
    async loadProjectFromData(projectData) {
        // Expandir padrões de 3 canais/8 steps para 8 canais/16 steps se necessário
        if (projectData.patterns.main) {
            this.state.patterns.main = this.expandPattern(projectData.patterns.main);
        }
        if (projectData.patterns.fill) {
            this.state.patterns.fill = this.expandPattern(projectData.patterns.fill);
        }
        if (projectData.patterns.end) {
            this.state.patterns.end = this.expandPattern(projectData.patterns.end);
        }
        // Carregar volumes (se disponível, senão usar padrão 1.0)
        if (projectData.volumes) {
            if (projectData.volumes.main) {
                this.state.volumes.main = this.expandVolumes(projectData.volumes.main);
            }
            if (projectData.volumes.fill) {
                this.state.volumes.fill = this.expandVolumes(projectData.volumes.fill);
            }
            if (projectData.volumes.end) {
                this.state.volumes.end = this.expandVolumes(projectData.volumes.end);
            }
        }
        this.state.tempo = projectData.tempo || 80;
        if (projectData.audioFiles) {
            const patterns = ['main', 'fill', 'end'];
            for (const patternType of patterns) {
                const audioFiles = projectData.audioFiles[patternType];
                if (audioFiles && audioFiles.length > 0) {
                    for (let i = 0; i < audioFiles.length && i < 8; i++) {
                        const audioFile = audioFiles[i];
                        const arrayBuffer = this.base64ToArrayBuffer(audioFile.audioData);
                        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                        this.state.channels[patternType][i].buffer = audioBuffer;
                        this.state.channels[patternType][i].fileName = audioFile.fileName;
                        // Normalizar o caminho do MIDI (remover ./ redundante)
                        const midiPath = audioFile.midiPath || '';
                        this.state.channels[patternType][i].midiPath = this.normalizeMidiPath(midiPath);
                    }
                }
            }
        }
        this.updateTempo(this.state.tempo);
        this.refreshGridDisplay();
        // Atualizar selects MIDI após carregar o projeto
        for (let i = 0; i < 8; i++) {
            this.updateMidiSelectForChannel(i);
        }
    }
    updateTempo(value) {
        this.state.tempo = value;
        const tempoInput = document.getElementById('tempo');
        const tempoSlider = document.getElementById('tempoSlider');
        const tempoDisplay = document.getElementById('tempoDisplay');
        tempoInput.value = value.toString();
        tempoSlider.value = value.toString();
        tempoDisplay.textContent = value.toString();
    }
}
// Inicializar o sequenciador quando a página carregar
window.addEventListener('DOMContentLoaded', () => {
    new RhythmSequencer();
    console.log('Sequenciador de Ritmos iniciado!');
    console.log('1. Importe arquivos de áudio nos 3 canais');
    console.log('2. Clique nos steps para criar seu padrão');
    console.log('3. Pressione PLAY para começar');
});
