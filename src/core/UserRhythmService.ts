// Gerenciamento de ritmos pessoais do usuário
// Salva no localStorage (offline) + IndexedDB (backup) + Supabase (sync online)

import { persistSet, persistGet, requestPersistentStorage } from '../utils/persistentStore';
import { t } from '../i18n';

export interface UserRhythm {
  id: string;
  name: string;
  bpm: number;
  rhythm_data: any; // JSON completo do ritmo (SavedProject format)
  base_rhythm_name?: string; // Nome do ritmo de referência (ex: "Vaneira") no momento do save
  created_at: string;
  updated_at: string;
  synced: boolean; // true = já está no Supabase
}

const LOCAL_KEY = 'gdrums-user-rhythms';
// Tombstones: ids excluídos localmente cuja exclusão REMOTA ainda não
// confirmou. Sem isso, excluir offline ressuscitava o ritmo no próximo
// boot (banco ainda tinha a linha e o merge trazia de volta).
const PENDING_DELETES_KEY = 'gdrums-user-rhythms-pending-deletes';
// Backup em IndexedDB — mesma defesa que o SetlistManager já tem: se o
// browser (Safari iOS principalmente) limpar o localStorage sob pressão
// de disco, os ritmos do usuário não somem — IndexedDB sobrevive.
const IDB_KEY = 'user-rhythms-v1';
// Dono do conteúdo que está HOJE em LOCAL_KEY/PENDING_DELETES_KEY.
// localStorage/IndexedDB não são namespaced por usuário — num device que
// já logou com MAIS DE UMA conta (device compartilhado da banda, celular
// emprestado, reinstalação), sem essa tag os ritmos de uma pessoa vazavam
// pra dentro da conta de outra. Ver isolamento em initWithUser.
const OWNER_KEY = 'gdrums-user-rhythms-owner';
const namespacedKey = (userId: string) => `gdrums-user-rhythms:${userId}`;

interface PersistedState {
  rhythms: UserRhythm[];
  pendingDeletes: string[];
}

export class UserRhythmService {
  private rhythms: UserRhythm[] = [];
  private pendingDeletes: string[] = [];
  private userId: string | null = null;
  private supabase: any = null;

  constructor() {
    this.loadLocal();
    requestPersistentStorage().catch(() => { /* noop */ });
    if (this.rhythms.length === 0) {
      this.tryRestoreFromIndexedDB();
    }
    // Voltou a rede → sobe os pendentes na hora (antes só re-tentava no
    // próximo boot do app, e o badge "pendente sync" ficava eterno)
    window.addEventListener('online', () => { void this.syncNow(); });
    // Retry periódico — cobre 2 buracos que o listener 'online' sozinho
    // não resolve: (1) ritmo salvo ANTES do initWithUser terminar (o
    // client Supabase/userId ainda não tinham sido injetados aqui, então
    // o upload nem chegou a ser tentado — falha 100% silenciosa) e
    // (2) o device nunca "ficou offline de verdade" pro evento 'online'
    // disparar, mas a rede estava ruim o bastante pro insert falhar uma
    // vez. Sem isso, o ritmo fica preso em "pendente sync" até o usuário
    // abrir Meus Ritmos de novo ou reiniciar o app — o que pareceu bug
    // mesmo estando online o tempo todo.
    setInterval(() => {
      if (navigator.onLine && this.supabase && this.userId && this.rhythms.some(r => !r.synced)) {
        void this.syncNow();
      }
    }, 20000);
  }

  /** true se já sabemos (via OWNER_KEY) que o device pertence a OUTRO
   *  usuário que não o desta sessão — usado pra recusar um restore de
   *  IndexedDB (não namespaced) que corra em paralelo com
   *  isolateFromOtherAccounts e tente reintroduzir dado de outra conta. */
  private ownedByOther(): boolean {
    if (!this.userId) return false;
    let owner: string | null = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch { /* noop */ }
    return !!owner && owner !== this.userId;
  }

  /** Recupera do IndexedDB se o localStorage veio vazio (limpo pelo browser). */
  private async tryRestoreFromIndexedDB(): Promise<void> {
    try {
      const recovered = await persistGet<PersistedState>(IDB_KEY);
      if (recovered && Array.isArray(recovered.rhythms) && recovered.rhythms.length > 0 && this.rhythms.length === 0 && !this.ownedByOther()) {
        console.warn('[UserRhythms] localStorage vazio — recuperando do IndexedDB:', recovered.rhythms.length, 'ritmos');
        this.rhythms = recovered.rhythms;
        this.pendingDeletes = Array.isArray(recovered.pendingDeletes) ? recovered.pendingDeletes : [];
        this.writeToLocalStorage();
      }
    } catch { /* IDB pode não estar disponível */ }
  }

