// Gerenciamento de setlists (MÚLTIPLOS repertórios) — Supabase + cache local.
//
// REGRA DE OURO: nunca, jamais, em hipótese alguma, perder repertório do user.
// Setlist é o trabalho dele — montar pode levar meses. Preferimos manter um
// item duplicado por engano do que perder um setlist legítimo.
//
// Defesas implementadas:
// 1. Timestamp em cada edição (lastModified) — quem é mais novo ganha
// 2. NUNCA aceitar banco vazio sobrescrevendo local com itens (caso típico
//    de outro device ter zerado setlist por bug)
// 3. Backup local nunca é apagado por logout/troca de sessão
// 4. initWithUser faz MERGE inteligente quando ambos os lados têm dados
//
// v2 (2026-06): MÚLTIPLOS repertórios (até MAX_SETLISTS). User toca na
// igreja, no pagode, no sertanejo — cada contexto tem seu repertório.
// - API pública antiga (getItems/next/addItem/...) continua operando no
//   repertório ATIVO — consumidores (main.ts, SetlistEditorUI) não quebram.
// - Storage local: chave nova 'gdrums-setlists-v2'. Migração automática do
//   formato antigo ('gdrums-setlist') na primeira carga.
// - Supabase: coluna nova `setlists` (jsonb) na gdrums_favorites. Os campos
//   antigos items/current_index continuam recebendo o repertório ativo
//   (dual-write) pra apps antigos em outros devices não quebrarem.

import type { Setlist, SetlistItem } from '../types';
import { persistSet, persistGet, requestPersistentStorage } from '../utils/persistentStore';
import { withNetTimeout } from '../utils/netTimeout';
import { t } from '../i18n';

const LOCAL_KEY_V2 = 'gdrums-setlists-v2';
const LOCAL_BACKUP_KEY_V2 = 'gdrums-setlists-v2-backup';
const IDB_KEY_V2 = 'setlists-v2';
// Dono do conteúdo que está HOJE em LOCAL_KEY_V2. localStorage/IndexedDB
// não são namespaced por usuário — num device que já logou com MAIS DE
// UMA conta (device compartilhado da banda, reinstalação, celular
// emprestado), sem essa tag o repertório de uma pessoa vazava pra dentro
// da conta de outra (e o merge "quem é mais novo ganha" podia até
// SUBIR isso pro banco da conta errada). Ver isolamento em initWithUser.
const OWNER_KEY = 'gdrums-setlists-v2-owner';
const namespacedKey = (userId: string) => `gdrums-setlists-v2:${userId}`;

// Fila da LIXEIRA de suporte: cópias de repertórios excluídos esperando
// subir. Precisa de fila porque a exclusão acontece muito no palco, offline —
// mandar direto perderia exatamente o caso que a lixeira existe pra cobrir.
// Guardada fora do state do repertório de propósito: não é dado do usuário,
// não entra no merge e não pode virar repertório de novo por acidente.
const TRASH_QUEUE_KEY = 'gdrums-setlist-trash-queue';
const MAX_TRASH_QUEUE = 20;

// Chaves do formato antigo (v1) — só leitura, pra migração
const LEGACY_LOCAL_KEY = 'gdrums-setlist';
const LEGACY_BACKUP_KEY = 'gdrums-setlist-backup';
const LEGACY_IDB_KEY = 'setlist';

export const MAX_SETLISTS = 30;

export interface NamedSetlist extends Setlist {
  id: string;
  // Timestamp ms da última edição de CONTEÚDO deste repertório (add/remove/
  // mover música, renomear). NÃO é bumpado por navegação (next/prev/goTo).
  // A união usa isso pra "mais recente ganha" no mesmo id — assim remover
  // música ou reordenar PROPAGA entre aparelhos, não só adicionar.
  lastModified?: number;
  // true = veio de um link compartilhado (importado). Borda amarela na UI;
  // some quando o usuário renomeia o repertório.
  sharedImport?: boolean;
}

interface MultiSetlistState {
  setlists: NamedSetlist[];
  activeId: string;
  lastModified?: number; // timestamp ms da última edição (do device que editou)
  // Tombstones: ids de repertórios EXCLUÍDOS. Sem isso, a união ressuscitaria
  // o repertório apagado (ele ainda existe no servidor/outro aparelho). O
  // tombstone viaja junto (local + servidor), então a exclusão PROPAGA: o
  // outro aparelho vê o id na lista de excluídos e remove também.
  deletedSetlists?: string[];
}

// Teto do histórico de exclusões (ids são pequenos; 500 cobre de sobra).
const MAX_TOMBSTONES = 500;

function genId(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ||
    String(Date.now()) + Math.random().toString(16).slice(2);
}

function emptyState(): MultiSetlistState {
  const id = genId();
  return {
    setlists: [{ id, name: t('core.setlist.defaultName'), items: [], currentIndex: 0 }],
    activeId: id,
    lastModified: 0,
  };
}

