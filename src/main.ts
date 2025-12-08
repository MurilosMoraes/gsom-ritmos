// Entry point principal - GSOM Rhythm Sequencer

import { StateManager } from './core/StateManager';
import { AudioManager } from './core/AudioManager';
import { Scheduler } from './core/Scheduler';
import { PatternEngine } from './core/PatternEngine';
import { FileManager } from './io/FileManager';
import { UIManager } from './ui/UIManager';
import type { PatternType } from './types';

class RhythmSequencer {
  private audioContext: AudioContext;
  private stateManager: StateManager;
  private audioManager: AudioManager;
  private scheduler: Scheduler;
  private patternEngine: PatternEngine;
  private fileManager: FileManager;
  private uiManager: UIManager;

  constructor() {
    // Inicializar contexto de áudio
    this.audioContext = new AudioContext();

    // Inicializar gerenciadores
    this.stateManager = new StateManager();
    this.audioManager = new AudioManager(this.audioContext);
    this.patternEngine = new PatternEngine(this.stateManager);
    this.scheduler = new Scheduler(this.stateManager, this.audioManager, this.patternEngine);
    this.fileManager = new FileManager(this.stateManager, this.audioManager);
    this.uiManager = new UIManager(this.stateManager);

    // Configurar callbacks
    this.setupCallbacks();

    // Inicializar UI
    this.init();
  }

  private setupCallbacks(): void {
    // Scheduler -> UI
    this.scheduler.setUpdateStepCallback(() => {
      this.uiManager.updateCurrentStepVisual();
    });

    // PatternEngine -> UI
    this.patternEngine.setOnPatternChange((pattern: PatternType) => {
      this.uiManager.updateStatusUI(pattern);
      this.uiManager.updatePerformanceGrid();
      this.uiManager.clearQueuedCells();
    });

    this.patternEngine.setOnStop(() => {
      this.stop();
    });

    // StateManager -> UI observers
    this.stateManager.subscribe('playState', (state) => {
      this.uiManager.updatePlayStopUI(state.isPlaying);
    });

    this.stateManager.subscribe('tempo', (state) => {
      this.uiManager.updateTempoUI(state.tempo);
    });

    this.stateManager.subscribe('patterns', () => {
      this.uiManager.refreshGridDisplay();
    });

    this.stateManager.subscribe('variations', () => {
      this.uiManager.updateVariationButtons();
      this.uiManager.updatePerformanceGrid();
    });
  }

  private init(): void {
    this.generateChannelsHTML();
    this.setupEventListeners();
    this.loadAvailableMidi();
    this.loadAvailableRhythms();
  }

  private generateChannelsHTML(): void {
    const sequencerContainer = document.getElementById('sequencer');
    if (!sequencerContainer) return;

    sequencerContainer.innerHTML = '';

    for (let channel = 0; channel < 8; channel++) {
      const channelDiv = document.createElement('div');
      channelDiv.className = 'channel';

      channelDiv.innerHTML = `
        <div class="channel-header">
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
        </div>
      `;

      const track = document.createElement('div');
      track.className = 'track';
      track.setAttribute('data-channel', (channel + 1).toString());

      for (let step = 0; step < 16; step++) {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'step';
        stepDiv.setAttribute('data-step', step.toString());

        const volumeIndicator = document.createElement('div');
        volumeIndicator.className = 'volume-indicator';
        stepDiv.appendChild(volumeIndicator);

        stepDiv.addEventListener('click', () => {
          this.toggleStep(channel, step);
        });

        stepDiv.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showVolumeControl(channel, step, stepDiv);
        });

        track.appendChild(stepDiv);
      }

