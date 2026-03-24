// OfflineCache — Cache de sessão e perfil para uso offline
// Permite que o app funcione sem internet no modo usuário

const PROFILE_KEY = 'gdrums-offline-profile';
const LAST_SYNC_KEY = 'gdrums-offline-last-sync';

export interface CachedProfile {
  userId: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  subscriptionStatus: 'active' | 'trial' | 'expired' | 'canceled';
  subscriptionPlan: string;
  subscriptionExpiresAt: string | null;
  cachedAt: number;
}

export const OfflineCache = {
  /** Salva o perfil do usuário para acesso offline */
  saveProfile(profile: CachedProfile): void {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
    } catch { /* localStorage cheio */ }
  },

  /** Recupera o perfil cacheado */
  getProfile(): CachedProfile | null {
    try {
      const data = localStorage.getItem(PROFILE_KEY);
      if (!data) return null;
      return JSON.parse(data) as CachedProfile;
    } catch {
      return null;
    }
  },

  /** Verifica se há um perfil offline com assinatura válida */
  hasValidOfflineAccess(): boolean {
    const profile = this.getProfile();
    if (!profile) return false;

    // Verificar se a assinatura ainda é válida
    if (profile.subscriptionStatus !== 'active' && profile.subscriptionStatus !== 'trial') {
      return false;
    }

    if (!profile.subscriptionExpiresAt) return false;

    const expiresDate = new Date(profile.subscriptionExpiresAt);
    if (expiresDate <= new Date()) return false;

    // Cache válido por até 7 dias sem reconectar
    const maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7 dias
    if (Date.now() - profile.cachedAt > maxCacheAge) return false;

    return true;
  },

  /** Verifica se estamos offline */
  isOffline(): boolean {
    return !navigator.onLine;
  },

  /** Limpa o cache offline (usado no logout) */
  clear(): void {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
  },

  /** Retorna se o perfil é admin (admin não funciona offline) */
  isAdmin(): boolean {
    const profile = this.getProfile();
    return profile?.role === 'admin';
  },
};
