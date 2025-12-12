// Entry point principal - GSOM Rhythm Sequencer

import { StateManager } from './core/StateManager';
import { AudioManager } from './core/AudioManager';
import { Scheduler } from './core/Scheduler';
import { PatternEngine } from './core/PatternEngine';
import { FileManager } from './io/FileManager';
import { UIManager } from './ui/UIManager';
import type { PatternType, SequencerState } from './types';

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
      this.updateUserStatusBar(state);
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

    this.stateManager.subscribe('pendingFill', () => {
      this.uiManager.updatePerformanceGrid();
    });

    this.stateManager.subscribe('pendingEnd', () => {
      this.uiManager.updatePerformanceGrid();
    });

    // Subscribe para atualizar o step atual
    this.stateManager.subscribe('currentStep', (state) => {
      this.updateUserStatusBar(state);
    });
  }

  private updateUserStatusBar(state: SequencerState): void {
    // Atualizar status
    const statusUser = document.getElementById('statusUser');
    if (statusUser) {
      statusUser.textContent = state.isPlaying ? 'Tocando' : 'Parado';
    }

    // Atualizar posição atual
    const currentStepUser = document.getElementById('currentStepUser');
    if (currentStepUser) {
      const activePattern = state.activePattern as 'intro' | 'main' | 'fill' | 'end';
      const totalSteps = state.patternSteps[activePattern] || 16;
      currentStepUser.textContent = `${state.currentStep + 1}/${totalSteps}`;
    }

    // Atualizar próxima entrada (sempre mostra o padrão ativo)
    const nextEntryUser = document.getElementById('nextEntryUser');
    if (nextEntryUser) {
      const patternNames: Record<PatternType, string> = {
        intro: 'Intro',
        main: 'Principal',
        fill: 'Virada',
        end: 'Final',
        transition: 'Transição'
      };
      nextEntryUser.textContent = patternNames[state.activePattern] || '-';
    }
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

    // Obter número de steps do padrão atual
    const patternType = this.stateManager.getEditingPattern();
    const numSteps = this.stateManager.getPatternSteps(patternType);

    for (let channel = 0; channel < 8; channel++) {
      const channelDiv = document.createElement('div');
      channelDiv.className = 'channel';

      // Informações do canal
      const channelInfo = document.createElement('div');
      channelInfo.className = 'channel-info';
      channelInfo.innerHTML = `
        <div class="channel-number">Canal ${channel + 1}</div>
        <select id="midiSelect${channel + 1}" class="channel-sound">
          <option value="">Selecione...</option>
        </select>
      `;

      channelDiv.appendChild(channelInfo);

      // Steps (número variável baseado no padrão)
      for (let step = 0; step < numSteps; step++) {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'step';
        stepDiv.setAttribute('data-step', step.toString());
        stepDiv.setAttribute('data-channel', channel.toString());

        stepDiv.addEventListener('click', () => {
          this.toggleStep(channel, step);
        });

        stepDiv.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showVolumeControl(channel, step, stepDiv);
        });

        channelDiv.appendChild(stepDiv);
      }

      sequencerContainer.appendChild(channelDiv);
    }

    // Atualizar CSS grid para acomodar número dinâmico de steps
    const channels = sequencerContainer.querySelectorAll('.channel');
    channels.forEach(channel => {
      (channel as HTMLElement).style.gridTemplateColumns = `120px repeat(${numSteps}, 1fr)`;
    });
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

    // Special sounds
    this.setupSpecialSounds();

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
        const sliderValue = parseInt((e.target as HTMLInputElement).value); // 0-200
        const displayPercent = Math.round(sliderValue / 2); // Mostrar 0-100%
        const actualValue = sliderValue / 100; // Valor real 0-2.0

        this.stateManager.setMasterVolume(actualValue);
        volumeDisplayUser.textContent = `${displayPercent}%`;

        // Sincronizar com o controle do modo admin
        const masterVolumeAdmin = document.getElementById('masterVolume') as HTMLInputElement;
        const volumeDisplayAdmin = document.getElementById('masterVolumeDisplay');
        if (masterVolumeAdmin) masterVolumeAdmin.value = sliderValue.toString();
        if (volumeDisplayAdmin) volumeDisplayAdmin.textContent = `${sliderValue}%`;
      });
    }

    // Volume Master - Modo Admin
    const masterVolume = document.getElementById('masterVolume') as HTMLInputElement;
    const masterVolumeDisplay = document.getElementById('masterVolumeDisplay');

    if (masterVolume && masterVolumeDisplay) {
      masterVolume.addEventListener('input', (e) => {
        const valuePercent = parseInt((e.target as HTMLInputElement).value);
        const value = valuePercent / 100;
        this.stateManager.setMasterVolume(value);
        masterVolumeDisplay.textContent = `${valuePercent}%`;

        // Sincronizar com o controle do modo usuário
        if (masterVolumeUser) masterVolumeUser.value = valuePercent.toString();
        if (volumeDisplayUser) volumeDisplayUser.textContent = `${valuePercent}%`;
      });
    }

    // Observer para atualizar a UI quando o volume master mudar
    this.stateManager.subscribe('masterVolume', (state) => {
      const volumePercent = Math.round(state.masterVolume * 100); // Valor real 0-200
      const displayPercent = Math.round(volumePercent / 2); // Mostrar 0-100% no modo usuário

      if (masterVolumeUser) masterVolumeUser.value = volumePercent.toString();
      if (volumeDisplayUser) volumeDisplayUser.textContent = `${displayPercent}%`;
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
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.togglePlayStop();
        return;
      }

      // ArrowLeft = Intro + Play OU Fill + Next rhythm
      if ((e.code === 'ArrowLeft' || e.key === 'ArrowLeft') && !e.repeat) {
        e.preventDefault();
        if (!this.stateManager.isPlaying()) {
          // Sempre começar do ritmo 1 (índice 0) quando parado
          this.patternEngine.activateRhythm(0);
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
        if (!this.stateManager.isPlaying()) {
          // Tocar prato se não estiver tocando
          this.playCymbal();
          return;
        }

        const now = Date.now();
        const timeSinceLastPress = now - arrowRightLastPress;

        // Double click detectado (menos de 500ms entre cliques)
        if (timeSinceLastPress < 500 && arrowRightLastPress > 0) {
          if (arrowRightTimeout) {
            clearTimeout(arrowRightTimeout);
            arrowRightTimeout = null;
          }
          // Double click: Finalização + Stop
          this.patternEngine.playEndAndStop();
          arrowRightLastPress = 0;
        } else {
          // Single click: aguarda para ver se haverá double click
          arrowRightLastPress = now;
          if (arrowRightTimeout) clearTimeout(arrowRightTimeout);

          arrowRightTimeout = window.setTimeout(() => {
            // Single click confirmado: apenas virada
            this.patternEngine.playRotatingFill();
            arrowRightTimeout = null;
          }, 500);
        }
        return;
      }
    });
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

  private setupSpecialSounds(): void {
    // Som de início (Fill Start)
    const fillStartSelect = document.getElementById('fillStartSelect') as HTMLSelectElement;
    const fillStartCustomInput = document.getElementById('fillStartCustomInput') as HTMLInputElement;
    const fillStartCustomBtn = document.getElementById('fillStartCustomBtn');

    if (fillStartSelect) {
      // Carregar MIDIs disponíveis no select
      this.loadAvailableMidi().then(() => {
        const midiFiles = [
          'bumbo.wav', 'caixa.wav', 'chimbal_fechado.wav', 'chimbal_aberto.wav',
          'prato.mp3', 'surdo.wav', 'tom_1.wav', 'tom_2.wav'
        ];
        fillStartSelect.innerHTML = '<option value="">Nenhum</option>';
        midiFiles.forEach(file => {
          const option = document.createElement('option');
          option.value = `/midi/${file}`;
          option.textContent = file;
          fillStartSelect.appendChild(option);
        });
      });

      fillStartSelect.addEventListener('change', async (e) => {
        const path = (e.target as HTMLSelectElement).value;
        if (path) {
          const buffer = await this.audioManager.loadAudioFromPath(path);
          this.stateManager.getState().fillStartSound = {
            buffer,
            fileName: path.split('/').pop() || '',
            midiPath: path
          };
        } else {
          this.stateManager.getState().fillStartSound = {
            buffer: null,
            fileName: '',
            midiPath: ''
          };
        }
      });
    }

    if (fillStartCustomBtn && fillStartCustomInput) {
      fillStartCustomBtn.addEventListener('click', () => fillStartCustomInput.click());
      fillStartCustomInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const audioBuffer = await this.audioManager.loadAudioFromFile(file);
          this.stateManager.getState().fillStartSound = {
            buffer: audioBuffer,
            fileName: file.name,
            midiPath: ''
          };
          const fileNameDisplay = document.getElementById('fillStartFileName');
          if (fileNameDisplay) fileNameDisplay.textContent = file.name;
        }
      });
    }

    // Som de retorno (Fill Return)
    const fillReturnSelect = document.getElementById('fillReturnSelect') as HTMLSelectElement;
    const fillReturnCustomInput = document.getElementById('fillReturnCustomInput') as HTMLInputElement;
    const fillReturnCustomBtn = document.getElementById('fillReturnCustomBtn');

    if (fillReturnSelect) {
      // Carregar MIDIs disponíveis no select
      this.loadAvailableMidi().then(() => {
        const midiFiles = [
          'bumbo.wav', 'caixa.wav', 'chimbal_fechado.wav', 'chimbal_aberto.wav',
          'prato.mp3', 'surdo.wav', 'tom_1.wav', 'tom_2.wav'
        ];
        fillReturnSelect.innerHTML = '<option value="">Nenhum</option>';
        midiFiles.forEach(file => {
          const option = document.createElement('option');
          option.value = `/midi/${file}`;
          option.textContent = file;
          fillReturnSelect.appendChild(option);
        });
      });

      fillReturnSelect.addEventListener('change', async (e) => {
        const path = (e.target as HTMLSelectElement).value;
        if (path) {
          const buffer = await this.audioManager.loadAudioFromPath(path);
          this.stateManager.getState().fillReturnSound = {
            buffer,
            fileName: path.split('/').pop() || '',
            midiPath: path
          };
        } else {
          this.stateManager.getState().fillReturnSound = {
            buffer: null,
            fileName: '',
            midiPath: ''
          };
        }
      });
    }

    if (fillReturnCustomBtn && fillReturnCustomInput) {
      fillReturnCustomBtn.addEventListener('click', () => fillReturnCustomInput.click());
      fillReturnCustomInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const audioBuffer = await this.audioManager.loadAudioFromFile(file);
          this.stateManager.getState().fillReturnSound = {
            buffer: audioBuffer,
            fileName: file.name,
            midiPath: ''
          };
          const fileNameDisplay = document.getElementById('fillReturnFileName');
          if (fileNameDisplay) fileNameDisplay.textContent = file.name;
        }
      });
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

    // Botão Testar Variação
    const testVariationBtn = document.getElementById('testVariation');
    if (testVariationBtn) {
      testVariationBtn.addEventListener('click', () => this.testCurrentVariation());

      // Atualizar o texto do botão baseado no estado de reprodução
      this.stateManager.subscribe('playState', (state) => {
        if (state.isPlaying) {
          testVariationBtn.innerHTML = '<span>⏸ Parar</span>';
        } else {
          testVariationBtn.innerHTML = '<span>▶ Testar</span>';
        }
      });
    }

    // Seletor de steps do padrão
    const patternStepsSelect = document.getElementById('patternStepsSelect') as HTMLSelectElement;
    const currentStepsDisplay = document.getElementById('currentStepsDisplay');

    if (patternStepsSelect) {
      patternStepsSelect.addEventListener('change', (e) => {
        const steps = parseInt((e.target as HTMLSelectElement).value);
        const patternType = this.stateManager.getEditingPattern();

        // Atualizar steps do padrão atual
        this.stateManager.setPatternSteps(patternType, steps);

        // Atualizar display
        if (currentStepsDisplay) {
          currentStepsDisplay.textContent = `${steps} steps`;
        }

        // Regenerar grid com novo número de steps
        this.generateChannelsHTML();

        // Recarregar MIDIs e reconectar event listeners
        this.loadAvailableMidi().then(() => {
          this.setupMIDISelectors();
        });

        // Atualizar display
        this.uiManager.refreshGridDisplay();
      });
    }

    // Observer para atualizar o seletor quando mudar de padrão ou variação
    this.stateManager.subscribe('editingPattern', () => {
      this.updateStepsSelector();
    });

    this.stateManager.subscribe('patternSteps', () => {
      this.updateStepsSelector();
    });

    // Atualizar UI inicial
    this.updateVariationSlotsUI();
    this.updateStepsSelector();
  }

  private updateStepsSelector(): void {
    const patternStepsSelect = document.getElementById('patternStepsSelect') as HTMLSelectElement;
    const currentStepsDisplay = document.getElementById('currentStepsDisplay');
    const patternType = this.stateManager.getEditingPattern();
    const steps = this.stateManager.getPatternSteps(patternType);

    if (patternStepsSelect) {
      patternStepsSelect.value = steps.toString();
    }

    if (currentStepsDisplay) {
      currentStepsDisplay.textContent = `${steps} steps`;
    }
  }

  private selectVariationSlot(slotIndex: number): void {
    const patternType = this.stateManager.getEditingPattern();
    const maxSlots = patternType === 'end' ? 1 : 3;

    if (slotIndex >= maxSlots) {
      this.uiManager.showAlert(`O padrão ${patternType.toUpperCase()} permite apenas ${maxSlots} variações`);
      return;
    }

    // Auto-salvar a variação atual antes de trocar
    const currentSlot = this.stateManager.getCurrentVariation(patternType);
    this.stateManager.saveVariation(patternType, currentSlot);

    // Trocar para o novo slot
    this.stateManager.setCurrentVariation(patternType, slotIndex);

    // Carregar a variação selecionada (mesmo que vazia)
    const state = this.stateManager.getState();
    const variation = state.variations[patternType][slotIndex];

    if (variation && variation.pattern) {
      this.stateManager.loadVariation(patternType, slotIndex);
      this.updateMIDISelectorsFromState();
      this.uiManager.refreshGridDisplay();
    }

    this.updateVariationSlotsUI();
  }

  private testCurrentVariation(): void {
    const patternType = this.stateManager.getEditingPattern();
    const slotIndex = this.stateManager.getCurrentVariation(patternType);
    let state = this.stateManager.getState();

    // Se estiver tocando, parar
    if (this.stateManager.isPlaying()) {
      this.patternEngine.setTestMode(false);
      this.stop();
      return;
    }

    const variation = state.variations[patternType][slotIndex];

    if (!variation || !variation.pattern) {
      this.uiManager.showAlert('Nenhuma variação para testar neste slot');
      return;
    }

    // Verificar se há conteúdo na variação
    const hasContent = variation.pattern.some(row => row.some(step => step === true));
    if (!hasContent) {
      this.uiManager.showAlert('Esta variação está vazia');
      return;
    }

    // Auto-salvar antes de testar
    this.stateManager.saveVariation(patternType, slotIndex);

    // Carregar a variação atual nos patterns principais para tocar
    const loadSuccess = this.stateManager.loadVariation(patternType, slotIndex);
    console.log(`LoadVariation retornou: ${loadSuccess}`);

    // Verificar quantos steps tem a variação
    const numSteps = this.stateManager.getPatternSteps(patternType);
    console.log(`Testando ${patternType} slot ${slotIndex + 1} com ${numSteps} steps`);

    // Debug: verificar se o pattern foi carregado
    state = this.stateManager.getState();
    const hasPattern = state.patterns[patternType].some(row => row.some(step => step));
    console.log(`Pattern ${patternType} tem conteúdo:`, hasPattern);

    // Verificar steps configurados apenas para patterns válidos
    if (patternType === 'main' || patternType === 'fill' || patternType === 'end' || patternType === 'intro') {
      console.log(`Pattern steps configurados:`, state.patternSteps[patternType]);
    }

    // Definir o padrão ativo para o que está sendo editado
    this.stateManager.setActivePattern(patternType);
    this.stateManager.resetStep();

    // Ativar modo de teste para evitar transições automáticas
    this.patternEngine.setTestMode(true);

    // Tocar apenas o padrão que está sendo editado (sem intro/transições)
    this.stateManager.setPlaying(true);
    this.scheduler.start();

    // Notificar UI da mudança
    this.uiManager.updateStatusUI(patternType);
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

  private async playCymbal(): Promise<void> {
    // Carregar e tocar o som do prato
    const cymbalBuffer = await this.audioManager.loadAudioFromPath('/midi/prato.mp3');
    if (cymbalBuffer) {
      const currentTime = this.audioManager.getCurrentTime();
      this.audioManager.playSound(cymbalBuffer, currentTime, 1.0);

      // Feedback visual
      const cymbalBtn = document.getElementById('cymbalBtn');
      if (cymbalBtn) {
        cymbalBtn.classList.add('active');
        setTimeout(() => {
          cymbalBtn.classList.remove('active');
        }, 300);
      }
    }
  }

  private toggleStep(channel: number, step: number): void {
    const pattern = this.stateManager.getEditingPattern();
    this.stateManager.toggleStep(pattern, channel, step);
    this.uiManager.updateStepVisual(channel, step);

    // Auto-salvar a variação atual
    const currentSlot = this.stateManager.getCurrentVariation(pattern);
    this.stateManager.saveVariation(pattern, currentSlot);
    this.uiManager.updateVariationButtons();
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
        <div class="volume-presets">
          <button class="preset-btn" data-volume="20">Ghost</button>
          <button class="preset-btn" data-volume="50">Médio</button>
          <button class="preset-btn" data-volume="80">Alto</button>
          <button class="preset-btn" data-volume="100">Max</button>
        </div>
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

    const updateVolume = (value: number) => {
      this.stateManager.setStepVolume(pattern, channel, step, value);
      valueDisplay.textContent = `${Math.round(value * 100)}%`;
      slider.value = (value * 100).toString();
      this.uiManager.updateStepVisual(channel, step);

      // Auto-salvar a variação atual
      const currentSlot = this.stateManager.getCurrentVariation(pattern);
      this.stateManager.saveVariation(pattern, currentSlot);
    };

    slider.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value) / 100;
      updateVolume(value);
    });

    // Preset buttons
    popup.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const presetValue = parseInt((e.target as HTMLElement).getAttribute('data-volume')!) / 100;
        updateVolume(presetValue);
      });
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

    // Selecionar automaticamente o slot 0 (primeiro slot)
    this.stateManager.setCurrentVariation(patternType, 0);

    // Carregar a variação do slot 0
    const state = this.stateManager.getState();
    const variation = state.variations[patternType][0];
    if (variation && variation.pattern) {
      this.stateManager.loadVariation(patternType, 0);
    }

    // Regenerar grid com número correto de steps para o padrão
    this.generateChannelsHTML();

    // Recarregar MIDIs e reconectar event listeners
    this.loadAvailableMidi().then(() => {
      this.setupMIDISelectors();
      this.updateMIDISelectorsFromState();
    });

    // Atualizar variações UI
    this.updateVariationSlotsUI();

    // Atualizar seletor de steps
    this.updateStepsSelector();

    // Atualizar display
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

      // Auto-salvar a variação atual
      const currentSlot = this.stateManager.getCurrentVariation(pattern);
      this.stateManager.saveVariation(pattern, currentSlot);
      this.uiManager.updateVariationButtons();
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

      // Carregar a primeira variação do padrão sendo editado
      const patternType = this.stateManager.getEditingPattern();
      this.stateManager.loadVariation(patternType, 0);

      this.updateMIDISelectorsFromState();
      this.updateSpecialSoundsSelectors();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();
      this.uiManager.showAlert('Ritmo carregado com sucesso!');
    } catch (error) {
      console.error('Error loading rhythm:', error);
      this.uiManager.showAlert('Erro ao carregar ritmo');
    }
  }

  private updateMIDISelectorsFromState(): void {
    const patternType = this.stateManager.getEditingPattern();
    const currentVariation = this.stateManager.getCurrentVariation(patternType);
    const state = this.stateManager.getState();
    const channels = state.variations[patternType][currentVariation].channels;

    for (let i = 0; i < 8; i++) {
      const midiSelect = document.getElementById(`midiSelect${i + 1}`) as HTMLSelectElement;
      if (midiSelect && channels[i]) {
        const midiPath = channels[i].midiPath;
        if (midiPath) {
          midiSelect.value = midiPath;
        } else {
          midiSelect.value = '';
        }
      }
    }
  }

  private updateSpecialSoundsSelectors(): void {
    const state = this.stateManager.getState();

    // Atualizar selector de som de início
    const fillStartSelect = document.getElementById('fillStartSelect') as HTMLSelectElement;
    if (fillStartSelect && state.fillStartSound.midiPath) {
      fillStartSelect.value = state.fillStartSound.midiPath;
    }

    // Atualizar selector de som de retorno
    const fillReturnSelect = document.getElementById('fillReturnSelect') as HTMLSelectElement;
    if (fillReturnSelect && state.fillReturnSound.midiPath) {
      fillReturnSelect.value = state.fillReturnSound.midiPath;
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

  private availableRhythms: Array<{name: string, path: string}> = [];
  private currentRhythmName: string = '';

  private async loadAvailableRhythms(): Promise<void> {
    try {
      // Tentar carregar lista de ritmos do manifest
      let rhythmFiles: string[] = [];

      try {
        const manifestResponse = await fetch('/rhythm/manifest.json');
        if (manifestResponse.ok) {
          const manifest = await manifestResponse.json();
          rhythmFiles = manifest.rhythms || [];
        }
      } catch (e) {
        // Manifest não existe
      }

      // Se não tiver manifest, usar lista de tentativa
      if (rhythmFiles.length === 0) {
        const possibleRhythms = [
          'pop.json', 'pop-complete.json', 'guarania.json', 'samba.json',
          'bossa.json', 'rock.json', 'funk.json', 'jazz.json'
        ];

        for (const file of possibleRhythms) {
          try {
            const testResponse = await fetch(`/rhythm/${file}`, { method: 'HEAD' });
            if (testResponse.ok) {
              rhythmFiles.push(file);
            }
          } catch (e) {
            // Arquivo não existe
          }
        }
      }

      // Limpar array de ritmos
      this.availableRhythms = [];

      // Atualizar select do modo admin
      const select = document.getElementById('rhythmSelect') as HTMLSelectElement;
      if (select) {
        select.innerHTML = '<option value="">Selecione um ritmo...</option>';
      }

      // Processar todos os ritmos
      for (const file of rhythmFiles) {
        try {
          const testResponse = await fetch(`/rhythm/${file}`, { method: 'HEAD' });
          if (testResponse.ok) {
            const rhythmPath = `/rhythm/${file}`;
            const rhythmName = file.replace('.json', '').replace(/-/g, ' ');

            // Adicionar à lista de ritmos disponíveis
            this.availableRhythms.push({ name: rhythmName, path: rhythmPath });

            // Adicionar opção no select do admin
            if (select) {
              const option = document.createElement('option');
              option.value = rhythmPath;
              option.textContent = rhythmName;
              select.appendChild(option);
            }
          }
        } catch (e) {
          console.log(`Rhythm ${file} not found`);
        }
      }

      // Ordenar alfabeticamente
      this.availableRhythms.sort((a, b) => a.name.localeCompare(b.name));

      // Setup search box
      this.setupRhythmSearch();

      console.log(`${this.availableRhythms.length} rhythms loaded`);
    } catch (error) {
      console.log('Could not list rhythms automatically');
    }
  }

  private setupRhythmSearch(): void {
    const searchInput = document.getElementById('rhythmSearchInput') as HTMLInputElement;
    const dropdown = document.getElementById('rhythmDropdown') as HTMLElement;
    const rhythmList = document.getElementById('rhythmList') as HTMLElement;
    const resultsCount = document.getElementById('resultsCount') as HTMLElement;
    const clearBtn = document.getElementById('clearSearchBtn') as HTMLElement;

    if (!searchInput || !dropdown || !rhythmList) return;

    // Click fora fecha o dropdown
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
        dropdown.style.display = 'none';
      }
    });

    // Clear button
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        dropdown.style.display = 'none';
        searchInput.focus();
      });
    }

    // Input focus mostra todos os ritmos
    searchInput.addEventListener('focus', () => {
      this.filterRhythms('');
      dropdown.style.display = 'block';
    });

    // Input change filtra os ritmos
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      clearBtn.style.display = query ? 'flex' : 'none';
      this.filterRhythms(query);
      dropdown.style.display = 'block';
    });
  }

  private filterRhythms(query: string): void {
    const dropdown = document.getElementById('rhythmDropdown') as HTMLElement;
    const rhythmList = document.getElementById('rhythmList') as HTMLElement;
    const resultsCount = document.getElementById('resultsCount') as HTMLElement;

    if (!rhythmList || !resultsCount) return;

    const searchTerm = query.toLowerCase();
    const filtered = this.availableRhythms.filter(rhythm =>
      rhythm.name.toLowerCase().includes(searchTerm)
    );

    // Atualizar contador
    resultsCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'ritmo encontrado' : 'ritmos encontrados'}`;

    // Limpar lista
    rhythmList.innerHTML = '';

    // Adicionar itens filtrados
    filtered.forEach(rhythm => {
      const item = document.createElement('div');
      item.className = 'rhythm-item';
      if (rhythm.name === this.currentRhythmName) {
        item.classList.add('selected');
      }

      item.innerHTML = `
        <span class="rhythm-item-name">${rhythm.name}</span>
        <span class="rhythm-item-icon">▶</span>
      `;

      item.addEventListener('click', async () => {
        await this.loadRhythm(rhythm.name, rhythm.path);
        dropdown.style.display = 'none';
        const searchInput = document.getElementById('rhythmSearchInput') as HTMLInputElement;
        if (searchInput) {
          searchInput.value = '';
          const clearBtn = document.getElementById('clearSearchBtn') as HTMLElement;
          if (clearBtn) clearBtn.style.display = 'none';
        }
      });

      rhythmList.appendChild(item);
    });

    // Se não houver resultados
    if (filtered.length === 0) {
      rhythmList.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">Nenhum ritmo encontrado</div>';
    }
  }

  private async loadRhythm(name: string, path: string): Promise<void> {
    try {
      await this.fileManager.loadProjectFromPath(path);

      // Carregar a primeira variação do padrão sendo editado
      const patternType = this.stateManager.getEditingPattern();
      this.stateManager.loadVariation(patternType, 0);

      this.updateMIDISelectorsFromState();
      this.updateSpecialSoundsSelectors();
      this.uiManager.refreshGridDisplay();
      this.uiManager.updateVariationButtons();

      // Atualizar nome do ritmo atual
      this.currentRhythmName = name;
      const currentRhythmNameEl = document.getElementById('currentRhythmName');
      if (currentRhythmNameEl) {
        currentRhythmNameEl.textContent = name;
      }

      this.uiManager.showAlert(`Ritmo "${name}" carregado!`);
      console.log(`Rhythm ${name} loaded`);
    } catch (error) {
      console.error(`Error loading rhythm ${name}:`, error);
      this.uiManager.showAlert(`Erro ao carregar ritmo "${name}"`);
    }
  }
}

// Inicializar quando a página carregar
window.addEventListener('DOMContentLoaded', () => {
  new RhythmSequencer();
  console.log('GSOM Rhythm Sequencer initialized!');
});
