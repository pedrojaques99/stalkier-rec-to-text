/**
 * Contrato compartilhado: os dois apps (o público e o Gravador do Jaques
 * Studio) falam destes mesmos tipos. Um lugar só, e é o que impede um lado
 * ganhar um campo que o outro não conhece.
 */

export type Kind = 'audio' | 'screen' | 'dictation';
export type Engine = 'groq' | 'local';

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Session {
  id: string;
  createdAt: number;
  kind: Kind;
  durMs: number;
  hasVideo: boolean;
  engine: Engine;
  costUsd: number;
  text: string;
  segments: Segment[];
}

/** O que a lista mostra. Sem `segments` e sem o texto inteiro. */
export type SessionSummary = Omit<Session, 'text' | 'segments'> & { preview: string };

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
}

export interface RecorderState {
  recording: boolean;
  transcribing: boolean;
  kind: Kind;
  since: number;
  shortcut: string | null;
  error: string | null;
  last?: { id?: string; text?: string; error?: string; engine?: Engine };
}

export interface WordCandidate {
  word: string;
  n: number;
  sessions: number;
  proper: boolean;
  inLibrary: boolean;
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
  shortcut: 'CommandOrControl+Shift+Space',
};
