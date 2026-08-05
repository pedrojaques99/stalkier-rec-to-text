import type { RecorderState, Session, SessionSummary, Settings, StartOptions, WordCandidate } from '@stalkier/core';

/**
 * O contrato que cada casca implementa. É a única coisa que muda entre o app
 * público (IPC do Electron) e a aba do Jaques Studio (HTTP na API local) —
 * tudo o mais, layout, estados, teclado e decisões, é o mesmo componente.
 *
 * Adaptador é onde o formato do dado se acerta: a API do Studio devolve
 * `created_at`, o core fala `createdAt`, e a tradução acontece lá, não aqui.
 */
export interface RecorderApi {
  /** Falso quando a ponte com o processo principal não existe (ex.: página
   *  aberta no navegador, fora do app). A interface mostra o porquê em vez de
   *  um botão desabilitado, que prometeria uma ação que não vai acontecer. */
  available: boolean;

  start(opts: StartOptions): Promise<RecorderState>;
  stop(): Promise<RecorderState>;
  cancel(): Promise<RecorderState>;
  /** Também inscreve esta janela nos avisos. */
  state(): Promise<RecorderState>;
  onState(cb: (s: RecorderState) => void): () => void;
  onLevel(cb: (v: number) => void): () => void;
  shortcut(accelerator: string): Promise<unknown>;
  /** Tira o atalho do ar enquanto o campo de captura está focado. */
  pauseShortcut(pause: boolean): Promise<unknown>;

  listSessions(query: string): Promise<{ sessions: SessionSummary[]; month: MonthUsage }>;
  getSession(id: string): Promise<Session | null>;
  removeSession(id: string): Promise<unknown>;
  /** Onde o player busca a mídia: `media://id.mp3` num, rota HTTP no outro. */
  mediaUrl(id: string, kind: 'mp3' | 'mp4'): string;

  getSettings(): Promise<SettingsSnapshot>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  setKey(key: string): Promise<unknown>;
  testKey(): Promise<{ ok: boolean; error?: string }>;

  words(): Promise<WordCandidate[]>;
  getVocabulary(): Promise<string[]>;
  setVocabulary(list: string[]): Promise<string[]>;
}

export interface MonthUsage {
  cost: number;
  sessions: number;
  ms: number;
}

export interface SettingsSnapshot {
  settings: Settings;
  /** Só os últimos caracteres da chave. A chave inteira nunca chega à interface. */
  keyHint: string | null;
  /** A chave está no cofre do sistema, ou só na memória desta sessão. */
  encrypted: boolean;
  /** ffmpeg encontrado no PATH. */
  ffmpeg: boolean;
}
