// OfflineCache — Cache de sessão e perfil para uso offline
// Permite que o app funcione sem internet no modo usuário
// Usa HMAC para detectar manipulação do localStorage

const PROFILE_KEY = 'gdrums-offline-profile';
const SIGNATURE_KEY = 'gdrums-offline-sig';
const LAST_SYNC_KEY = 'gdrums-offline-last-sync';

// Salt interno — não é um segredo absoluto (está no JS), mas impede
// manipulação casual via DevTools. Quem descompilar o bundle consegue
// achar, mas o esforço elimina 99% das tentativas.
const HMAC_SALT = 'gD#0ffl1n3$2026!sEq';

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

/** Gera hash simples (não criptográfico, mas suficiente para anti-tamper) */
function computeSignature(data: string): string {
  const input = HMAC_SALT + data + HMAC_SALT;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
    hash = ((hash << 13) ^ hash) | 0;
    hash = ((hash * 0x5bd1e995) | 0) ^ (hash >>> 15);
  }
  // Segunda passada para mais dispersão
  for (let i = input.length - 1; i >= 0; i--) {
    const char = input.charCodeAt(i);
    hash = ((hash << 7) + hash + char) | 0;
    hash = ((hash * 0x27d4eb2d) | 0) ^ (hash >>> 13);
  }
  return (hash >>> 0).toString(36) + '-' + ((hash * 0x45d9f3b) >>> 0).toString(36);
}

export const OfflineCache = {
  /** Salva o perfil do usuário para acesso offline (com assinatura anti-tamper) */
  saveProfile(profile: CachedProfile): void {
    try {
      const json = JSON.stringify(profile);
      const sig = computeSignature(json);
      localStorage.setItem(PROFILE_KEY, json);
      localStorage.setItem(SIGNATURE_KEY, sig);
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
    } catch { /* localStorage cheio */ }
  },

  /** Recupera o perfil cacheado (verifica integridade) */
  getProfile(): CachedProfile | null {
    try {
      const data = localStorage.getItem(PROFILE_KEY);
      if (!data) return null;

      // Verificar assinatura — se foi manipulado, invalidar
      const storedSig = localStorage.getItem(SIGNATURE_KEY);
      const expectedSig = computeSignature(data);
      if (storedSig !== expectedSig) {
        // Cache foi adulterado — limpar tudo
        this.clear();
        return null;
      }

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
    localStorage.removeItem(SIGNATURE_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
  },

  /** Retorna se o perfil é admin (admin não funciona offline) */
  isAdmin(): boolean {
    const profile = this.getProfile();
    return profile?.role === 'admin';
  },
};
