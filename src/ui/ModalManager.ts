// Sistema de modais personalizados

export class ModalManager {
  private modalContainer: HTMLElement | null = null;

  constructor() {
    this.createModalContainer();
  }

  private createModalContainer(): void {
    this.modalContainer = document.createElement('div');
    this.modalContainer.id = 'modal-container';
    this.modalContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    `;
    document.body.appendChild(this.modalContainer);
  }

  show(title: string, message: string, type: 'info' | 'error' | 'warning' | 'success' = 'info'): Promise<void> {
    return new Promise((resolve) => {
      if (!this.modalContainer) return resolve();

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: #1a1a1a;
        border: 2px solid ${this.getColorForType(type)};
        border-radius: 12px;
        padding: 30px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        animation: modalSlideIn 0.3s ease-out;
      `;

      const titleEl = document.createElement('h3');
      titleEl.textContent = title;
      titleEl.style.cssText = `
        margin: 0 0 15px 0;
        color: ${this.getColorForType(type)};
        font-size: 1.5em;
        font-weight: 600;
      `;

      const messageEl = document.createElement('p');
      messageEl.textContent = message;
      messageEl.style.cssText = `
        margin: 0 0 25px 0;
        color: #e0e0e0;
        font-size: 1.1em;
        line-height: 1.5;
      `;

      const button = document.createElement('button');
      button.textContent = 'OK';
      button.style.cssText = `
        background: ${this.getColorForType(type)};
        color: white;
        border: none;
        padding: 12px 30px;
        border-radius: 6px;
        font-size: 1.1em;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        transition: all 0.2s;
      `;

      button.onmouseover = () => {
        button.style.transform = 'scale(1.05)';
        button.style.boxShadow = `0 4px 12px ${this.getColorForType(type)}40`;
      };

      button.onmouseout = () => {
        button.style.transform = 'scale(1)';
        button.style.boxShadow = 'none';
      };

      button.onclick = () => {
        this.hide();
        resolve();
      };

      modal.appendChild(titleEl);
      modal.appendChild(messageEl);
      modal.appendChild(button);

      this.modalContainer.innerHTML = '';
      this.modalContainer.appendChild(modal);
      this.modalContainer.style.display = 'flex';

      // Adicionar animação CSS
      if (!document.getElementById('modal-animations')) {
        const style = document.createElement('style');
        style.id = 'modal-animations';
        style.textContent = `
          @keyframes modalSlideIn {
            from {
              transform: translateY(-50px);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        `;
        document.head.appendChild(style);
      }
    });
  }

  confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.modalContainer) return resolve(false);

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: #1a1a1a;
        border: 2px solid #4a9eff;
        border-radius: 12px;
        padding: 30px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        animation: modalSlideIn 0.3s ease-out;
      `;

      const titleEl = document.createElement('h3');
      titleEl.textContent = title;
      titleEl.style.cssText = `
        margin: 0 0 15px 0;
        color: #4a9eff;
        font-size: 1.5em;
        font-weight: 600;
      `;

      const messageEl = document.createElement('p');
      messageEl.textContent = message;
      messageEl.style.cssText = `
        margin: 0 0 25px 0;
        color: #e0e0e0;
        font-size: 1.1em;
        line-height: 1.5;
      `;

      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        gap: 15px;
      `;

      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'Cancelar';
      cancelButton.style.cssText = `
        background: #333;
        color: white;
        border: 1px solid #555;
        padding: 12px 30px;
        border-radius: 6px;
        font-size: 1.1em;
        font-weight: 600;
        cursor: pointer;
        flex: 1;
        transition: all 0.2s;
      `;

      cancelButton.onmouseover = () => {
        cancelButton.style.background = '#444';
      };

      cancelButton.onmouseout = () => {
        cancelButton.style.background = '#333';
      };

      cancelButton.onclick = () => {
        this.hide();
        resolve(false);
      };

      const confirmButton = document.createElement('button');
      confirmButton.textContent = 'Confirmar';
      confirmButton.style.cssText = `
        background: #4a9eff;
        color: white;
        border: none;
        padding: 12px 30px;
        border-radius: 6px;
        font-size: 1.1em;
        font-weight: 600;
        cursor: pointer;
        flex: 1;
        transition: all 0.2s;
      `;

      confirmButton.onmouseover = () => {
        confirmButton.style.transform = 'scale(1.05)';
        confirmButton.style.boxShadow = '0 4px 12px #4a9eff40';
      };

      confirmButton.onmouseout = () => {
        confirmButton.style.transform = 'scale(1)';
        confirmButton.style.boxShadow = 'none';
      };

      confirmButton.onclick = () => {
        this.hide();
        resolve(true);
      };

      buttonContainer.appendChild(cancelButton);
      buttonContainer.appendChild(confirmButton);

      modal.appendChild(titleEl);
      modal.appendChild(messageEl);
      modal.appendChild(buttonContainer);

      this.modalContainer.innerHTML = '';
      this.modalContainer.appendChild(modal);
      this.modalContainer.style.display = 'flex';
    });
  }

  hide(): void {
    if (this.modalContainer) {
      this.modalContainer.style.display = 'none';
      this.modalContainer.innerHTML = '';
    }
  }

  private getColorForType(type: 'info' | 'error' | 'warning' | 'success'): string {
    switch (type) {
      case 'error':
        return '#ff4444';
      case 'warning':
        return '#ffaa00';
      case 'success':
        return '#00cc66';
      case 'info':
      default:
        return '#4a9eff';
    }
  }
}