      channelDiv.appendChild(track);
      sequencerContainer.appendChild(channelDiv);
    }
  }

  private setupEventListeners(): void {
    // Play/Stop
    const playStopBtn = document.getElementById('playStop');
    if (playStopBtn) {
      playStopBtn.addEventListener('click', () => this.togglePlayStop());
    }

    const playStopUserBtn = document.getElementById('playStopUser');
    if (playStopUserBtn) {
      playStopUserBtn.addEventListener('click', () => this.togglePlayStop());
    }

    // Admin mode fill and end buttons
    const fillBtn = document.getElementById('fill');
    if (fillBtn) {
      fillBtn.addEventListener('click', () => {
        if (this.stateManager.isPlaying()) {
          this.patternEngine.playRotatingFill();
        }
      });
    }

    const endBtn = document.getElementById('end');
    if (endBtn) {
      endBtn.addEventListener('click', () => {
        if (this.stateManager.isPlaying()) {
          this.patternEngine.playEndAndStop();
        }
      });
    }

    // Tempo controls
    this.setupTempoControls();

    // Volume controls
    this.setupVolumeControls();

    // Keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Pattern tabs
    document.querySelectorAll('.pattern-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const patternType = target.getAttribute('data-pattern') as PatternType;
        this.switchEditingPattern(patternType);
      });
    });

    // Performance grid
    this.setupPerformanceGrid();

    // File operations
    this.setupFileOperations();

    // Mode toggle
    this.setupModeToggle();

    // MIDI selectors
    this.setupMIDISelectors();

    // Variations
    this.setupVariations();

    // User mode
    this.setupUserMode();
  }

  private setupUserMode(): void {
    // Botão carregar ritmo do usuário
    const loadRhythmUserBtn = document.getElementById('loadRhythmUser');
    const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;

    if (loadRhythmUserBtn && rhythmSelectUser) {
      loadRhythmUserBtn.addEventListener('click', () => {
        const filePath = rhythmSelectUser.value;
        if (filePath) {
          this.loadRhythmFromPath(filePath);
        } else {
          this.uiManager.showAlert('Selecione um ritmo primeiro');
        }
      });
    }

    // Sincronizar lista de ritmos do modo usuário com admin
    this.syncRhythmSelects();

    // Botões de Variação no Modo Usuário
    document.querySelectorAll('.variation-btn-user').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const element = e.currentTarget as HTMLElement;
        const variationType = element.getAttribute('data-type') as PatternType;
        const variationIndex = parseInt(element.getAttribute('data-variation')!);
        this.switchVariation(variationType, variationIndex);
      });
    });

    // Atualizar UI inicial dos botões de variação
    this.uiManager.updateVariationButtons();
  }

  private setupTempoControls(): void {
    // Controles do modo usuário
    const tempoUpUser = document.getElementById('tempoUpUser');
    const tempoDownUser = document.getElementById('tempoDownUser');

    if (tempoUpUser) {
      tempoUpUser.addEventListener('click', () => {
        const newTempo = Math.min(240, this.stateManager.getTempo() + 1);
        this.stateManager.setTempo(newTempo);
      });
    }

    if (tempoDownUser) {
      tempoDownUser.addEventListener('click', () => {
        const newTempo = Math.max(40, this.stateManager.getTempo() - 1);
        this.stateManager.setTempo(newTempo);
      });
    }

    // Controles do modo admin
    const tempoInput = document.getElementById('tempo') as HTMLInputElement;
    const tempoSlider = document.getElementById('tempoSlider') as HTMLInputElement;
    const tempoUp = document.getElementById('tempoUp');
    const tempoDown = document.getElementById('tempoDown');

    const updateTempo = (value: number) => {
      const newTempo = Math.max(40, Math.min(240, value));
      this.stateManager.setTempo(newTempo);
    };

    if (tempoInput) {
      tempoInput.addEventListener('change', (e) => {
        updateTempo(parseInt((e.target as HTMLInputElement).value));
      });
    }

    if (tempoSlider) {
      tempoSlider.addEventListener('input', (e) => {
        updateTempo(parseInt((e.target as HTMLInputElement).value));
      });
    }

    if (tempoUp) {
      tempoUp.addEventListener('click', () => {
        updateTempo(this.stateManager.getTempo() + 1);
      });
    }

    if (tempoDown) {
      tempoDown.addEventListener('click', () => {
        updateTempo(this.stateManager.getTempo() - 1);
      });
    }

    // Fill Speed controls
    const fillSpeedInput = document.getElementById('fillSpeed') as HTMLInputElement;
    const fillSpeedUp = document.getElementById('fillSpeedUp');
    const fillSpeedDown = document.getElementById('fillSpeedDown');
    const fillSpeedDisplay = document.getElementById('fillSpeedDisplay');

    const updateFillSpeed = (value: number) => {
      const newSpeed = Math.max(0.25, Math.min(4, value));
      this.stateManager.getState().fillSpeed = newSpeed;
      if (fillSpeedInput) fillSpeedInput.value = newSpeed.toString();
      if (fillSpeedDisplay) fillSpeedDisplay.textContent = `${newSpeed}x`;
    };

    if (fillSpeedInput) {
      fillSpeedInput.addEventListener('change', (e) => {
        updateFillSpeed(parseFloat((e.target as HTMLInputElement).value));
      });
    }

    if (fillSpeedUp) {
      fillSpeedUp.addEventListener('click', () => {
        updateFillSpeed(this.stateManager.getState().fillSpeed + 0.25);
      });
    }

    if (fillSpeedDown) {
      fillSpeedDown.addEventListener('click', () => {
        updateFillSpeed(this.stateManager.getState().fillSpeed - 0.25);
      });
    }

    // End Speed controls
    const endSpeedInput = document.getElementById('endSpeed') as HTMLInputElement;
    const endSpeedUp = document.getElementById('endSpeedUp');
    const endSpeedDown = document.getElementById('endSpeedDown');
    const endSpeedDisplay = document.getElementById('endSpeedDisplay');

    const updateEndSpeed = (value: number) => {
      const newSpeed = Math.max(0.25, Math.min(4, value));
      this.stateManager.getState().endSpeed = newSpeed;
      if (endSpeedInput) endSpeedInput.value = newSpeed.toString();
      if (endSpeedDisplay) endSpeedDisplay.textContent = `${newSpeed}x`;
    };

    if (endSpeedInput) {
      endSpeedInput.addEventListener('change', (e) => {
        updateEndSpeed(parseFloat((e.target as HTMLInputElement).value));
      });
    }

    if (endSpeedUp) {
      endSpeedUp.addEventListener('click', () => {
        updateEndSpeed(this.stateManager.getState().endSpeed + 0.25);
      });
    }

    if (endSpeedDown) {
      endSpeedDown.addEventListener('click', () => {
        updateEndSpeed(this.stateManager.getState().endSpeed - 0.25);
      });
    }

    // Fill Steps select
    const fillStepsSelect = document.getElementById('fillSteps') as HTMLSelectElement;
    if (fillStepsSelect) {
      fillStepsSelect.addEventListener('change', (e) => {
        const value = parseInt((e.target as HTMLSelectElement).value);
        this.stateManager.getState().fillSteps = value;
      });
    }
  }

  private setupVolumeControls(): void {
    // Volume Master - Modo Usuário
    const masterVolumeUser = document.getElementById('masterVolumeUser') as HTMLInputElement;
    const volumeDisplayUser = document.getElementById('volumeDisplayUser');

    if (masterVolumeUser && volumeDisplayUser) {
      masterVolumeUser.addEventListener('input', (e) => {
        const value = parseInt((e.target as HTMLInputElement).value) / 100;
        this.stateManager.setMasterVolume(value);
        volumeDisplayUser.textContent = `${Math.round(value * 100)}%`;

        // Sincronizar com o controle do modo admin
        const masterVolumeAdmin = document.getElementById('masterVolume') as HTMLInputElement;
        const volumeDisplayAdmin = document.getElementById('masterVolumeDisplay');
        if (masterVolumeAdmin) masterVolumeAdmin.value = (value * 100).toString();
        if (volumeDisplayAdmin) volumeDisplayAdmin.textContent = `${Math.round(value * 100)}%`;
      });
    }

    // Volume Master - Modo Admin
    const masterVolume = document.getElementById('masterVolume') as HTMLInputElement;
    const masterVolumeDisplay = document.getElementById('masterVolumeDisplay');

    if (masterVolume && masterVolumeDisplay) {
      masterVolume.addEventListener('input', (e) => {
        const value = parseInt((e.target as HTMLInputElement).value) / 100;
        this.stateManager.setMasterVolume(value);
        masterVolumeDisplay.textContent = `${Math.round(value * 100)}%`;

        // Sincronizar com o controle do modo usuário
        if (masterVolumeUser) masterVolumeUser.value = (value * 100).toString();
        if (volumeDisplayUser) volumeDisplayUser.textContent = `${Math.round(value * 100)}%`;
      });
    }

    // Observer para atualizar a UI quando o volume master mudar
    this.stateManager.subscribe('masterVolume', (state) => {
      const volumePercent = Math.round(state.masterVolume * 100);

      if (masterVolumeUser) masterVolumeUser.value = volumePercent.toString();
      if (volumeDisplayUser) volumeDisplayUser.textContent = `${volumePercent}%`;
      if (masterVolume) masterVolume.value = volumePercent.toString();
      if (masterVolumeDisplay) masterVolumeDisplay.textContent = `${volumePercent}%`;
    });
  }

  private setupKeyboardShortcuts(): void {
    let arrowRightLastPress = 0;
    let arrowRightTimeout: number | null = null;

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      // Space = Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayStop();
        return;
      }

      // ArrowLeft = Intro + Play OU Fill + Next rhythm
      if ((e.code === 'ArrowLeft' || e.key === 'ArrowLeft') && !e.repeat) {
        e.preventDefault();
        if (!this.stateManager.isPlaying()) {
          this.patternEngine.playIntroAndStart();
          this.play();
        } else {
          this.patternEngine.playFillToNextRhythm();
        }
        return;
      }

      // ArrowRight = Single: Fill / Double: End + Stop
      if ((e.code === 'ArrowRight' || e.key === 'ArrowRight') && !e.repeat) {
        e.preventDefault();
        const now = Date.now();
        const timeSinceLastPress = now - arrowRightLastPress;

        if (timeSinceLastPress < 1000 && arrowRightLastPress > 0) {
          // Double press
          if (arrowRightTimeout) {
            clearTimeout(arrowRightTimeout);
            arrowRightTimeout = null;
          }
          if (this.stateManager.isPlaying()) {
            this.patternEngine.playEndAndStop();
          }
          arrowRightLastPress = 0;
        } else {
          // Single press
          arrowRightLastPress = now;
          if (arrowRightTimeout) clearTimeout(arrowRightTimeout);

          arrowRightTimeout = window.setTimeout(() => {
            if (this.stateManager.isPlaying()) {
              this.patternEngine.playRotatingFill();
            }
            arrowRightTimeout = null;
          }, 1000);
        }
      }
    }, true);
  }

  private setupPerformanceGrid(): void {
    document.querySelectorAll('.grid-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        const element = e.currentTarget as HTMLElement;
        const cellType = element.getAttribute('data-type');
        const variationIndex = parseInt(element.getAttribute('data-variation') || '0');

        if (cellType === 'main') {
          this.patternEngine.activateRhythm(variationIndex);
        } else if (cellType === 'fill') {
          this.patternEngine.activateFillWithTiming(variationIndex);
        } else if (cellType === 'end') {
          this.patternEngine.activateEndWithTiming(variationIndex);
        }
      });
    });
  }

  private setupFileOperations(): void {
    // Save/Load Project
    const saveAllBtn = document.getElementById('saveAll');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', () => this.fileManager.saveProject());
    }

    const loadAllBtn = document.getElementById('loadAll');
    const loadAllFile = document.getElementById('loadAllFile') as HTMLInputElement;
    if (loadAllBtn && loadAllFile) {
      loadAllBtn.addEventListener('click', () => loadAllFile.click());
      loadAllFile.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            await this.fileManager.loadProjectFromFile(file);
            this.uiManager.refreshGridDisplay();
            this.uiManager.updateVariationButtons();
            this.uiManager.showAlert('Projeto carregado com sucesso!');
          } catch (error) {
            console.error('Error loading project:', error);
            this.uiManager.showAlert('Erro ao carregar projeto');
          }
        }
      });
    }

    // Save/Load Pattern
    const savePatternBtn = document.getElementById('savePattern');
    if (savePatternBtn) {
      savePatternBtn.addEventListener('click', () => {
        const pattern = this.stateManager.getEditingPattern();
        this.fileManager.savePattern(pattern);
      });
    }

    const loadPatternBtn = document.getElementById('loadPattern');
    const loadFile = document.getElementById('loadFile') as HTMLInputElement;
    if (loadPatternBtn && loadFile) {
      loadPatternBtn.addEventListener('click', () => loadFile.click());
      loadFile.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            await this.fileManager.loadPatternFromFile(file);
            this.uiManager.refreshGridDisplay();
            this.uiManager.showAlert('Padrão carregado com sucesso!');
          } catch (error) {
            console.error('Error loading pattern:', error);
            this.uiManager.showAlert('Erro ao carregar padrão');
          }
        }
      });
    }

    // Clear Pattern
    const clearPatternBtn = document.getElementById('clearPattern');
    if (clearPatternBtn) {
      clearPatternBtn.addEventListener('click', () => {
        if (confirm('Tem certeza que deseja limpar o padrão atual?')) {
          const pattern = this.stateManager.getEditingPattern();
          const state = this.stateManager.getState();

          // Limpar padrão
          for (let channel = 0; channel < 8; channel++) {
            for (let step = 0; step < 16; step++) {
              state.patterns[pattern][channel][step] = false;
              state.volumes[pattern][channel][step] = 1.0;
            }
          }

          this.uiManager.refreshGridDisplay();
          this.uiManager.showAlert('Padrão limpo!');
        }
      });
    }

    // Load rhythm - Admin mode
    const rhythmSelect = document.getElementById('rhythmSelect') as HTMLSelectElement;
    if (rhythmSelect) {
      rhythmSelect.addEventListener('change', () => {
        const filePath = rhythmSelect.value;
        if (filePath) {
          this.loadRhythmFromPath(filePath);
        }
      });
    }

    // Load rhythm - User mode
    const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;
    if (rhythmSelectUser) {
      rhythmSelectUser.addEventListener('change', () => {
        const filePath = rhythmSelectUser.value;
        if (filePath) {
          this.loadRhythmFromPath(filePath);
        }
      });
    }

    // Refresh rhythms button
    const refreshRhythmsBtn = document.getElementById('refreshRhythms');
    if (refreshRhythmsBtn) {
      refreshRhythmsBtn.addEventListener('click', () => {
        this.loadAvailableRhythms();
        this.uiManager.showAlert('Lista de ritmos atualizada!');
      });
    }
  }

  private setupModeToggle(): void {
    const adminModeToggle = document.getElementById('adminModeToggle') as HTMLInputElement;
    const userMode = document.getElementById('userMode');
    const adminMode = document.getElementById('adminMode');
    const modeLabel = document.getElementById('modeLabel');
    const modeIcon = document.getElementById('modeIcon');

    if (adminModeToggle && userMode && adminMode && modeLabel && modeIcon) {
      adminModeToggle.addEventListener('change', (e) => {
        const isAdmin = (e.target as HTMLInputElement).checked;

        if (isAdmin) {
          // Modo Admin
          userMode.classList.remove('active');
          adminMode.classList.add('active');
          modeLabel.textContent = 'Modo Admin';
          modeIcon.textContent = '⚙️';
        } else {
          // Modo Usuário
          adminMode.classList.remove('active');
          userMode.classList.add('active');
          modeLabel.textContent = 'Modo Usuário';
          modeIcon.textContent = '👤';
        }
      });
    }
  }

  private setupMIDISelectors(): void {
    for (let i = 1; i <= 8; i++) {
      const midiSelect = document.getElementById(`midiSelect${i}`) as HTMLSelectElement;
      if (midiSelect) {
        midiSelect.addEventListener('change', (e) => this.handleMidiSelect(e, i - 1));
      }

      const customMidiBtn = document.querySelector(`.btn-custom-midi[data-channel="${i}"]`) as HTMLElement;
      const customMidiInput = document.getElementById(`customMidiInput${i}`) as HTMLInputElement;
      if (customMidiBtn && customMidiInput) {
        customMidiBtn.addEventListener('click', () => customMidiInput.click());
        customMidiInput.addEventListener('change', (e) => this.handleCustomMidiUpload(e, i - 1));
      }
    }
  }

  private setupVariations(): void {
    // Event listeners para slots de variação
    document.querySelectorAll('.variation-slot').forEach((slot) => {
      slot.addEventListener('click', (e) => {
        const slotIndex = parseInt((e.currentTarget as HTMLElement).getAttribute('data-slot')!);
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

  private selectVariationSlot(slotIndex: number): void {
    const patternType = this.stateManager.getEditingPattern();
    const maxSlots = patternType === 'end' ? 1 : 3;

    if (slotIndex >= maxSlots) {
      this.uiManager.showAlert(`O padrão ${patternType.toUpperCase()} permite apenas ${maxSlots} variações`);
      return;
    }

    this.stateManager.setCurrentVariation(patternType, slotIndex);
    this.updateVariationSlotsUI();
  }

  private saveCurrentVariation(): void {
    const patternType = this.stateManager.getEditingPattern();
    const slotIndex = this.stateManager.getCurrentVariation(patternType);

    this.stateManager.saveVariation(patternType, slotIndex);
    console.log(`Variação ${slotIndex + 1} de ${patternType.toUpperCase()} salva`);
    this.uiManager.showAlert(`Variação ${slotIndex + 1} salva com sucesso!`);

    this.updateVariationSlotsUI();
    this.uiManager.updateVariationButtons();
  }

  private loadSelectedVariation(): void {
    const patternType = this.stateManager.getEditingPattern();
    const slotIndex = this.stateManager.getCurrentVariation(patternType);
    const state = this.stateManager.getState();
    const variation = state.variations[patternType][slotIndex];

    if (!variation || !variation.pattern) {
      this.uiManager.showAlert('Nenhuma variação salva neste slot');
      return;
    }

    this.stateManager.loadVariation(patternType, slotIndex);
    console.log(`Variação ${slotIndex + 1} de ${patternType.toUpperCase()} carregada`);
    this.uiManager.showAlert(`Variação ${slotIndex + 1} carregada com sucesso!`);

    this.uiManager.refreshGridDisplay();
  }

  private updateVariationSlotsUI(): void {
    const patternType = this.stateManager.getEditingPattern();
    const currentSlot = this.stateManager.getCurrentVariation(patternType);
    const maxSlots = patternType === 'end' ? 1 : 3;
    const state = this.stateManager.getState();

    document.querySelectorAll('.variation-slot').forEach((slot, index) => {
      const slotElement = slot as HTMLElement;

      slotElement.classList.remove('active', 'has-content');

      if (patternType === 'end' && index >= maxSlots) {
        slotElement.style.opacity = '0.3';
        slotElement.style.pointerEvents = 'none';
      } else {
        slotElement.style.opacity = '1';
        slotElement.style.pointerEvents = 'auto';
      }

      if (index === currentSlot) {
        slotElement.classList.add('active');
      }

      const variation = state.variations[patternType][index];
      if (variation && variation.pattern) {
        const hasContent = variation.pattern.some(row => row.some(step => step === true));
        if (hasContent) {
          slotElement.classList.add('has-content');
        }
      }
    });
  }

  private switchVariation(patternType: PatternType, variationIndex: number): void {
    const state = this.stateManager.getState();
    const variation = state.variations[patternType][variationIndex];

    if (!variation || !variation.pattern) {
      this.uiManager.showAlert(`${patternType.toUpperCase()} ${variationIndex + 1} não está disponível. Configure no modo Admin primeiro.`);
      return;
    }

    // Verificar se tem conteúdo
    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) {
      this.uiManager.showAlert(`${patternType.toUpperCase()} ${variationIndex + 1} está vazio. Configure no modo Admin primeiro.`);
      return;
    }

    // Atualizar índice da variação atual e carregar
    this.stateManager.setCurrentVariation(patternType, variationIndex);
    this.stateManager.loadVariation(patternType, variationIndex);

    console.log(`${patternType.toUpperCase()} variação ${variationIndex + 1} ativada`);

    // Atualizar UI
    this.uiManager.updateVariationButtons();
    this.uiManager.refreshGridDisplay();

    // Se estiver tocando e no padrão correspondente, aplicar a mudança
    if (this.stateManager.isPlaying() && this.stateManager.getActivePattern() === patternType) {
      console.log('Mudança será aplicada no próximo ciclo');
    }
  }

  // Core methods
  private togglePlayStop(): void {
    if (this.stateManager.isPlaying()) {
      this.stop();
    } else {
      this.patternEngine.playIntroAndStart();
      this.play();
    }
  }

  private async play(): Promise<void> {
    await this.audioManager.resume();
    this.stateManager.setPlaying(true);

    const activePattern = this.stateManager.getActivePattern();
    this.uiManager.updateStatusUI(activePattern);
    this.uiManager.updatePerformanceGrid();

    this.scheduler.start();
  }

  private stop(): void {
    this.stateManager.setPlaying(false);
    this.stateManager.resetStep();
    this.stateManager.setActivePattern('main');
    this.stateManager.clearQueue();
    this.stateManager.setPendingFill(null);
    this.stateManager.setPendingEnd(null);

    this.scheduler.stop();

    const statusAdmin = document.getElementById('status');
    const statusUser = document.getElementById('statusUser');
    if (statusAdmin) statusAdmin.textContent = 'Parado';
    if (statusUser) statusUser.textContent = 'Parado';

    this.uiManager.clearQueuedCells();
    this.uiManager.updatePerformanceGrid();
  }

  private toggleStep(channel: number, step: number): void {
    const pattern = this.stateManager.getEditingPattern();
    this.stateManager.toggleStep(pattern, channel, step);
    this.uiManager.updateStepVisual(channel, step);
  }

  private showVolumeControl(channel: number, step: number, element: HTMLElement): void {
    const pattern = this.stateManager.getEditingPattern();
    const state = this.stateManager.getState();

    if (!state.patterns[pattern][channel][step]) return;

    const currentVolume = state.volumes[pattern][channel][step];

    const popup = document.createElement('div');
    popup.className = 'volume-popup';
    popup.innerHTML = `
      <div class="volume-popup-content">
        <label>Volume: <span id="volumeValue">${Math.round(currentVolume * 100)}%</span></label>
        <input type="range" id="volumeSlider" min="0" max="100" value="${currentVolume * 100}" step="1">
        <button class="volume-close">Fechar</button>
      </div>
    `;

    document.body.appendChild(popup);

    const rect = element.getBoundingClientRect();
    popup.style.left = `${rect.left + window.scrollX}px`;
    popup.style.top = `${rect.top + window.scrollY - 10}px`;

    const slider = popup.querySelector('#volumeSlider') as HTMLInputElement;
    const valueDisplay = popup.querySelector('#volumeValue') as HTMLElement;

    slider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value) / 100;
      this.stateManager.setStepVolume(pattern, channel, step, value);
      valueDisplay.textContent = `${Math.round(value * 100)}%`;
      this.uiManager.updateStepVisual(channel, step);
    });

    const closeBtn = popup.querySelector('.volume-close') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => popup.remove());

    setTimeout(() => {
      document.addEventListener('click', function closePopup(e) {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
          document.removeEventListener('click', closePopup);
        }
      });
    }, 100);
  }

  private switchEditingPattern(patternType: PatternType): void {
    this.stateManager.setEditingPattern(patternType);

    document.querySelectorAll('.pattern-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    const activeTab = document.querySelector(`[data-pattern="${patternType}"]`);
    activeTab?.classList.add('active');

    this.uiManager.refreshGridDisplay();
  }

  private async handleMidiSelect(event: Event, channel: number): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const filePath = select.value;
    if (!filePath) return;

    try {
      const buffer = await this.audioManager.loadAudioFromPath(filePath);
      const pattern = this.stateManager.getEditingPattern();
      const state = this.stateManager.getState();

      state.channels[pattern][channel].buffer = buffer;
      state.channels[pattern][channel].fileName = filePath.split('/').pop() || filePath;
      state.channels[pattern][channel].midiPath = filePath;

      console.log(`MIDI loaded: ${filePath}`);
    } catch (error) {
      console.error('Error loading MIDI:', error);
      this.uiManager.showAlert('Erro ao carregar arquivo MIDI');
      select.value = '';
    }
  }

  private async handleCustomMidiUpload(event: Event, channel: number): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await this.audioManager.loadAudioFromFile(file);
      const pattern = this.stateManager.getEditingPattern();
      const state = this.stateManager.getState();

      state.channels[pattern][channel].buffer = buffer;
      state.channels[pattern][channel].fileName = file.name;
      state.channels[pattern][channel].midiPath = '';

      console.log(`Custom audio loaded: ${file.name}`);
    } catch (error) {
      console.error('Error loading audio:', error);
      this.uiManager.showAlert('Erro ao carregar arquivo de áudio');
    }
  }

  private async loadRhythmFromPath(filePath: string): Promise<void> {
    try {
      await this.fileManager.loadProjectFromPath(filePath);
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();
      this.uiManager.showAlert('Ritmo carregado com sucesso!');
    } catch (error) {
      console.error('Error loading rhythm:', error);
      this.uiManager.showAlert('Erro ao carregar ritmo');
    }
  }

  private async loadAvailableMidi(): Promise<void> {
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
      const midiFiles: string[] = [];
      for (const file of allMidiFiles) {
        try {
          const testResponse = await fetch(`/midi/${file}`, { method: 'HEAD' });
          if (testResponse.ok) {
            midiFiles.push(file);
          }
        } catch (e) {
          // Arquivo não existe, ignorar
        }
      }

      // Preencher os selects dos canais
      for (let i = 1; i <= 8; i++) {
        const select = document.getElementById(`midiSelect${i}`) as HTMLSelectElement;
        if (select) {
          select.innerHTML = '<option value="">Selecione MIDI...</option>';

          midiFiles.forEach(file => {
            const option = document.createElement('option');
            const normalizedPath = `/midi/${file}`;
            option.value = normalizedPath;
            option.textContent = file;
            select.appendChild(option);
          });
        }
      }

      console.log('MIDI files loaded');
    } catch (error) {
      console.log('Could not list MIDI files automatically');
    }
  }

  private async loadAvailableRhythms(): Promise<void> {
    try {
      // Lista fixa de ritmos disponíveis (para funcionar na web hospedada)
      const rhythmFiles = [
        'pop.json',
        'pop-complete.json'
      ];

      const select = document.getElementById('rhythmSelect') as HTMLSelectElement;
      if (!select) return;

      select.innerHTML = '<option value="">Selecione um ritmo...</option>';

      // Verificar quais arquivos existem
      for (const file of rhythmFiles) {
        try {
          const testResponse = await fetch(`/rhythm/${file}`, { method: 'HEAD' });
          if (testResponse.ok) {
            const option = document.createElement('option');
            option.value = `/rhythm/${file}`;
            option.textContent = file.replace('.json', '');
            select.appendChild(option);
          }
        } catch (e) {
          console.log(`Rhythm ${file} not found`);
        }
      }

      console.log('Rhythms loaded');

      // Sincronizar com o select do modo usuário
      this.syncRhythmSelects();
    } catch (error) {
      console.log('Could not list rhythms automatically');
    }
  }

  private syncRhythmSelects(): void {
    const rhythmSelect = document.getElementById('rhythmSelect') as HTMLSelectElement;
    const rhythmSelectUser = document.getElementById('rhythmSelectUser') as HTMLSelectElement;

    if (rhythmSelect && rhythmSelectUser) {
      rhythmSelectUser.innerHTML = rhythmSelect.innerHTML;
    }
  }
}

// Inicializar quando a página carregar
window.addEventListener('DOMContentLoaded', () => {
  new RhythmSequencer();
  console.log('GSOM Rhythm Sequencer initialized!');
});
