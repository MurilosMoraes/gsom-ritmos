import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy';

// "Lembrar de mim": controla ONDE a sessão é guardada.
//  - marcado OU flag ausente (padrão) → localStorage → persiste ao fechar
//  - desmarcado ('0')                 → sessionStorage → desloga ao fechar
// Flag ausente = comportamento antigo (todo mundo continuava logado), pra
// NÃO deslogar quem já tem sessão salva quando esse código subir.
const rememberOn = (): boolean => {
  try { return localStorage.getItem('gdrums-remember') !== '0'; } catch { return true; }
};

const authStorage = {
  getItem: (k: string): string | null => {
    try { return (rememberOn() ? localStorage : sessionStorage).getItem(k); } catch { return null; }
  },
  setItem: (k: string, v: string): void => {
    try { (rememberOn() ? localStorage : sessionStorage).setItem(k, v); } catch { /* storage cheio */ }
  },
  removeItem: (k: string): void => {
    try { localStorage.removeItem(k); } catch { /* noop */ }
    try { sessionStorage.removeItem(k); } catch { /* noop */ }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: authStorage, persistSession: true, autoRefreshToken: true },
});
