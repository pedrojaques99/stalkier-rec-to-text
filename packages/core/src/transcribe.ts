import type { Engine, Segment } from './types.js';
import { buildPrompt, correctWithVocabulary } from './vocabulary.js';

/**
 * Transcrição: as três camadas, e nada mais.
 *
 *   1. contexto  — a biblioteca vai como `prompt` do modelo
 *   2. correção  — Levenshtein curto contra a mesma biblioteca, sem LLM
 *   3. polimento — opcional, tira hesitação e gaguejo
 *
 * Módulo PURO no sentido que importa: ele não sabe onde a chave mora, onde o
 * áudio foi parar nem quem é o dono da sessão. Recebe bytes, chave e ajustes;
 * devolve texto. É o que permite o app público (chave no cofre do SO) e o
 * Jaques Studio (chave num arquivo do usuário) rodarem o MESMO código.
 *
 * A reserva local também entra por injeção: quem sabe invocar Python é o app.
 */

export const GROQ_STT = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
export const STT_MODEL = 'whisper-large-v3-turbo';
export const POLISH_MODEL = 'llama-3.3-70b-versatile';
export const USD_PER_HOUR = 0.04;

/** Aborta se o serviço não responder: sem isto, uma rede ruim trava a sessão. */
const TIMEOUT_MS = 120_000;

export interface RawTranscript {
  text: string;
  segments: Segment[];
  duration: number | null;
}

export interface TranscriptResult extends RawTranscript {
  engine: Engine;
  cost: number;
  /** Por que NÃO usou a nuvem, quando não usou. A interface mostra isso. */
  reason: string | null;
}

export interface TranscribeOptions {
  /** Bytes do áudio já convertido (16 kHz mono FLAC). */
  audio: Uint8Array<ArrayBuffer>;
  filename?: string;
  apiKey: string | null;
  language: string | null;
  vocabulary: string[];
  /** Texto das últimas sessões: decide quais termos cabem no prompt. */
  recentText?: string;
  /** Duração medida na gravação. Usada no custo quando o serviço não reporta. */
  durationSec?: number;
  polish?: boolean;
  forceLocal?: boolean;
  /** Reserva local. Quem sabe chamar Python é o app. */
  local?: (opts: { language: string | null; prompt: string | null }) => Promise<RawTranscript>;
}

export async function groqTranscribe(
  // `Uint8Array<ArrayBuffer>`, e não `Uint8Array` solto: o segundo aceita
  // SharedArrayBuffer, que o Blob recusa. O erro só aparece na compilação de
  // quem consome, o que é o pior lugar pra descobrir.
  audio: Uint8Array<ArrayBuffer>,
  apiKey: string,
  language: string | null,
  prompt: string | null,
  filename = 'audio.flac',
): Promise<RawTranscript> {
  const fd = new FormData();
  fd.append('file', new Blob([audio]), filename);
  fd.append('model', STT_MODEL);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'segment');
  if (language) fd.append('language', language);
  if (prompt) fd.append('prompt', prompt);

  const r = await fetch(GROQ_STT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as {
    text?: string;
    duration?: number;
    segments?: { start: number; end: number; text: string }[];
  };
  return {
    text: (j.text || '').trim(),
    segments: (j.segments || []).map((s) => ({
      start: Number(Number(s.start).toFixed(2)),
      end: Number(Number(s.end).toFixed(2)),
      text: (s.text || '').trim(),
    })),
    duration: j.duration ?? null,
  };
}

export async function polishText(text: string, apiKey: string): Promise<string> {
  const r = await fetch(GROQ_CHAT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: POLISH_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You clean up speech transcripts. Remove hesitations, stutters and false starts. Break into paragraphs. Do NOT rewrite, summarize, translate or invent anything, and never change proper nouns. Reply with the cleaned text only.',
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`polish ${r.status}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content || '').trim() || text;
}

export async function testApiKey(apiKey: string | null): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!apiKey) return { ok: false, error: 'no key' };
  try {
    const r = await fetch(GROQ_MODELS, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

/**
 * Orquestra as três camadas e a queda pra reserva. Nunca lança por causa da
 * nuvem: erro do serviço vira `reason` e o local assume — quem chamou decide o
 * que mostrar, mas nunca fica sem saber qual motor rodou.
 */
export async function transcribe(o: TranscribeOptions): Promise<TranscriptResult> {
  const prompt = buildPrompt(o.vocabulary, o.recentText ?? '');
  const useCloud = !o.forceLocal && !!o.apiKey;

  let raw: RawTranscript | null = null;
  let engine: Engine = 'local';
  let cost = 0;
  let reason: string | null = null;

  if (useCloud) {
    try {
      raw = await groqTranscribe(o.audio, o.apiKey!, o.language, prompt, o.filename);
      engine = 'groq';
    } catch (e) {
      reason = String((e as Error).message);
    }
  } else if (!o.forceLocal) {
    reason = 'no API key';
  }

  if (!raw) {
    if (!o.local) throw new Error(reason || 'no transcription engine available');
    raw = await o.local({ language: o.language, prompt });
  } else if (engine === 'groq') {
    cost = costOf(raw.duration ?? o.durationSec ?? 0);
  }

  const text = correctWithVocabulary(raw.text, o.vocabulary);
  const segments = raw.segments.map((s) => ({ ...s, text: correctWithVocabulary(s.text, o.vocabulary) }));

  let final = text;
  if (o.polish && engine === 'groq' && text && o.apiKey) {
    // Polir é opcional: falhar aqui não pode custar a transcrição inteira.
    try {
      final = await polishText(text, o.apiKey);
    } catch {
      /* fica o texto corrigido */
    }
  }

  return { text: final, segments, duration: raw.duration, engine, cost, reason };
}

/** Custo em dólar de um áudio, pela duração que o serviço reportou. */
export const costOf = (seconds: number): number => (seconds / 3600) * USD_PER_HOUR;