  /**
   * Garante que `this.rhythms`/`this.pendingDeletes` pertencem de fato a
   * `userId` antes de qualquer merge com o servidor — mesma defesa do
   * SetlistManager (ver comentário lá). Sem tag de dono, assume que é do
   * usuário atual (migração, device "virgem" ou dado de antes deste
   * fix). Com tag de dono DIFERENTE, arquiva o conteúdo pro dono antigo
   * e troca pelo backup namespaced deste usuário (se existir) ou vazio —
   * nunca herda ritmos de outra conta.
   */
  private isolateFromOtherAccounts(userId: string): void {
    let owner: string | null = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch { /* noop */ }

    if (owner && owner !== userId) {
      console.warn(`[UserRhythms] Local pertence a outra conta (${owner}) — isolando de ${userId}`);
      try {
        localStorage.setItem(namespacedKey(owner), JSON.stringify({ rhythms: this.rhythms, pendingDeletes: this.pendingDeletes } as PersistedState));
      } catch { /* localStorage cheio — tolera */ }

      let restored: PersistedState | null = null;
      try {
        const raw = localStorage.getItem(namespacedKey(userId));
        restored = raw ? JSON.parse(raw) : null;
      } catch { restored = null; }

      this.rhythms = restored?.rhythms || [];
      this.pendingDeletes = restored?.pendingDeletes || [];
      this.writeToLocalStorage();
    }

    if (owner !== userId) {
      try { localStorage.setItem(OWNER_KEY, userId); } catch { /* noop */ }
    }
  }

  // ─── Init com Supabase (chamado após auth) ────────────────────────

