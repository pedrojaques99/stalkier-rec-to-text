import type { RecorderState, Session, SessionSummary, Settings, StartOptions, Sweep, WordPanels } from '@stalkier/core';

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
  /** Atalho da gravação de tela, separado do ditado. */
  shortcutScreen(accelerator: string): Promise<unknown>;
  /** Tira o atalho do ar enquanto o campo de captura está focado. */
  pauseShortcut(pause: boolean): Promise<unknown>;

  listSessions(query: string): Promise<{ sessions: SessionSummary[]; month: MonthUsage }>;
  getSession(id: string): Promise<Session | null>;
  removeSession(id: string): Promise<unknown>;
  /** Onde o player busca a mídia: `media://id.mp3` num, rota HTTP no outro. */
  mediaUrl(id: string, kind: 'mp3' | 'mp4' | 'jpg'): string;
  /** Refaz só a transcrição. A mídia já está no disco e não se toca. */
  retranscribe(id: string): Promise<unknown>;
  /**
   * Guarda a sua versão do texto (HTML). Opcional: sem ela o editor fica só de
   * leitura, porque editor que perde o que você escreveu é pior que nenhum.
   * String vazia apaga a edição e devolve o texto limpo automático.
   */
  saveTranscript?(id: string, html: string): Promise<unknown>;
  /**
   * Manda o texto que está na tela pro modelo e devolve decisões, tarefas e
   * pendências. Opcional, e ainda por cima condicionado a `SettingsSnapshot.sweep`:
   * o método existe no app que TEM a rota, e a chave é que diz se ela funciona.
   */
  sweep?(id: string, text: string): Promise<Sweep>;
  /** Guarda a varredura de volta (marcar tarefa feita), ou `null` pra apagar. */
  saveSweep?(id: string, sweep: Sweep | null): Promise<unknown>;

  /**
   * Os picos da onda + a duração, já calculados do outro lado. Opcional: sem
   * ela não há modo de edição, e é assim de propósito — decodificar o mp4 de
   * uma aula de 40 min no navegador trava a aba antes de desenhar a primeira
   * barra, então "sem rota" tem que significar "sem botão", não "com espera".
   */
  peaks?(id: string): Promise<{ peaks: number[]; duration: number }>;
  /**
   * Salva um trecho (e, se houver vídeo, um recorte do quadro) como gravação
   * nova. `crop` vem em pixels da mídia ORIGINAL. Devolve o id do corte.
   *
   * Opcional pelo mesmo motivo do `sweep`: o botão de tesoura só aparece no
   * app que tem a rota. Quem não tem continua com a tela de hoje, inteira.
   */
  exportClip?(id: string, cut: ClipCut): Promise<{ id: string }>;

  getSettings(): Promise<SettingsSnapshot>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  setKey(key: string): Promise<unknown>;
  testKey(): Promise<{ ok: boolean; error?: string }>;

  /** Os quatro cartões da lateral de uma vez: varrer as sessões quatro vezes é varrer três a mais. */
  words(): Promise<WordPanels>;
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
  /** Há chave de LLM pro "varrer"? Sem ela o botão não aparece. */
  sweep?: boolean;
  /** Só os últimos caracteres da chave. A chave inteira nunca chega à interface. */
  keyHint: string | null;
  /** A chave está no cofre do sistema, ou só na memória desta sessão. */
  encrypted: boolean;
  /** ffmpeg encontrado no PATH. */
  ffmpeg: boolean;
}

/** Um trecho, em segundos, e o retângulo em pixels da mídia original. */
export interface ClipCut {
  start: number;
  end: number;
  crop?: { x: number; y: number; width: number; height: number } | null;
}
