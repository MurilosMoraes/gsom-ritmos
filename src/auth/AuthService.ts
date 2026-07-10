// AuthService — Supabase auth real

import { supabase } from './supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { OfflineCache } from '../native/OfflineCache';
import { internalNav } from '../native/Platform';
import { t } from '../i18n';

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
        return { success: false, message: t('auth.errors.loginGenericFailed') };
      }

      const profile = await this.getProfile(data.user.id);
      const user = this.buildUser(data.user, profile);

      return { success: true, token: data.session?.access_token, user };
    } catch {
      return { success: false, message: t('auth.errors.connectionServerError') };
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
        return { success: false, message: t('auth.errors.accountCreationFailed') };
      }

      // Aguardar um momento para o trigger criar o profile
      await new Promise(r => setTimeout(r, 500));

      const profile = await this.getProfile(data.user.id);
      const user = this.buildUser(data.user, profile);

      return { success: true, token: data.session?.access_token, user };
    } catch {
      return { success: false, message: t('auth.errors.connectionServerError') };
    }
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    // IMPORTANTE: NÃO chamar OneSignal.logout() aqui.
    // Logout do GDrums em 1 device (ex: deslogar no Mac) NÃO deve
    // desvincular o user dos OUTROS devices (Android, celular, etc).
    // O OneSignal.logout() apaga o external_id no SERVIDOR — todos os
    // subscriptions (Mac + Android + iOS) ficam órfãos e não recebem
    // mais push direcionados a esse user.
    //
    // Quando o user logar de novo (mesma conta ou outra), o
    // OneSignal.login(novoUserId) sobrescreve o external_id sem
    // afetar outros devices.
    //
    // Se quiser realmente cancelar push (ex: user pediu "não me mande
    // mais nada"), criamos uma RPC dedicada que limpa onesignal_id no
    // gdrums_profiles + chama OneSignal.User.PushSubscription.optOut().
    localStorage.removeItem('gdrums-onesignal-id');
    // Limpa SÓ dados de sessão e estado transitório.
    // PRESERVA: gdrums-setlist (repertório), gdrums-user-rhythms (ritmos
    // personalizados), gdrums_pedal_keys (mapeamento de pedal), toggles.
    // Justificativa: setlist é trabalho do user — se ele logar de novo
    // (mesma conta ou não), o repertório fica disponível. No initWithUser
    // o setlist do banco do user atual sobrescreve o local com merge defensivo.
    // Se ele logar com OUTRA conta, o initWithUser puxa o setlist da nova conta
    // e o antigo fica em backup local (não some).
    OfflineCache.clear();
    localStorage.removeItem('gdrums-session-id');
    localStorage.removeItem('gdrums-pending-order');
    localStorage.removeItem('gdrums-mode');
    // Limpa flag de "device registrado pra push" — quando próximo user
    // logar nesse device, o NativePushService refaz o registro com o
    // external_id correto. Sem isso, o user novo herdaria push do anterior.
    localStorage.removeItem('gdrums-native-push-registered');
    // Quem clicou em "Sair" NÃO pode ser puxado de volta pelo prompt
    // biométrico AUTOMÁTICO da tela de login (a credencial fica guardada
    // no cofre; o botão manual continua disponível). Flag one-shot que o
    // login.ts consome pra pular só o prompt automático.
    try { sessionStorage.setItem('gdrums-skip-bio-auto', '1'); } catch { /* noop */ }
    internalNav('/login');
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
      'Invalid login credentials': t('auth.errors.invalidCredentials'),
      'Email not confirmed': t('auth.errors.emailNotConfirmed'),
      'User already registered': t('auth.errors.userAlreadyRegistered'),
      'Password should be at least 6 characters': t('auth.errors.passwordTooShortServer'),
      'Signup requires a valid password': t('auth.errors.invalidPasswordServer'),
      'Unable to validate email address: invalid format': t('auth.errors.invalidEmailFormat'),
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
      internalNav('/login');
    }
  }

  requireAdmin(): void {
    if (!this.isAuthenticatedSync()) {
      internalNav('/login');
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
