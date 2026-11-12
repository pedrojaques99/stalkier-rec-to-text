/**
 * Contrato compartilhado: os dois apps (o público e o Gravador do Jaques
 * Studio) falam destes mesmos tipos. Um lugar só, e é o que impede um lado
 * ganhar um campo que o outro não conhece.
 */

export type Kind = 'audio' | 'screen' | 'dictation';
export type Engine = 'groq' | 'local';

/** Um item do checklist. `who` só quando a fala nomeia alguém. */
export interface SweepTask {
  id: string;
  text: string;
  who: string | null;
  done: boolean;
}

/**
 * O que sobra de uma conversa quando se tira a conversa: o que foi decidido, o
 * que alguém tem que fazer e o que ficou sem resposta. Nada de resumo.
 */
export interface Sweep {
  decisions: string[];
  tasks: SweepTask[];
  open: string[];
  /** Qual modelo respondeu. A tela mostra porque o resultado depende disso. */
  engine: string;
  at: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

/**
 * `ok` só quando a transcrição terminou. `processing` e `failed` EXISTEM como
 * sessão de verdade, com mídia tocável: a gravação não pode depender de haver
 * fala, chave de API ou rede pra aparecer. Quem grava vinte minutos de tela em
 * silêncio tem que ver os vinte minutos na galeria.
 */
export type Status = 'processing' | 'ok' | 'failed';

export interface Session {
  id: string;
  createdAt: number;
  kind: Kind;
  durMs: number;
  hasVideo: boolean;
  /** Capa (um frame). Só gravação de tela tem. */
  hasPoster: boolean;
  status: Status;
  /** Por que a transcrição falhou. A mídia continua lá. */
  error: string | null;
  sizeBytes: number;
  engine: Engine;
  costUsd: number;
  text: string;
  segments: Segment[];
  /**
   * A sua versão do texto, em HTML, quando você editou. `null` enquanto
   * ninguém tocou: é o que faz o texto limpo continuar acompanhando uma
   * retranscrição, e o que faz a edição sobreviver a ela.
   */
  edited: string | null;
  /** O resultado do "varrer", quando já foi pedido. Opcional: nem todo app tem chave de LLM. */
  sweep?: Sweep | null;
}

/** O que a lista mostra. Sem `segments`, sem o texto inteiro e sem o HTML editado. */
export type SessionSummary = Omit<Session, 'text' | 'segments' | 'edited'> & { preview: string };

export interface Settings {
  engine: Engine;
  /** null = autodetecta o idioma. */
  language: string | null;
  polish: boolean;
  paste: boolean;
  mic: boolean;
  /** Som do sistema (loopback). Só existe no Windows. */
  system: boolean;
  shortcut: string;
  /** Atalho da gravação de TELA. Separado de propósito: um atalho que às vezes
   *  grava a tela e às vezes dita é um atalho que você para de usar. */
  shortcutScreen: string;
}

export interface RecorderState {
  /** Entre o toque e o `MediaRecorder.start()`. Existe porque `getDisplayMedia`
   *  pode levar segundos ou ser negado, e sem este estado o cronômetro corre
   *  antes de haver gravação — o pior feedback possível: mentira. */
  preparing: boolean;
  recording: boolean;
  transcribing: boolean;
  kind: Kind;
  since: number;
  shortcut: string | null;
  /** null quando outro app já usa a combinação. */
  shortcutScreen: string | null;
  error: string | null;
  /** A última gravação, pro aviso de resultado. `at` muda a cada gravação, e é
   *  o que deixa a interface distinguir dois resultados iguais em sequência. */
  last?: { id?: string; text?: string; error?: string; engine?: Engine; kind?: Kind; durMs?: number; bytes?: number; warning?: string | null; at?: number };
}

export interface WordCandidate {
  word: string;
  n: number;
  sessions: number;
  proper: boolean;
  inLibrary: boolean;
}

/** Contagem simples: quantas vezes, em quantas sessões. */
export interface WordStat {
  word: string;
  n: number;
  sessions: number;
}

/** Muleta de fala medida por minuto FALADO, que é o que dá pra comparar entre gravações. */
export interface TicStat {
  word: string;
  n: number;
  perMin: number;
}

/**
 * Os quatro cartões da lateral numa chamada só. São quatro leituras do MESMO
 * varrimento das sessões: fazer quatro consultas seria varrer quatro vezes.
 */
export interface WordPanels {
  /** O que vale ensinar ao modelo. Ordenado por score, não por frequência. */
  teach: WordCandidate[];
  /** As mais ditas de verdade, sem artigo nem preposição. */
  top: WordStat[];
  /** Rara e sua: pouca sessão, muita repetição dentro dela. */
  rare: WordStat[];
  /** Muleta de fala, com a taxa por minuto. */
  tics: TicStat[];
  /** Minutos de fala no período, que é o denominador da taxa. */
  minutes: number;
}

export interface StartOptions {
  kind?: Kind;
  mic?: boolean;
  system?: boolean;
  dictation?: boolean;
  sourceId?: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'groq',
  language: null,
  polish: false,
  paste: true,
  mic: true,
  system: false,
  // Padrão de quem acabou de instalar: combinação que existe em QUALQUER
  // teclado. F13 e as irmãs dela são ótimas (não aparecem no meio de um texto),
  // mas só quem tem teclado com macro as produz — quem tem troca em dois
  // cliques. Atenção: o Windows recusa F12 a F24 SEM modificador.
  shortcut: 'CommandOrControl+Shift+Space',
  shortcutScreen: 'CommandOrControl+Shift+R',
};
