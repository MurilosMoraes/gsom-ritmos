// Gerenciamento de ritmos pessoais do usuário
// Salva no localStorage (offline) + Supabase (sync online)

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

export class UserRhythmService {
  private rhythms: UserRhythm[] = [];
  private pendingDeletes: string[] = [];
  private userId: string | null = null;
  private supabase: any = null;

  constructor() {
    this.loadLocal();
    // Voltou a rede → sobe os pendentes na hora (antes só re-tentava no
    // próximo boot do app, e o badge "pendente sync" ficava eterno)
    window.addEventListener('online', () => { void this.syncNow(); });
  }

  // ─── Init com Supabase (chamado após auth) ────────────────────────

  async initWithUser(userId: string, supabase: any): Promise<void> {
    this.userId = userId;
    this.supabase = supabase;

    if (!navigator.onLine) return;

    try {
      // Puxar ritmos do Supabase
      const { data } = await supabase
        .from('gdrums_user_rhythms')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        // Merge: Supabase é fonte de verdade pra ritmos synced
        const remoteIds = new Set(data.map((r: any) => r.id));

        // Manter ritmos locais não sincronizados
        const localOnly = this.rhythms.filter(r => !r.synced && !remoteIds.has(r.id));

        // Tombstones: excluídos localmente NÃO ressuscitam do banco
        const deleted = new Set(this.pendingDeletes);

        // Converter remotos
        this.rhythms = data
          .filter((r: any) => !deleted.has(r.id))
          .map((r: any) => ({
            id: r.id,
            name: r.name,
            bpm: r.bpm,
            rhythm_data: r.rhythm_data,
            base_rhythm_name: r.base_rhythm_name || undefined,
            created_at: r.created_at,
            updated_at: r.updated_at,
            synced: true,
          }));

        // Adicionar locais não sincronizados
        this.rhythms.push(...localOnly);
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
    if (!r) return { ok: false, error: 'ritmo não encontrado' };
    if (r.synced) return { ok: true };
    if (!navigator.onLine) return { ok: false, error: 'sem internet' };
    if (!this.supabase || !this.userId) return { ok: false, error: 'sessão não iniciada' };

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
      return { ok: false, error: e?.message || 'falha de rede' };
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
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.rhythms));
    } catch { /* storage full */ }
    try {
      localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(this.pendingDeletes));
    } catch { /* storage full */ }
  }
}
