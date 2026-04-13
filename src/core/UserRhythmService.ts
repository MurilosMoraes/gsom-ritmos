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

export class UserRhythmService {
  private rhythms: UserRhythm[] = [];
  private userId: string | null = null;
  private supabase: any = null;

  constructor() {
    this.loadLocal();
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

        // Converter remotos
        this.rhythms = data.map((r: any) => ({
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
        }
      } catch { /* salva local, sincroniza depois */ }
    }

    return rhythm;
  }

  async update(id: string, name: string, bpm: number): Promise<void> {
    const rhythm = this.rhythms.find(r => r.id === id);
    if (!rhythm) return;

    rhythm.name = name;
    rhythm.bpm = bpm;
    rhythm.updated_at = new Date().toISOString();
    rhythm.synced = false;
    this.saveLocal();

    if (navigator.onLine && this.supabase) {
      try {
        const { error } = await this.supabase
          .from('gdrums_user_rhythms')
          .update({ name, bpm, updated_at: rhythm.updated_at })
          .eq('id', id);
        if (!error) {
          rhythm.synced = true;
          this.saveLocal();
        }
      } catch { /* sincroniza depois */ }
    }
  }

  async delete(id: string): Promise<void> {
    this.rhythms = this.rhythms.filter(r => r.id !== id);
    this.saveLocal();

    if (navigator.onLine && this.supabase) {
      try {
        await this.supabase
          .from('gdrums_user_rhythms')
          .delete()
          .eq('id', id);
      } catch { /* já removeu local */ }
    }
  }

  getAll(): UserRhythm[] {
    return this.rhythms;
  }

  getById(id: string): UserRhythm | undefined {
    return this.rhythms.find(r => r.id === id);
  }

  // ─── Sync ─────────────────────────────────────────────────────────

  private async syncPending(): Promise<void> {
    if (!this.supabase || !this.userId) return;

    const pending = this.rhythms.filter(r => !r.synced);
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
        }
      } catch { break; /* sem rede */ }
    }

    if (pending.some(r => r.synced)) {
      this.saveLocal();
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
  }

  private saveLocal(): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.rhythms));
    } catch { /* storage full */ }
  }
}
