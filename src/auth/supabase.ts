import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qjW2fGXMHtQvqVKgyyiiUg_HczRwmXy';

// Sessão sempre persistida (localStorage, padrão do Supabase) — "lembrar de
// mim" é sempre ligado: o usuário fica logado até sair ou o token expirar.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
