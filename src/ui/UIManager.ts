// Gerenciamento de interface do usuário

import type { StateManager } from '../core/StateManager';
import type { PatternType } from '../types';

export class UIManager {
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  // Play/Stop UI
  updatePlayStopUI(isPlaying: boolean): void {
    const playBtn = document.getElementById('playStop');
    const playBtnUser = document.getElementById('playStopUser');

    if (playBtn) {
      if (isPlaying) {
        playBtn.classList.add('playing');
        playBtn.innerHTML = '<span class="icon">⏸️</span><span>STOP</span>';
      } else {
        playBtn.classList.remove('playing');
        playBtn.innerHTML = '<span class="icon">▶️</span><span>PLAY</span>';
      }
    }

    if (playBtnUser) {
      if (isPlaying) {
        playBtnUser.classList.add('playing');
        playBtnUser.innerHTML = '<span class="label">PARAR</span>';
      } else {
        playBtnUser.classList.remove('playing');
        playBtnUser.innerHTML = '<span class="label">PLAY</span>';
      }
    }
  }

  updateStatusUI(pattern: PatternType): void {
    const statusAdmin = document.getElementById('status');
    const statusUser = document.getElementById('statusUser');

    const statusMap: Record<PatternType, { admin: string; user: string }> = {
      main: { admin: 'Tocando - MAIN', user: 'Tocando' },
      fill: { admin: 'Tocando - FILL', user: 'Virada' },
      end: { admin: 'Tocando - END', user: 'Finalizando' },
      intro: { admin: 'Tocando - INTRO', user: 'Introdução' },
      transition: { admin: 'Tocando - TRANSITION', user: 'Transição' }
    };

    if (statusAdmin) {
      statusAdmin.textContent = statusMap[pattern]?.admin || 'Parado';
    }
    if (statusUser) {
      statusUser.textContent = statusMap[pattern]?.user || 'Parado';
    }
  }

  updateTempoUI(tempo: number): void {
    const elements = [
      'tempo',
      'tempoSlider',
      'tempoDisplay',
      'tempoSliderUser',
      'tempoDisplayUser'
    ];

    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (el instanceof HTMLInputElement) {
          el.value = tempo.toString();
        } else {
          el.textContent = tempo.toString();
        }
      }
    });
  }

  updateStepVisual(channel: number, step: number): void {
    const state = this.stateManager.getState();
    const pattern = state.editingPattern;
    const tracks = document.querySelectorAll('.track');
    const track = tracks[channel];
    if (!track) return;

    const stepElement = track.querySelector(`[data-step="${step}"]`) as HTMLElement;
    if (!stepElement) return;

    const isActive = state.patterns[pattern][channel][step];
    const volume = state.volumes[pattern][channel][step];

    if (isActive) {
      stepElement.classList.add('active');
      const volumeIndicator = stepElement.querySelector('.volume-indicator') as HTMLElement;
      if (volumeIndicator) {
        volumeIndicator.style.height = `${volume * 100}%`;
        volumeIndicator.style.background = '#FFD700';
        volumeIndicator.style.opacity = '1';
        volumeIndicator.style.boxShadow = '0 0 8px rgba(255, 215, 0, 0.9)';
      }
    } else {
      stepElement.classList.remove('active');
      const volumeIndicator = stepElement.querySelector('.volume-indicator') as HTMLElement;
      if (volumeIndicator) {
        volumeIndicator.style.height = '0%';
      }
    }
  }

  refreshGridDisplay(): void {
    for (let channel = 0; channel < 8; channel++) {
      for (let step = 0; step < 16; step++) {
        this.updateStepVisual(channel, step);
      }
    }
  }

  updateCurrentStepVisual(): void {
    const state = this.stateManager.getState();
    const currentStep = state.currentStep;

    document.querySelectorAll('.step').forEach((step, index) => {
      const stepIndex = index % 16;
      if (stepIndex === currentStep) {
        step.classList.add('current');
      } else {
        step.classList.remove('current');
      }
    });
  }

  updateVariationButtons(): void {
    const state = this.stateManager.getState();

    document.querySelectorAll('.variation-btn-user').forEach((btn) => {
      const btnElement = btn as HTMLElement;
      const patternType = btnElement.getAttribute('data-type') as PatternType;
      const variationIndex = parseInt(btnElement.getAttribute('data-variation')!);

      const variation = state.variations[patternType][variationIndex];
      btnElement.classList.remove('active');

      if (variation && variation.pattern) {
        const hasContent = variation.pattern.some(row => row.some(step => step === true));

        if (hasContent) {
          (btnElement as HTMLButtonElement).disabled = false;
          btnElement.style.opacity = '1';

          let isActive = false;
          if (patternType === 'main' && variationIndex === state.currentMainVariation) {
            isActive = true;
          } else if (patternType === 'fill' && variationIndex === state.currentFillVariation) {
            isActive = true;
          } else if (patternType === 'end' && variationIndex === state.currentEndVariation) {
            isActive = true;
          }

          if (isActive) {
            btnElement.classList.add('active');
          }
        } else {
          (btnElement as HTMLButtonElement).disabled = true;
          btnElement.style.opacity = '0.3';
        }
      } else {
        (btnElement as HTMLButtonElement).disabled = true;
        btnElement.style.opacity = '0.3';
      }
    });
  }

  updatePerformanceGrid(): void {
    const state = this.stateManager.getState();

    // Ritmos
    document.querySelectorAll('.rhythm-cell').forEach((cell, index) => {
      const cellElement = cell as HTMLElement;
      const variation = state.variations.main[index];
      const hasContent = variation?.pattern?.some(row => row.some(step => step === true));

      cellElement.classList.remove('active', 'disabled');

      if (!hasContent) {
        cellElement.classList.add('disabled');
      } else if (state.isPlaying &&
                 state.activePattern === 'main' &&
                 index === state.currentMainVariation) {
        cellElement.classList.add('active');
      }
    });

    // Viradas
    document.querySelectorAll('.fill-cell').forEach((cell, index) => {
      const cellElement = cell as HTMLElement;
      const variation = state.variations.fill[index];
      const hasContent = variation?.pattern?.some(row => row.some(step => step === true));

      cellElement.classList.remove('active', 'disabled');

      if (!hasContent) {
        cellElement.classList.add('disabled');
      } else if (state.isPlaying &&
                 state.activePattern === 'fill' &&
                 index === state.currentFillVariation) {
        cellElement.classList.add('active');
        cellElement.classList.remove('queued');
      }
    });

    // Finalizações
    document.querySelectorAll('.end-cell').forEach((cell, index) => {
      const cellElement = cell as HTMLElement;
      const variation = state.variations.end[index];
      const hasContent = variation?.pattern?.some(row => row.some(step => step === true));

      cellElement.classList.remove('active', 'disabled');

      if (!hasContent) {
        cellElement.classList.add('disabled');
      } else if (state.isPlaying &&
                 state.activePattern === 'end' &&
                 index === state.currentEndVariation) {
        cellElement.classList.add('active');
        cellElement.classList.remove('queued');
      }
    });
  }

  clearQueuedCells(): void {
    document.querySelectorAll('.grid-cell.queued').forEach(cell => {
      cell.classList.remove('queued');
    });
    const nextEntryUser = document.getElementById('nextEntryUser');
    if (nextEntryUser) {
      nextEntryUser.textContent = '-';
    }
  }

  showAlert(message: string): void {
    alert(message);
  }
}