  async initWithUser(userId: string, supabase: any): Promise<void> {
    this.userId = userId;
    this.supabase = supabase;
    this.isolateFromOtherAccounts(userId);

    if (!navigator.onLine) return;

    try {
      // Puxar ritmos do Supabase
      const { data } = await supabase
        .from('gdrums_user_rhythms')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        // Merge: Supabase é fonte de verdade, EXCETO quando existe uma
        // edição local ainda não sincronizada e mais recente que a do
        // banco — nesse caso o servidor tem uma versão desatualizada
        // (o insert/update daquele ritmo falhou ou ainda não rodou) e
        // sobrescrever com ela apagaria silenciosamente a edição do
        // usuário. Decide por timestamp (updated_at), igual ao
        // SetlistManager já faz pro repertório.
        const localById = new Map(this.rhythms.map(r => [r.id, r]));
        const deleted = new Set(this.pendingDeletes); // tombstones não ressuscitam
        const merged: UserRhythm[] = [];

        for (const remote of data) {
          if (deleted.has(remote.id)) continue;
          const local = localById.get(remote.id);
          if (local && !local.synced) {
            const localTime = Date.parse(local.updated_at) || 0;
            const remoteTime = Date.parse(remote.updated_at) || 0;
            if (localTime > remoteTime) {
              // Edição local mais nova ainda não subiu — preserva e
              // deixa o syncPending() logo abaixo tentar de novo.
              merged.push(local);
              continue;
            }
          }
          merged.push({
            id: remote.id,
            name: remote.name,
            bpm: remote.bpm,
            rhythm_data: remote.rhythm_data,
            base_rhythm_name: remote.base_rhythm_name || undefined,
            created_at: remote.created_at,
            updated_at: remote.updated_at,
            synced: true,
          });
        }

        // Locais que o banco nem conhece ainda (criados offline, nunca
        // sincronizados) — mantém.
        const remoteIds = new Set(data.map((r: any) => r.id));
        for (const local of this.rhythms) {
          if (!local.synced && !remoteIds.has(local.id)) merged.push(local);
        }

        this.rhythms = merged;
      }

      // Sincronizar pendentes
      await this.syncPending();

      this.saveLocal();
    } catch {
      // Offline ou erro — usar cache local
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  async save(name: string, bpm: number, rhythmData: any, baseRhythmName?: string): Promise<UserRhythm> {
    const now = new Date().toISOString();
    const rhythm: UserRhythm = {
      id: crypto.randomUUID(),
      name,
      bpm,
      rhythm_data: rhythmData,
      base_rhythm_name: baseRhythmName,
      created_at: now,
      updated_at: now,
      synced: false,
    };

    this.rhythms.unshift(rhythm);
    this.saveLocal();

    // Tentar salvar no Supabase
    if (navigator.onLine && this.supabase && this.userId) {
      try {
        const payload: Record<string, any> = {
          id: rhythm.id,
          user_id: this.userId,
          name: rhythm.name,
          bpm: rhythm.bpm,
          rhythm_data: rhythm.rhythm_data,
        };
        if (baseRhythmName) payload.base_rhythm_name = baseRhythmName;
        const { error } = await this.supabase
          .from('gdrums_user_rhythms')
          .insert(payload);
        if (!error) {
          rhythm.synced = true;
          this.saveLocal();
        } else {
          console.warn('[UserRhythms] insert falhou (fica pendente):', error.message);
        }
      } catch { /* salva local, sincroniza depois */ }
    }

    return rhythm;
  }

  /** Atualiza nome/BPM e, se fornecido, o CONTEÚDO do ritmo (rhythmData).
   *  rhythmData permite o fluxo "Atualizar 'X'" no salvar (sobrescreve em
   *  vez de duplicar). */
  async update(id: string, name: string, bpm: number, rhythmData?: any): Promise<void> {
    const rhythm = this.rhythms.find(r => r.id === id);
    if (!rhythm) return;

    rhythm.name = name;
    rhythm.bpm = bpm;
    if (rhythmData !== undefined) rhythm.rhythm_data = rhythmData;
    rhythm.updated_at = new Date().toISOString();
    rhythm.synced = false;
    this.saveLocal();

    if (navigator.onLine && this.supabase && this.userId) {
      try {
        // UPSERT com payload completo, não update por id: se o INSERT
        // original falhou (offline/rede), o update atingia 0 linhas SEM
        // erro → marcava synced=true mas o ritmo nunca tinha subido.
        // Upsert cria a linha que falta ou atualiza a existente.
        const payload: Record<string, any> = {
          id: rhythm.id,
          user_id: this.userId,
          name: rhythm.name,
          bpm: rhythm.bpm,
          rhythm_data: rhythm.rhythm_data,
          created_at: rhythm.created_at,
          updated_at: rhythm.updated_at,
        };
        if (rhythm.base_rhythm_name) payload.base_rhythm_name = rhythm.base_rhythm_name;
        const { error } = await this.supabase
          .from('gdrums_user_rhythms')
          .upsert(payload);
        if (!error) {
          rhythm.synced = true;
          this.saveLocal();
        } else {
          console.warn('[UserRhythms] upsert falhou (fica pendente):', error.message);
        }
      } catch { /* sincroniza depois */ }
    }
  }

  async delete(id: string): Promise<void> {
    this.rhythms = this.rhythms.filter(r => r.id !== id);
    // Tombstone até a exclusão REMOTA confirmar — senão excluir offline
    // ressuscita o ritmo no próximo boot
    if (!this.pendingDeletes.includes(id)) this.pendingDeletes.push(id);
    this.saveLocal();

    if (navigator.onLine && this.supabase) {
      try {
        const { error } = await this.supabase
          .from('gdrums_user_rhythms')
          .delete()
          .eq('id', id);
        if (!error) {
          this.pendingDeletes = this.pendingDeletes.filter(d => d !== id);
          this.saveLocal();
        } else {
          console.warn('[UserRhythms] delete remoto falhou (fica pendente):', error.message);
        }
      } catch { /* tombstone garante a exclusão no próximo sync */ }
    }
  }

  getAll(): UserRhythm[] {
    return this.rhythms;
  }

  getById(id: string): UserRhythm | undefined {
    return this.rhythms.find(r => r.id === id);
  }

  // ─── Sync ─────────────────────────────────────────────────────────

  /** Sobe todos os pendentes AGORA (saves E exclusões). Retorna true se
   *  algo sincronizou. Chamado no boot (initWithUser), na volta da rede
   *  (evento online) e ao abrir o modal Meus Ritmos. */
  async syncNow(): Promise<boolean> {
    if (!this.supabase || !this.userId || !navigator.onLine) return false;

    let deletedAny = false;
    // 1) Exclusões pendentes (tombstones)
    for (const id of [...this.pendingDeletes]) {
      try {
        const { error } = await this.supabase
          .from('gdrums_user_rhythms')
          .delete()
          .eq('id', id);
        if (!error) {
          this.pendingDeletes = this.pendingDeletes.filter(d => d !== id);
          deletedAny = true;
        } else {
          console.warn('[UserRhythms] sync de exclusão falhou:', error.message);
        }
      } catch { break; /* sem rede */ }
    }
    if (deletedAny) this.saveLocal();

    // 2) Saves pendentes
    const pending = this.rhythms.filter(r => !r.synced);
    if (pending.length === 0) return deletedAny;

    for (const r of pending) {
      try {
        const payload: Record<string, any> = {
          id: r.id,
          user_id: this.userId,
          name: r.name,
          bpm: r.bpm,
          rhythm_data: r.rhythm_data,
          created_at: r.created_at,
          updated_at: r.updated_at,
        };
        if (r.base_rhythm_name) payload.base_rhythm_name = r.base_rhythm_name;
        const { error } = await this.supabase
          .from('gdrums_user_rhythms')
          .upsert(payload);
        if (!error) {
          r.synced = true;
        } else {
          console.warn('[UserRhythms] sync pendente falhou:', error.message);
        }
      } catch { break; /* sem rede */ }
    }

    const anySynced = pending.some(r => r.synced);
    if (anySynced) this.saveLocal();
    return anySynced || deletedAny;
  }

  private async syncPending(): Promise<void> {
    await this.syncNow();
  }

  /** Sincroniza UM ritmo e devolve o resultado COM o motivo da falha —
   *  usado pelo badge "pendente sync" (tap = tentar agora + ver erro). */
  async syncOne(id: string): Promise<{ ok: boolean; error?: string }> {
    const r = this.rhythms.find(x => x.id === id);
    if (!r) return { ok: false, error: t('core.sync.rhythmNotFound') };
    if (r.synced) return { ok: true };
    if (!navigator.onLine) return { ok: false, error: t('core.sync.noInternet') };
    if (!this.supabase || !this.userId) return { ok: false, error: t('core.sync.sessionNotStarted') };

    try {
      const payload: Record<string, any> = {
        id: r.id,
        user_id: this.userId,
        name: r.name,
        bpm: r.bpm,
        rhythm_data: r.rhythm_data,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
      if (r.base_rhythm_name) payload.base_rhythm_name = r.base_rhythm_name;
      const { error } = await this.supabase
        .from('gdrums_user_rhythms')
        .upsert(payload);
      if (error) return { ok: false, error: error.message };
      r.synced = true;
      this.saveLocal();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || t('core.sync.networkFailure') };
    }
  }

  // ─── localStorage ─────────────────────────────────────────────────

  private loadLocal(): void {
    try {
      const data = localStorage.getItem(LOCAL_KEY);
      this.rhythms = data ? JSON.parse(data) : [];
    } catch {
      this.rhythms = [];
    }
    try {
      const dels = localStorage.getItem(PENDING_DELETES_KEY);
      this.pendingDeletes = dels ? JSON.parse(dels) : [];
      if (!Array.isArray(this.pendingDeletes)) this.pendingDeletes = [];
    } catch {
      this.pendingDeletes = [];
    }
  }

  private saveLocal(): void {
    this.writeToLocalStorage();
    // IndexedDB em paralelo (fire-and-forget) — última linha de defesa,
    // igual ao SetlistManager. Só grava estados com ritmos (não sobrescreve
    // um IDB bom com um estado vazio por engano).
    if (this.rhythms.length > 0) {
      persistSet(IDB_KEY, { rhythms: this.rhythms, pendingDeletes: this.pendingDeletes } as PersistedState)
        .catch(() => { /* noop */ });
    }
  }

  private writeToLocalStorage(): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.rhythms));
    } catch { /* storage full */ }
    try {
      localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(this.pendingDeletes));
    } catch { /* storage full */ }
    // Espelho namespaced por conta — permite restaurar certo se ESTE
    // usuário voltar a usar este mesmo device depois de outra conta ter
    // usado no meio (ver isolateFromOtherAccounts).
    if (this.userId) {
      try {
        localStorage.setItem(namespacedKey(this.userId), JSON.stringify({ rhythms: this.rhythms, pendingDeletes: this.pendingDeletes } as PersistedState));
      } catch { /* storage full */ }
    }
  }
}
