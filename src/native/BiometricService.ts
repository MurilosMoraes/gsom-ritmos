// Login por biometria (digital / Face ID) — só no app nativo (Capacitor).
//
// FLUXO (decidido com o Murilo, 2026-07):
// 1. Primeiro login é SEMPRE email+senha (form normal).
// 2. Após logar com sucesso no nativo, oferecemos UMA vez: "quer entrar
//    com digital/Face ID da próxima vez?" — [Ativar] [Agora não].
//    "Agora não" silencia a oferta por 7 dias (não enche o saco).
// 3. Ao ativar, a credencial vai pro Keychain (iOS) / Keystore (Android)
//    — cofre de hardware do aparelho, atrás da biometria. NADA novo vai
//    pro servidor. Mesmo padrão dos apps de banco.
// 4. Próximos logins: botão "Entrar com digital/Face ID" ACIMA do form.
//    O form de email+senha NUNCA sai da tela — se a câmera quebrar, a
//    digital falhar ou a pessoa preferir, entra do jeito clássico.
// 5. Senha trocada (recovery ou perfil) → credencial salva é apagada e
//    a oferta volta no próximo login com a senha nova.
//
// Plugin: @capgo/capacitor-native-biometric (mesma casa do IAP capgo).
// No browser tudo aqui vira no-op — a web nem vê essa feature.

import { Capacitor } from '@capacitor/core';

const SERVER = 'gdrums.com.br'; // chave do cofre no Keychain/Keystore
const ENABLED_KEY = 'gdrums-biometric-enabled';
const DECLINED_AT_KEY = 'gdrums-biometric-declined-at';
const DECLINE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export type BiometricKind = 'face' | 'fingerprint';

function isNative(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

async function plugin() {
  const { NativeBiometric, BiometryType } = await import('@capgo/capacitor-native-biometric');
  return { NativeBiometric, BiometryType };
}

export const BiometricService = {
  /** Tipo de biometria disponível no aparelho, ou null se não há/não é nativo. */
  async availableKind(): Promise<BiometricKind | null> {
    if (!isNative()) return null;
    try {
      const { NativeBiometric, BiometryType } = await plugin();
      const r = await NativeBiometric.isAvailable();
      if (!r.isAvailable) return null;
      return (r.biometryType === BiometryType.FACE_ID ||
              r.biometryType === BiometryType.FACE_AUTHENTICATION)
        ? 'face' : 'fingerprint';
    } catch {
      return null;
    }
  },

  /** Rótulo humano pro tipo ("Face ID" / "digital"). */
  label(kind: BiometricKind): string {
    return kind === 'face' ? 'Face ID' : 'digital';
  },

  isEnabled(): boolean {
    try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
  },

  /** true se devemos OFERECER a ativação (nativo, disponível, não ativado,
   *  e não recusado nos últimos 7 dias). */
  async shouldOffer(): Promise<BiometricKind | null> {
    if (!isNative() || this.isEnabled()) return null;
    try {
      const declinedAt = parseInt(localStorage.getItem(DECLINED_AT_KEY) || '0');
      if (declinedAt && Date.now() - declinedAt < DECLINE_SNOOZE_MS) return null;
    } catch { /* segue */ }
    return this.availableKind();
  },

  /** Guarda a credencial no cofre do aparelho e liga a flag. */
  async enable(email: string, password: string): Promise<boolean> {
    if (!isNative()) return false;
    try {
      const { NativeBiometric } = await plugin();
      await NativeBiometric.setCredentials({ server: SERVER, username: email, password });
      localStorage.setItem(ENABLED_KEY, '1');
      localStorage.removeItem(DECLINED_AT_KEY);
      return true;
    } catch (e) {
      console.warn('[Biometric] enable falhou:', e);
      return false;
    }
  },

  declineForNow(): void {
    try { localStorage.setItem(DECLINED_AT_KEY, String(Date.now())); } catch { /* noop */ }
  },

  /** Apaga credencial + flag (troca de senha, conta trocada, etc). */
  async disable(): Promise<void> {
    try { localStorage.removeItem(ENABLED_KEY); } catch { /* noop */ }
    if (!isNative()) return;
    try {
      const { NativeBiometric } = await plugin();
      await NativeBiometric.deleteCredentials({ server: SERVER });
    } catch { /* cofre já vazio — ok */ }
  },

  /**
   * Pede a biometria e devolve a credencial guardada.
   * Retorna null se o user cancelou / biometria falhou / cofre vazio —
   * o caller NÃO mostra erro agressivo: o form de email+senha está logo
   * ali como fallback (requisito: sempre dá pra entrar do jeito clássico).
   */
  async authenticate(): Promise<{ email: string; password: string } | null> {
    if (!isNative() || !this.isEnabled()) return null;
    try {
      const { NativeBiometric, BiometryType } = await plugin();
      const kind = await this.availableKind();
      const opts: NonNullable<Parameters<typeof NativeBiometric.verifyIdentity>[0]> = {
        reason: 'Entrar no GDrums',
        title: 'Entrar no GDrums',
        subtitle: kind === 'face' ? 'Use o Face ID pra entrar' : 'Use sua digital pra entrar',
        maxAttempts: 3,
      };
      // ANDROID: o BiometricPrompt do plugin autentica com CryptoObject (Keystore),
      // e o androidx.biometric PROÍBE CryptoObject com biometria WEAK (Classe 2).
      // O default do plugin manda STRONG|WEAK — que colapsa pra WEAK — e crasha a
      // AuthActivity ("Crypto-based auth not supported for Class 2 biometrics"),
      // fechando o app. Restringir a FINGERPRINT força o caminho STRONG-only e
      // resolve. No iOS NÃO passamos isso: lá afeta o Face ID (que já funciona).
      if (Capacitor.getPlatform() === 'android') {
        opts.allowedBiometryTypes = [BiometryType.FINGERPRINT];
      }
      await NativeBiometric.verifyIdentity(opts);
      const creds = await NativeBiometric.getCredentials({ server: SERVER });
      if (!creds?.username || !creds?.password) {
        await this.disable(); // cofre vazio/corrompido — volta pro fluxo clássico
        return null;
      }
      return { email: creds.username, password: creds.password };
    } catch {
      // Cancelou, errou 3x, sensor indisponível — sem drama: form tá na tela
      return null;
    }
  },
};