export class SetlistManager {
  private state: MultiSetlistState;
  private onChange?: () => void;
  private userId: string | null = null;
  private supabaseClient: any = null;
  // true = a última tentativa de saveRemote() falhou (ou nem foi tentada
  // porque userId/supabaseClient ainda não estavam prontos) — sem isso,
  // uma falha de rede no meio de uma edição fica perdida pra sempre: só
  // a PRÓXIMA edição do usuário dispara um novo saveRemote(), então um
  // repertório que parou de ser editado depois da falha nunca sincroniza.
  private remoteDirty = false;
  // Avisa a UI (botão "Baixar e sincronizar") quando o repertório sobe
  // pro servidor ou volta a ficar pendente — inclusive nos syncs automáticos
  // (online/foreground/intervalo). Mantém o botão verde sozinho.
  private onRemoteStateChange?: () => void;

  /** Registra um observador chamado quando o estado remoto muda. */
  setOnRemoteStateChange(cb: () => void): void {
    this.onRemoteStateChange = cb;
  }

  constructor() {
    this.state = this.loadLocal();
    // Storage persistente (Chrome/Firefox) — pede ao browser pra não apagar
    // IndexedDB quando disco encher. Idempotente, fire-and-forget.
    requestPersistentStorage().catch(() => { /* noop */ });
    // Se localStorage estava vazio mas IndexedDB pode ter backup, recupera
    // assíncrono. Cobre o caso onde o browser limpou localStorage mas
    // preservou IndexedDB (cenário comum em Safari iOS).
    if (this.totalItemCount() === 0) {
      this.tryRestoreFromIndexedDB();
    }
    // Retry de reconexão + periódico — mesma defesa que o UserRhythmService
    // tem pro badge "pendente sync". Sem isso, uma falha silenciosa de
    // saveRemote() (rede ruim, ou edição feita antes do initWithUser
    // terminar de injetar userId/supabaseClient) deixa o repertório
    // desatualizado no servidor até a PRÓXIMA edição local acontecer.
    // "Empurra tudo" SEMPRE — não depende da flag remoteDirty. Cada push é um
    // MERGE (lê o servidor, junta por id, reescreve a UNIÃO). Assim dois
    // aparelhos convergem pra união de tudo, sem um sobrescrever o outro.
    // Funciona em wifi ou dados móveis (navigator.onLine cobre os dois).
    // A lixeira de suporte pega carona nos mesmos gatilhos: quem exclui
    // repertório costuma estar no palco, offline, e a cópia fica esperando.
    window.addEventListener('online', () => { void this.mergePush(); void this.flushTrash(); });
    setInterval(() => {
      if (navigator.onLine && this.userId && this.supabaseClient) {
        void this.mergePush();
        void this.flushTrash();
      }
    }, 60000);

    // App voltou pra FRENTE (foreground) → junta e sobe na hora. No celular o
    // app quase nunca "abre do zero" (initWithUser não roda), só volta do 2º
    // plano — e o timer fica suspenso em background. Sem isso, edição offline
    // só ressincronizava no próximo boot real.
    const syncOnResume = (): void => {
      if (navigator.onLine && this.userId && this.supabaseClient) void this.mergePush();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncOnResume();
    });
    window.addEventListener('focus', syncOnResume);
  }

  // ─── Helpers internos ───────────────────────────────────────────────

  /** Repertório ativo — toda a API v1 opera nele. */
  private active(): NamedSetlist {
    const found = this.state.setlists.find(s => s.id === this.state.activeId);
    if (found) return found;
    // activeId órfão (corrupção/migração) — adota o primeiro
    if (this.state.setlists.length === 0) {
      this.state = emptyState();
    }
    this.state.activeId = this.state.setlists[0].id;
    return this.state.setlists[0];
  }

  private totalItemCount(): number {
    return this.state.setlists.reduce((n, s) => n + s.items.length, 0);
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

  private async tryRestoreFromIndexedDB(): Promise<void> {
    try {
      // v2 primeiro
      const recovered = await persistGet<MultiSetlistState>(IDB_KEY_V2);
      if (recovered && Array.isArray(recovered.setlists) &&
          recovered.setlists.reduce((n, s) => n + (s.items?.length || 0), 0) > 0) {
        if (this.totalItemCount() === 0 && !this.ownedByOther()) {
          console.warn('[SetlistManager] Recuperando setlists v2 do IndexedDB');
          this.state = this.normalizeState(recovered);
          this.writeToLocalStorage();
          this.onChange?.();
        }
        return;
      }
      // Fallback: IDB do formato v1 (pré-migração)
      const legacy = await persistGet<Setlist & { lastModified?: number }>(LEGACY_IDB_KEY);
      if (legacy && Array.isArray(legacy.items) && legacy.items.length > 0 &&
          this.totalItemCount() === 0 && !this.ownedByOther()) {
        console.warn('[SetlistManager] Recuperando setlist v1 do IndexedDB:', legacy.items.length, 'itens');
        const id = genId();
        this.state = {
          setlists: [{ id, name: legacy.name || t('core.setlist.defaultName'), items: legacy.items, currentIndex: legacy.currentIndex || 0 }],
          activeId: id,
          lastModified: legacy.lastModified || 0,
        };
        this.writeToLocalStorage();
        this.onChange?.();
      }
    } catch { /* IDB pode não estar disponível */ }
  }

  /**
   * Garante que `this.state` pertence de fato a `userId` antes de
   * qualquer merge com o servidor.
   *
   * localStorage/IndexedDB são globais ao device, não por conta. Se
   * este device já foi usado por OUTRA conta (device compartilhado,
   * celular emprestado, reinstalação), o que o construtor carregou de
   * `LOCAL_KEY_V2` pode ser dela — e o merge por timestamp do
   * initWithUser podia então UPLOAD esse repertório alheio pra dentro
   * da conta de quem está logando agora.
   *
   * Sem tag de dono (device "virgem" ou dado de antes deste fix):
   * assume que é do usuário atual (migração — não reseta ninguém à toa).
   * Com tag de dono DIFERENTE: arquiva o conteúdo pro dono antigo (pra
   * ele não perder nada se voltar a logar neste device) e troca `this.state`
   * pelo backup namespaced deste usuário (se existir neste device) ou
   * um estado vazio — nunca herda o conteúdo de outra conta.
   */
  private isolateFromOtherAccounts(userId: string): void {
    let owner: string | null = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch { /* noop */ }

    if (owner && owner !== userId) {
      console.warn(`[SetlistManager] Local pertence a outra conta (${owner}) — isolando de ${userId}`);
      try {
        // Arquiva o valor BRUTO de LOCAL_KEY_V2, não `this.state` — o
        // loadLocal() do construtor pode ter trocado this.state pelo
        // conteúdo do backup GLOBAL (gdrums-setlists-v2-backup, também
        // não namespaced) quando a chave principal estava vazia. Esse
        // backup pode já pertencer a um dono ainda mais antigo que
        // `owner`. Ler a chave principal direto evita arquivar dado
        // errado sob a tag de `owner` (achado testando troca de conta
        // duas vezes seguidas no mesmo device — ver test/isolation-test.ts).
        const raw = localStorage.getItem(LOCAL_KEY_V2);
        if (raw) localStorage.setItem(namespacedKey(owner), raw);
      } catch { /* localStorage cheio — tolera */ }

      const own = this.tryParseState(localStorage.getItem(namespacedKey(userId)));
      this.state = own || emptyState();
      this.writeToLocalStorage();
      this.onChange?.();
    }

    if (owner !== userId) {
      try { localStorage.setItem(OWNER_KEY, userId); } catch { /* noop */ }
    }
  }

  // ─── Init com Supabase (chamado após auth) ──────────────────────────

  async initWithUser(userId: string, supabase: any): Promise<void> {
    this.userId = userId;
    this.supabaseClient = supabase;
    this.isolateFromOtherAccounts(userId);

    // Offline: mantém local. Quando voltar online, saveRemote vai sincronizar.
    if (!navigator.onLine) { if (this.totalItemCount() > 0) this.remoteDirty = true; return; }

    try {
      // withNetTimeout: navigator.onLine MENTE offline (Android WebView / PC
      // com WiFi-sem-internet). Sem timeout, esta query pendura no TCP do SO
      // e como isto é AWAITED no boot (main.ts), o app trava eternamente no
      // "carregando" — mesmo com o checkAccess já corrigido. O builder do
      // Supabase é thenable, por isso o Promise.resolve(...).
      const { data, error } = await withNetTimeout(Promise.resolve(
        supabase
          .from('gdrums_favorites')
          .select('items, current_index, setlists, updated_at')
          .eq('user_id', userId)
          .maybeSingle()
      )) as { data: any; error: any };

      // Erro de rede — preserva local intacto
      if (error) {
        console.warn('[SetlistManager] Falha ao ler banco:', error);
        if (this.totalItemCount() > 0) this.remoteDirty = true;
        return;
      }

      // Estado remoto (coluna nova `setlists` ou reconstruído do legado items)
      const remoteState = this.remoteStateFrom(data);

      // JUNTA TUDO: união local + remoto POR ID de repertório — nunca perde
      // repertório de nenhum aparelho. Se ambos têm o MESMO repertório (mesmo
      // id) com conteúdos diferentes, fica com o que tem MAIS músicas (nunca
      // encolhe). Depois grava a UNIÃO de volta pro servidor ficar completo.
      // Cobre também "banco vazio + local cheio" (união = local) e "local
      // vazio + banco cheio" (união = remoto).
      const beforeIds = this.state.setlists.map(s => s.id).sort().join(',');
      this.state = this.unionSetlists(this.state, remoteState);
      const afterIds = this.state.setlists.map(s => s.id).sort().join(',');
      if (beforeIds !== afterIds) { this.saveLocal(); this.onChange?.(); }

      await this.mergePush();
    } catch (e) {
      // Timeout de rede (onLine mentiu) ou erro — preserva local e marca
      // dirty pra o retry (evento 'online' / intervalo 20s) ressincronizar
      // quando a rede voltar de verdade.
      console.warn('[SetlistManager] Erro/timeout no initWithUser, preservando local:', e);
      if (this.totalItemCount() > 0) this.remoteDirty = true;
    }
  }

  // ─── Callbacks ──────────────────────────────────────────────────────

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  private notify(): void {
    // Toda mudança atualiza o timestamp local — fundamental pra o merge
    // saber "qual lado é mais novo".
    this.state.lastModified = Date.now();
    this.saveLocal();
    // Sync remoto é DEBOUNCED: notify() dispara em toda navegação de música
    // (next/previous/goTo = cada toque de pedal no show). Sem debounce, o
    // merge-push (que lê+escreve no Supabase) rodaria a cada toque. Coalesce
    // rajadas num único push ~2.5s depois da última mudança. O intervalo de
    // 60s + foreground são a rede de segurança se o app fechar antes disso.
    this.scheduleRemoteSync();
    this.onChange?.();
  }

  private remoteSyncTimer: number | null = null;

  /** Agenda um merge-push coalescido (debounce). Reinicia a cada chamada. */
  private scheduleRemoteSync(): void {
    this.remoteDirty = true; // há mudança local ainda não confirmada no servidor
    if (this.remoteSyncTimer !== null) clearTimeout(this.remoteSyncTimer);
    this.remoteSyncTimer = window.setTimeout(() => {
      this.remoteSyncTimer = null;
      void this.mergePush();
    }, 2500);
  }

  // ─── API de MÚLTIPLOS repertórios ───────────────────────────────────

  getSetlists(): Array<{ id: string; name: string; count: number; active: boolean; shared: boolean }> {
    return this.state.setlists.map(s => ({
      id: s.id,
      name: s.name,
      count: s.items.length,
      active: s.id === this.state.activeId,
      shared: s.sharedImport === true,
    }));
  }

  getActiveSetlistId(): string {
    return this.active().id;
  }

  /** Troca o repertório ativo. Retorna false se id não existe. */
  switchSetlist(id: string): boolean {
    if (!this.state.setlists.some(s => s.id === id)) return false;
    if (this.state.activeId === id) return true;
    this.state.activeId = id;
    this.notify();
    return true;
  }

  /** Cria repertório novo (e ativa). Retorna null se bateu o limite.
   *  sharedImport=true marca como "compartilhado" (borda amarela). */
  createSetlist(name: string, sharedImport = false): string | null {
    if (this.state.setlists.length >= MAX_SETLISTS) return null;
    const id = genId();
    const cleanName = (name || '').trim() || t('core.setlist.numbered', { n: this.state.setlists.length + 1 });
    this.state.setlists.push({ id, name: cleanName.slice(0, 40), items: [], currentIndex: 0, lastModified: Date.now(), ...(sharedImport ? { sharedImport: true } : {}) });
    this.state.activeId = id;
    this.notify();
    return id;
  }

  /** Carimba a hora da última edição de CONTEÚDO do repertório — usado pela
   *  união pra decidir "mais recente ganha" no mesmo id. */
  private touch(s: NamedSetlist): void {
    s.lastModified = Date.now();
  }

  renameSetlist(id: string, name: string): boolean {
    const s = this.state.setlists.find(x => x.id === id);
    if (!s) return false;
    const cleanName = (name || '').trim();
    if (!cleanName) return false;
    s.name = cleanName.slice(0, 40);
    s.sharedImport = false; // renomeou → tira a marca de compartilhado
    this.touch(s);
    this.notify();
    return true;
  }

  /** Exclui repertório. Não deixa excluir o último (sempre existe 1).
   *  Marca um TOMBSTONE (id excluído) que viaja pro servidor e pros outros
   *  aparelhos — assim a exclusão PROPAGA em vez de a união ressuscitar. */
  deleteSetlist(id: string): boolean {
    if (this.state.setlists.length <= 1) return false;
    const idx = this.state.setlists.findIndex(x => x.id === id);
    if (idx === -1) return false;
    this.queueTrash(this.state.setlists[idx]);
    this.state.setlists.splice(idx, 1);
    if (this.state.activeId === id) {
      this.state.activeId = this.state.setlists[Math.max(0, idx - 1)].id;
    }
    if (!this.state.deletedSetlists) this.state.deletedSetlists = [];
    if (!this.state.deletedSetlists.includes(id)) {
      this.state.deletedSetlists.push(id);
      if (this.state.deletedSetlists.length > MAX_TOMBSTONES) {
        this.state.deletedSetlists = this.state.deletedSetlists.slice(-MAX_TOMBSTONES);
      }
    }
    this.notify();
    return true;
  }

  getMaxSetlists(): number { return MAX_SETLISTS; }

  /** Itens de um repertório específico por id (cópia). Usado pra compartilhar. */
  getItemsOf(id: string): SetlistItem[] {
    const s = this.state.setlists.find(x => x.id === id);
    return s ? s.items.map(i => ({ ...i })) : [];
  }
  /** Nome de um repertório específico por id. */
  getNameOf(id: string): string {
    const s = this.state.setlists.find(x => x.id === id);
    return s ? s.name : '';
  }

  /** Duplica um repertório (itens copiados, nome "X (cópia)"). Null se bateu o limite. */
  duplicateSetlist(id: string): string | null {
    if (this.state.setlists.length >= MAX_SETLISTS) return null;
    const src = this.state.setlists.find(x => x.id === id);
    if (!src) return null;
    const newId = genId();
    this.state.setlists.push({
      id: newId,
      name: t('core.setlist.copyName', { name: src.name }).slice(0, 40),
      items: src.items.map(i => ({ ...i })),
      currentIndex: 0,
      lastModified: Date.now(),
    });
    this.notify();
    return newId;
  }

  /** Adiciona item num repertório ESPECÍFICO sem trocar o ativo.
   *  Usado pelo "salvar ritmo → escolher repertório de destino". */
  addItemTo(setlistId: string, item: SetlistItem): boolean {
    const s = this.state.setlists.find(x => x.id === setlistId);
    if (!s) return false;
    s.items.push(item);
    this.touch(s);
    this.notify();
    return true;
  }

  // ─── Getters (API v1 — operam no repertório ATIVO) ──────────────────

  getItems(): SetlistItem[] { return this.active().items; }
  getLength(): number { return this.active().items.length; }
  getCurrentIndex(): number { return this.active().currentIndex; }
  isEmpty(): boolean { return this.active().items.length === 0; }
  getName(): string { return this.active().name; }

  getCurrentItem(): SetlistItem | null {
    const a = this.active();
    return a.items[a.currentIndex] || null;
  }

  getNextItem(): SetlistItem | null {
    const a = this.active();
    return a.items[a.currentIndex + 1] || null;
  }

  getPreviousItem(): SetlistItem | null {
    const a = this.active();
    return a.items[a.currentIndex - 1] || null;
  }

  // ─── Navigation ─────────────────────────────────────────────────────

  next(): SetlistItem | null {
    const a = this.active();
    if (a.currentIndex < a.items.length - 1) {
      a.currentIndex++;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  previous(): SetlistItem | null {
    const a = this.active();
    if (a.currentIndex > 0) {
      a.currentIndex--;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  goTo(index: number): SetlistItem | null {
    const a = this.active();
    if (index >= 0 && index < a.items.length) {
      a.currentIndex = index;
      this.notify();
      return this.getCurrentItem();
    }
    return null;
  }

  // ─── CRUD (no repertório ativo) ─────────────────────────────────────

  addItem(item: SetlistItem): void {
    const a = this.active();
    a.items.push({ ...item });
    this.touch(a);
    this.notify();
  }

  removeItem(index: number): void {
    const a = this.active();
    if (index < 0 || index >= a.items.length) return;
    a.items.splice(index, 1);
    if (a.currentIndex >= a.items.length) {
      a.currentIndex = Math.max(0, a.items.length - 1);
    }
    this.touch(a);
    this.notify();
  }

  moveItem(fromIndex: number, toIndex: number): void {
    const a = this.active();
    const items = a.items;
    if (fromIndex < 0 || fromIndex >= items.length) return;
    if (toIndex < 0 || toIndex >= items.length) return;

    const [item] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, item);

    if (a.currentIndex === fromIndex) {
      a.currentIndex = toIndex;
    } else if (fromIndex < a.currentIndex && toIndex >= a.currentIndex) {
      a.currentIndex--;
    } else if (fromIndex > a.currentIndex && toIndex <= a.currentIndex) {
      a.currentIndex++;
    }

    this.touch(a);
    this.notify();
  }

  clear(): void {
    const a = this.active();
    a.items = [];
    a.currentIndex = 0;
    this.touch(a);
    this.notify();
  }

  setName(name: string): void {
    const a = this.active();
    a.name = name;
    this.touch(a);
    this.saveLocal();
  }

  // ─── Persistência Local (cache) ─────────────────────────────────────

  private saveLocal(): void {
    this.writeToLocalStorage();
    // IndexedDB em paralelo (fire-and-forget) — última linha de defesa.
    // Só grava estados com itens (não sobrescreve IDB bom com vazio).
    if (this.totalItemCount() > 0) {
      persistSet(IDB_KEY_V2, this.state).catch(() => { /* noop */ });
    }
  }

  private writeToLocalStorage(): void {
    try {
      const serialized = JSON.stringify(this.state);
      localStorage.setItem(LOCAL_KEY_V2, serialized);
      // Backup secundário — não sobrescreve backup bom com vazio
      if (this.totalItemCount() > 0) {
        localStorage.setItem(LOCAL_BACKUP_KEY_V2, serialized);
      }
      // Espelho namespaced por conta — permite restaurar certo se ESTE
      // usuário voltar a usar este mesmo device depois de outra conta
      // ter usado no meio (ver isolateFromOtherAccounts).
      if (this.userId) {
        localStorage.setItem(namespacedKey(this.userId), serialized);
      }
    } catch { /* localStorage cheio — toleramos */ }
  }

  private loadLocal(): MultiSetlistState {
    // 1. Formato v2 (principal, depois backup)
    const main = this.tryParseState(localStorage.getItem(LOCAL_KEY_V2));
    if (main && main.setlists.reduce((n, s) => n + s.items.length, 0) > 0) return main;

    const backup = this.tryParseState(localStorage.getItem(LOCAL_BACKUP_KEY_V2));
    if (backup && backup.setlists.reduce((n, s) => n + s.items.length, 0) > 0) {
      console.warn('[SetlistManager] v2 principal vazio, recuperando do backup');
      return backup;
    }

    // 2. MIGRAÇÃO do formato v1 ('gdrums-setlist') — primeira carga após
    //    o update. O setlist único antigo vira o primeiro repertório.
    const legacy = this.tryParseLegacy(localStorage.getItem(LEGACY_LOCAL_KEY)) ||
                   this.tryParseLegacy(localStorage.getItem(LEGACY_BACKUP_KEY));
    if (legacy && legacy.items.length > 0) {
      console.warn('[SetlistManager] Migrando setlist v1 → v2 (' + legacy.items.length + ' itens)');
      const id = genId();
      const migrated: MultiSetlistState = {
        setlists: [{ id, name: legacy.name || t('core.setlist.defaultName'), items: legacy.items, currentIndex: legacy.currentIndex || 0 }],
        activeId: id,
        lastModified: legacy.lastModified || 0,
      };
      // NÃO apagar as chaves v1 — se o user voltar pra versão antiga do
      // app, o repertório dele continua lá. Custo: alguns KB.
      return migrated;
    }

    // 3. Nada em lugar nenhum — estado vazio com 1 repertório default
    return main || emptyState();
  }

  private tryParseState(raw: string | null): MultiSetlistState | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.setlists)) return null;
      return this.normalizeState(parsed);
    } catch { return null; }
  }

  private normalizeState(parsed: any): MultiSetlistState {
    const setlists: NamedSetlist[] = (Array.isArray(parsed.setlists) ? parsed.setlists : [])
      .slice(0, MAX_SETLISTS)
      .map((s: any, i: number) => ({
        id: typeof s.id === 'string' && s.id ? s.id : genId(),
        name: typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, 40) : t('core.setlist.numbered', { n: i + 1 }),
        items: Array.isArray(s.items) ? s.items : [],
        currentIndex: typeof s.currentIndex === 'number' ? s.currentIndex : 0,
        lastModified: typeof s.lastModified === 'number' ? s.lastModified : 0,
        ...(s.sharedImport === true ? { sharedImport: true } : {}),
      }));
    if (setlists.length === 0) return emptyState();
    const activeId = setlists.some(s => s.id === parsed.activeId)
      ? parsed.activeId
      : setlists[0].id;
    const deletedSetlists = Array.isArray(parsed.deletedSetlists)
      ? parsed.deletedSetlists.filter((x: any) => typeof x === 'string').slice(-MAX_TOMBSTONES)
      : undefined;
    return {
      setlists,
      activeId,
      lastModified: typeof parsed.lastModified === 'number' ? parsed.lastModified : 0,
      ...(deletedSetlists && deletedSetlists.length ? { deletedSetlists } : {}),
    };
  }

  private tryParseLegacy(raw: string | null): (Setlist & { lastModified?: number }) | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        name: parsed.name || t('core.setlist.defaultName'),
        items: Array.isArray(parsed.items) ? parsed.items : [],
        currentIndex: typeof parsed.currentIndex === 'number' ? parsed.currentIndex : 0,
        lastModified: typeof parsed.lastModified === 'number' ? parsed.lastModified : 0,
      };
    } catch { return null; }
  }

  // ─── Persistência Supabase ──────────────────────────────────────────

  /** true se a última tentativa de subir o repertório falhou (ou nunca
   *  rodou) — usado pelo botão/bolinha pra saber se há pendência. */
  isRemoteDirty(): boolean {
    return this.remoteDirty;
  }

  /** Botão "Baixar e sincronizar": junta local+servidor e sobe a UNIÃO. */
  async forceSyncNow(): Promise<{ ok: boolean; error?: string }> {
    return this.mergePush();
  }

  /** Reconstrói o MultiSetlistState do que veio da linha gdrums_favorites.
   *  Prioriza a coluna nova `setlists`; senão reconstrói do legado
   *  items/current_index. Retorna null se a linha não existe / sem dado. */
  private remoteStateFrom(data: any): MultiSetlistState | null {
    if (!data) return null;
    let remoteState: MultiSetlistState | null = null;
    if (data.setlists && Array.isArray(data.setlists?.setlists)) {
      remoteState = this.normalizeState(data.setlists as MultiSetlistState);
      // App ANTIGO pode ter gravado só a coluna legada `items` depois. Se
      // divergir do repertório ativo e NÃO for encolhimento drástico, adota
      // (não perde edição de app velho); se encolheu muito, ignora.
      if (Array.isArray(data.items) && data.items.length > 0) {
        const act = remoteState.setlists.find(s => s.id === remoteState!.activeId);
        if (act && JSON.stringify(act.items) !== JSON.stringify(data.items)) {
          const shrunk = data.items.length < act.items.length * 0.9;
          if (!shrunk) {
            act.items = data.items;
            act.currentIndex = Math.min(
              typeof data.current_index === 'number' ? data.current_index : 0,
              Math.max(0, data.items.length - 1)
            );
          }
        }
      }
    } else if (Array.isArray(data.items) && data.items.length > 0) {
      const id = genId();
      remoteState = {
        setlists: [{ id, name: t('core.setlist.defaultName'), items: data.items, currentIndex: typeof data.current_index === 'number' ? data.current_index : 0 }],
        activeId: id,
      };
    }
    return remoteState;
  }

  /** UNIÃO de dois estados POR ID de repertório — nunca perde repertório de
   *  nenhum lado. Mesmo id nos dois → fica com o MAIS RECENTE (lastModified);
   *  assim remover música/reordenar propaga, não só adicionar. Sem timestamp
   *  (dado legado) cai no fallback "mais músicas ganha" (nunca encolhe).
   *  Respeita TOMBSTONES: id excluído em qualquer lado é removido dos dois.
   *  Preserva o activeId local. */
  private unionSetlists(local: MultiSetlistState, remote: MultiSetlistState | null): MultiSetlistState {
    // Excluídos = união dos tombstones dos dois lados
    const deleted = new Set<string>([
      ...(local.deletedSetlists || []),
      ...(remote?.deletedSetlists || []),
    ]);

    const byId = new Map<string, NamedSetlist>();
    if (remote && Array.isArray(remote.setlists)) {
      for (const s of remote.setlists) byId.set(s.id, s);
    }
    for (const s of local.setlists) {
      const ex = byId.get(s.id);
      if (!ex) { byId.set(s.id, s); continue; }
      // Mesmo id nos dois: decide quem fica.
      const lm = s.lastModified || 0;
      const em = ex.lastModified || 0;
      if (lm !== em) {
        // Timestamps existem e diferem → o MAIS RECENTE ganha (propaga
        // remoção/reordenação, não só adição).
        if (lm > em) byId.set(s.id, s);
      } else {
        // Sem timestamp ou empate → fallback conservador: nunca encolhe.
        if (s.items.length >= ex.items.length) byId.set(s.id, s);
      }
    }
    // Remove os excluídos (tombstones) da união — exclusão propaga
    for (const id of deleted) byId.delete(id);

    let setlists = Array.from(byId.values()).slice(0, MAX_SETLISTS);
    // Invariante: sempre existe pelo menos 1 repertório
    if (setlists.length === 0) setlists = emptyState().setlists;

    let activeId = local.activeId;
    if (!setlists.some(s => s.id === activeId)) {
      activeId = (remote && setlists.some(s => s.id === remote.activeId)) ? remote.activeId : setlists[0].id;
    }

    const deletedArr = Array.from(deleted).slice(-MAX_TOMBSTONES);
    return {
      setlists,
      activeId,
      lastModified: Math.max(local.lastModified || 0, remote?.lastModified || 0),
      ...(deletedArr.length ? { deletedSetlists: deletedArr } : {}),
    };
  }

  /** Garante userId + client Supabase. Se o initWithUser não rodou (net ruim
   *  no boot, clicou cedo), busca a sessão atual na hora — evita o "sessão
   *  não iniciada" que só saía fechando/reabrindo o app. */
  private async ensureSession(): Promise<boolean> {
    try {
      const { supabase } = await import('../auth/supabase');
      // getSession() do supabase-js RENOVA sozinho quando o token esta
      // vencido ou perto disso. Sem rede so quando ha renovacao de verdade —
      // no caso normal e leitura local, entao da pra chamar sempre.
      //
      // BUG ANTIGO: a gente devolvia true direto quando ja tinha o userId
      // guardado, e ai nunca mais conferia nada. O token vencia (app aberto
      // ha horas, ou celular que dormiu e o timer de refresh nao rodou), o
      // ensureSession seguia dizendo que estava tudo bem, e a sincronizacao
      // batia no servidor com token morto. Por isso "sair e entrar" resolvia:
      // era a unica forma de pegar token novo.
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (uid) {
        this.supabaseClient = supabase;
        this.userId = uid;
        return true;
      }
    } catch { /* offline/sem sessao */ }
    // Sem sessao boa agora: se ja houve uma antes, seguimos com ela — offline
    // a fila local continua funcionando e sobe quando a rede voltar.
    return !!(this.userId && this.supabaseClient);
  }

  // ─── LIXEIRA DE SUPORTE ────────────────────────────────────────────────
  // Excluir repertório é DEFINITIVO e PROPAGA: o tombstone viaja pro servidor
  // e mata a lista nos outros aparelhos. Um cliente já perdeu um repertório de
  // 14 músicas com um toque acidental. As MÚSICAS sempre sobrevivem (moram em
  // gdrums_user_rhythms, tabela separada) — o que some é a LISTA que agrupava
  // elas, e remontar na mão leva tempo.
  //
  // Então toda exclusão deixa uma cópia no servidor. NÃO existe interface pra
  // isso no app, de propósito: quem acessa é o suporte, quando o cliente pede.
  // Um "desfazer" visível teria que reviver o id excluído nos outros aparelhos
  // e brigar com o tombstone — problema bem maior do que resolve.

  /** Enfileira a cópia e tenta subir. Nunca lança: se a lixeira falhar, a
   *  exclusão em si tem que acontecer do mesmo jeito. */
  private queueTrash(s: NamedSetlist): void {
    try {
      // Lista vazia não tem o que recuperar — não suja a lixeira.
      if (!s || !Array.isArray(s.items) || s.items.length === 0) return;
      const q = this.readTrashQueue();
      q.push({
        id: s.id,
        name: s.name,
        items: s.items.map(i => ({ ...i })),
        deletedAt: new Date().toISOString(),
      });
      // Corta os mais ANTIGOS: numa faxina de repertórios, o que o cliente
      // reclama depois costuma ser o último que ele apagou.
      localStorage.setItem(TRASH_QUEUE_KEY, JSON.stringify(q.slice(-MAX_TRASH_QUEUE)));
    } catch { /* localStorage cheio/bloqueado — segue a exclusão */ }
    void this.flushTrash();
  }

  private readTrashQueue(): any[] {
    try {
      const raw = localStorage.getItem(TRASH_QUEUE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  /** Sobe a fila pra lixeira do servidor. Só tira da fila o que o banco
   *  confirmou — falha de rede mantém a cópia esperando a próxima tentativa. */
  private async flushTrash(): Promise<void> {
    const q = this.readTrashQueue();
    if (q.length === 0) return;
    if (!navigator.onLine) return;
    if (!(await this.ensureSession())) return;

    const pendentes: any[] = [];
    for (const entry of q) {
      try {
        // Promise.resolve: o builder do Supabase é thenable, não Promise real.
        const { error } = await withNetTimeout<any>(
          Promise.resolve(this.supabaseClient.rpc('setlist_trash_add', { p_setlist: entry })),
          8000,
        );
        if (error) pendentes.push(entry);
      } catch {
        // Timeout/rede: guarda o resto sem tentar (a conexão está ruim agora).
        pendentes.push(entry);
      }
    }
    try {
      if (pendentes.length) localStorage.setItem(TRASH_QUEUE_KEY, JSON.stringify(pendentes));
      else localStorage.removeItem(TRASH_QUEUE_KEY);
    } catch { /* noop */ }
  }

  /**
   * MERGE-PUSH: lê o servidor, JUNTA com o local por id (união) e reescreve
   * a união de volta. É o que faz dois aparelhos convergirem pra soma de
   * tudo, sem um sobrescrever o outro. Idempotente. Devolve motivo da falha.
   */
  private async mergePush(): Promise<{ ok: boolean; error?: string }> {
    if (!navigator.onLine) {
      this.remoteDirty = true;
      return { ok: false, error: t('core.sync.noInternet') };
    }
    if (!(await this.ensureSession())) {
      this.remoteDirty = true;
      return { ok: false, error: t('core.sync.sessionNotStarted') };
    }
    try {
      // 1) Lê o estado atual do servidor
      const { data, error } = await withNetTimeout(Promise.resolve(
        this.supabaseClient
          .from('gdrums_favorites')
          .select('items, current_index, setlists, updated_at')
          .eq('user_id', this.userId)
          .maybeSingle()
      )) as { data: any; error: any };
      if (error) {
        this.remoteDirty = true;
        try { this.onRemoteStateChange?.(); } catch { /* noop */ }
        return { ok: false, error: error.message };
      }

      // 2) Junta local + remoto (união por id + tombstones)
      const remoteState = this.remoteStateFrom(data);
      // Assinatura inclui repertórios (id:qtdMúsicas) E a lista de excluídos —
      // pra detectar tanto conteúdo novo quanto exclusão a propagar.
      const sig = (st: MultiSetlistState | null): string => {
        if (!st) return '|';
        // inclui lastModified pra detectar edição que não muda a contagem
        // (reordenar, renomear) e não só add/remove de música.
        return st.setlists.map(s => `${s.id}:${s.items.length}:${s.lastModified || 0}`).sort().join(',') +
          '|' + [...(st.deletedSetlists || [])].sort().join(',');
      };
      const before = sig(this.state);
      this.state = this.unionSetlists(this.state, remoteState);
      const after = sig(this.state);
      if (before !== after) { this.saveLocal(); this.onChange?.(); }

      // 3) Só ESCREVE se houver algo local a subir: edição pendente
      //    (remoteDirty) OU o servidor não tem tudo que temos (repertório novo
      //    OU exclusão nova). Assim o pull periódico de quem está ocioso não
      //    gera write à toa — só leitura pra puxar de outro aparelho.
      const serverMissingOurs = sig(remoteState) !== after;
      if (!this.remoteDirty && !serverMissingOurs) {
        try { this.onRemoteStateChange?.(); } catch { /* noop */ }
        return { ok: true };
      }

      // Reescreve a UNIÃO (dual-write: coluna legada items = repertório ativo)
      const a = this.active();
      const { error: wErr } = await this.supabaseClient
        .from('gdrums_favorites')
        .upsert({
          user_id: this.userId,
          items: a.items,
          current_index: a.currentIndex,
          setlists: {
            setlists: this.state.setlists,
            activeId: this.state.activeId,
            deletedSetlists: this.state.deletedSetlists || [],
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      this.remoteDirty = !!wErr;
      try { this.onRemoteStateChange?.(); } catch { /* noop */ }
      return wErr ? { ok: false, error: wErr.message } : { ok: true };
    } catch (e: any) {
      this.remoteDirty = true;
      try { this.onRemoteStateChange?.(); } catch { /* noop */ }
      return { ok: false, error: e?.message || t('core.sync.networkFailure') };
    }
  }
}
