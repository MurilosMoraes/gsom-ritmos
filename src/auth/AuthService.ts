// AuthService - Gerencia autenticação, sessão e controle de acesso

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'inactive' | 'blocked';
  subscription: {
    status: 'active' | 'expired' | 'canceled';
    plan: string;
    startDate: string;
    expiryDate: string;
    autoRenew: boolean;
  };
  maxDevices: number;
  devices: DeviceInfo[];
  createdAt: string;
  lastLogin: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  fingerprint: string;
  lastAccess: string;
  ip: string;
  userAgent: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: User;
  message?: string;
}

class AuthService {
  private readonly API_URL = '/api'; // Placeholder - será substituído por URL real
  private readonly TOKEN_KEY = 'gdrums_token';
  private readonly USER_KEY = 'gdrums_user';
  private readonly DEVICE_KEY = 'gdrums_device';

  // ============================================
  // AUTENTICAÇÃO
  // ============================================

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      // TODO: Substituir por chamada real à API
      // Simulação temporária
      await this.simulateDelay(1000);

      // Verificar dispositivo
      const deviceFingerprint = this.getDeviceFingerprint();

      // Mock response - substituir por fetch real
      const mockUser: User = {
        id: '1',
        name: 'Usuário Teste',
        email: credentials.email,
        role: credentials.email.includes('admin') ? 'admin' : 'user',
        status: 'active',
        subscription: {
          status: 'active',
          plan: 'Profissional',
          startDate: new Date().toISOString(),
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          autoRenew: true
        },
        maxDevices: 2,
        devices: [
          {
            id: '1',
            name: 'Device 1',
            fingerprint: deviceFingerprint,
            lastAccess: new Date().toISOString(),
            ip: '127.0.0.1',
            userAgent: navigator.userAgent
          }
        ],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };

      const token = this.generateMockToken();

      // Salvar token e usuário
      this.saveToken(token, credentials.rememberMe);
      this.saveUser(mockUser);
      this.saveDeviceInfo(deviceFingerprint);

      return {
        success: true,
        token,
        user: mockUser
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        message: 'Erro ao fazer login. Verifique suas credenciais.'
      };
    }
  }

  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      // TODO: Substituir por chamada real à API
      await this.simulateDelay(1000);

      // Validações
      if (data.password.length < 8) {
        return {
          success: false,
          message: 'A senha deve ter no mínimo 8 caracteres'
        };
      }

      // Mock response
      const mockUser: User = {
        id: Date.now().toString(),
        name: data.name,
        email: data.email,
        role: 'user',
        status: 'active',
        subscription: {
          status: 'active',
          plan: 'Profissional',
          startDate: new Date().toISOString(),
          expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          autoRenew: true
        },
        maxDevices: 2,
        devices: [],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };

      const token = this.generateMockToken();

      this.saveToken(token, true);
      this.saveUser(mockUser);

      return {
        success: true,
        token,
        user: mockUser
      };
    } catch (error) {
      console.error('Register error:', error);
      return {
        success: false,
        message: 'Erro ao criar conta. Tente novamente.'
      };
    }
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    sessionStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.USER_KEY);
    window.location.href = '/login.html';
  }

  // ============================================
  // VALIDAÇÃO E PROTEÇÃO
  // ============================================

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY) || sessionStorage.getItem(this.TOKEN_KEY);
  }

  getUser(): User | null {
    const userJson = localStorage.getItem(this.USER_KEY) || sessionStorage.getItem(this.USER_KEY);
    if (!userJson) return null;

    try {
      return JSON.parse(userJson);
    } catch {
      return null;
    }
  }

  isAdmin(): boolean {
    const user = this.getUser();
    return user?.role === 'admin';
  }

  async checkAccess(): Promise<boolean> {
    if (!this.isAuthenticated()) {
      return false;
    }

    const user = this.getUser();
    if (!user) return false;

    // Verificar status da conta
    if (user.status === 'blocked') {
      this.logout();
      return false;
    }

    // Verificar assinatura
    if (user.subscription.status !== 'active') {
      return false;
    }

    // Verificar dispositivo
    const deviceFingerprint = this.getDeviceFingerprint();
    const deviceRegistered = user.devices.some(d => d.fingerprint === deviceFingerprint);

    if (!deviceRegistered && user.devices.length >= user.maxDevices) {
      // Máximo de dispositivos atingido
      return false;
    }

    return true;
  }

  // ============================================
  // CONTROLE DE DISPOSITIVOS (Anti-Compartilhamento)
  // ============================================

  getDeviceFingerprint(): string {
    // Gerar fingerprint único do dispositivo
    const saved = localStorage.getItem(this.DEVICE_KEY);
    if (saved) return saved;

    const fingerprint = this.generateDeviceFingerprint();
    localStorage.setItem(this.DEVICE_KEY, fingerprint);
    return fingerprint;
  }

  private generateDeviceFingerprint(): string {
    // Combinar várias características do dispositivo
    const data = [
      navigator.userAgent,
      navigator.language,
      navigator.hardwareConcurrency?.toString() || '',
      screen.width.toString(),
      screen.height.toString(),
      screen.colorDepth.toString(),
      new Date().getTimezoneOffset().toString(),
      navigator.platform
    ].join('|');

    // Hash simples (em produção usar biblioteca de crypto)
    return this.simpleHash(data);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  async registerDevice(): Promise<boolean> {
    const user = this.getUser();
    if (!user) return false;

    const fingerprint = this.getDeviceFingerprint();

    // Verificar se dispositivo já está registrado
    if (user.devices.some(d => d.fingerprint === fingerprint)) {
      return true;
    }

    // Verificar limite de dispositivos
    if (user.devices.length >= user.maxDevices) {
      return false;
    }

    // Adicionar novo dispositivo
    const newDevice: DeviceInfo = {
      id: Date.now().toString(),
      name: this.getDeviceName(),
      fingerprint,
      lastAccess: new Date().toISOString(),
      ip: 'Unknown', // Seria obtido do servidor
      userAgent: navigator.userAgent
    };

    user.devices.push(newDevice);
    this.saveUser(user);

    // TODO: Sincronizar com servidor
    return true;
  }

  private getDeviceName(): string {
    const ua = navigator.userAgent;
    if (ua.includes('Windows')) return 'Windows PC';
    if (ua.includes('Mac')) return 'Mac';
    if (ua.includes('Linux')) return 'Linux PC';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    return 'Unknown Device';
  }

  // ============================================
  // UTILITÁRIOS
  // ============================================

  private saveToken(token: string, remember: boolean = false): void {
    if (remember) {
      localStorage.setItem(this.TOKEN_KEY, token);
    } else {
      sessionStorage.setItem(this.TOKEN_KEY, token);
    }
  }

  private saveUser(user: User): void {
    const userJson = JSON.stringify(user);
    localStorage.setItem(this.USER_KEY, userJson);
    sessionStorage.setItem(this.USER_KEY, userJson);
  }

  private saveDeviceInfo(fingerprint: string): void {
    localStorage.setItem(this.DEVICE_KEY, fingerprint);
  }

  private generateMockToken(): string {
    return 'mock_token_' + Math.random().toString(36).substring(2);
  }

  private simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Redirecionar para login se não autenticado
  requireAuth(): void {
    if (!this.isAuthenticated()) {
      window.location.href = '/login.html';
    }
  }

  // Redirecionar para login se não for admin
  requireAdmin(): void {
    if (!this.isAuthenticated() || !this.isAdmin()) {
      window.location.href = '/login.html';
    }
  }
}

export const authService = new AuthService();
