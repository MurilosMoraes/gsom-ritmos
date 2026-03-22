// AuthService — Supabase auth real

import { supabase } from './supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export interface GDrumsProfile {
  id: string;
  name: string;
  role: 'user' | 'admin';
  subscription_status: 'active' | 'trial' | 'expired' | 'canceled';
  subscription_plan: string;
  subscription_expires_at: string | null;
  max_devices: number;
  created_at: string;
  updated_at: string;
}

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
  // ─── Autenticação ───────────────────────────────────────────────────

  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        return { success: false, message: this.translateError(error.message) };
      }

      if (!data.user) {
        return { success: false, message: 'Erro ao fazer login.' };
      }

      const profile = await this.getProfile(data.user.id);
      const user = this.buildUser(data.user, profile);

      return { success: true, token: data.session?.access_token, user };
    } catch {
      return { success: false, message: 'Erro ao conectar com o servidor.' };
    }
  }

  async register(registerData: RegisterData): Promise<AuthResponse> {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: registerData.email,
        password: registerData.password,
        options: {
          data: { name: registerData.name }
        }
      });

      if (error) {
        return { success: false, message: this.translateError(error.message) };
      }

      if (!data.user) {
        return { success: false, message: 'Erro ao criar conta.' };
      }

      // Aguardar um momento para o trigger criar o profile
      await new Promise(r => setTimeout(r, 500));

      const profile = await this.getProfile(data.user.id);
      const user = this.buildUser(data.user, profile);

      return { success: true, token: data.session?.access_token, user };
    } catch {
      return { success: false, message: 'Erro ao conectar com o servidor.' };
    }
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    // Limpar dados locais (favoritos, sessão, etc)
    localStorage.removeItem('gdrums-setlist');
    localStorage.removeItem('gdrums-session-id');
    localStorage.removeItem('gdrums-pending-order');
    localStorage.removeItem('gdrums-toggle-intro');
    localStorage.removeItem('gdrums-toggle-final');
    localStorage.removeItem('gdrums-mode');
    window.location.href = '/login.html';
  }

  // ─── Sessão ─────────────────────────────────────────────────────────

  async isAuthenticated(): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return false;

    // Validar que a sessão ainda é aceita pelo servidor
    const { error } = await supabase.auth.getUser();
    if (error) {
      // Token inválido/expirado — limpar sessão corrompida
      await supabase.auth.signOut();
      return false;
    }
    return true;
  }

  isAuthenticatedSync(): boolean {
    // Checa localStorage (rápido, sem await)
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return false;
    try {
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      return !!data.access_token;
    } catch {
      return false;
    }
  }

  async getUser(): Promise<User | null> {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;

    const profile = await this.getProfile(data.user.id);
    return this.buildUser(data.user, profile);
  }

  getUserSync(): User | null {
    // Para compatibilidade com código que chama getUser() sincronamente
    // Retorna dados do cache local
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    try {
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      if (!data.user) return null;
      return {
        id: data.user.id,
        name: data.user.user_metadata?.name || '',
        email: data.user.email || '',
        role: 'user',
        status: 'active',
        subscription: {
          status: 'active',
          plan: 'free',
          startDate: data.user.created_at || '',
          expiryDate: '',
          autoRenew: false,
        },
        maxDevices: 2,
        devices: [],
        createdAt: data.user.created_at || '',
        lastLogin: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async isAdmin(): Promise<boolean> {
    const user = await this.getUser();
    return user?.role === 'admin';
  }

  // ─── Profile ────────────────────────────────────────────────────────

  private async getProfile(userId: string): Promise<GDrumsProfile | null> {
    const { data, error } = await supabase
      .from('gdrums_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) return null;
    return data as GDrumsProfile;
  }

  private buildUser(supaUser: SupabaseUser, profile: GDrumsProfile | null): User {
    return {
      id: supaUser.id,
      name: profile?.name || supaUser.user_metadata?.name || '',
      email: supaUser.email || '',
      role: profile?.role || 'user',
      status: 'active',
      subscription: {
        status: (profile?.subscription_status as 'active' | 'expired' | 'canceled') || 'active',
        plan: profile?.subscription_plan || 'free',
        startDate: profile?.created_at || '',
        expiryDate: profile?.subscription_expires_at || '',
        autoRenew: false,
      },
      maxDevices: profile?.max_devices || 2,
      devices: [],
      createdAt: profile?.created_at || supaUser.created_at || '',
      lastLogin: new Date().toISOString(),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private translateError(message: string): string {
    const translations: Record<string, string> = {
      'Invalid login credentials': 'Email ou senha incorretos.',
      'Email not confirmed': 'Confirme seu email antes de fazer login.',
      'User already registered': 'Este email já está cadastrado.',
      'Password should be at least 6 characters': 'A senha deve ter pelo menos 6 caracteres.',
      'Signup requires a valid password': 'Informe uma senha válida.',
      'Unable to validate email address: invalid format': 'Formato de email inválido.',
    };
    return translations[message] || message;
  }

  // ─── Compatibilidade (métodos usados pelo código existente) ─────────

  getToken(): string | null {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    try {
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      return data.access_token || null;
    } catch {
      return null;
    }
  }

  async checkAccess(): Promise<boolean> {
    return await this.isAuthenticated();
  }

  requireAuth(): void {
    if (!this.isAuthenticatedSync()) {
      window.location.href = '/login.html';
    }
  }

  requireAdmin(): void {
    if (!this.isAuthenticatedSync()) {
      window.location.href = '/login.html';
    }
  }

  async registerDevice(): Promise<boolean> {
    return true; // Device tracking será implementado depois
  }

  getDeviceFingerprint(): string {
    return 'web';
  }
}

export const authService = new AuthService();
