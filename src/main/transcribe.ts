import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Engine, Segment, Settings } from '../shared/types.js';
import { getApiKey } from './settings.js';
import { buildPrompt, correctWithVocabulary, getVocabulary } from './vocabulary.js';

/**
 * Transcrição em três camadas, nesta ordem:
 *
 *   1. contexto  — a biblioteca vai como `prompt` do modelo
 *   2. correção  — Levenshtein curto contra a mesma biblioteca, sem LLM
 *   3. polimento — opcional, tira hesitação e gaguejo
 *
 * O motor padrão é a Groq (whisper-large-v3-turbo: ~US$0,04 por hora de áudio e
 * cerca de 200x tempo real). Sem chave, sem rede ou com erro do serviço, cai no
 * faster-whisper local — e a sessão registra QUAL rodou, pra você nunca ficar
 * sem saber por que uma transcrição demorou minutos.
 *
 * Nada aqui manda áudio pra lugar nenhum sem chave configurada por você. Não há
 * telemetria, não há servidor do projeto, não há endpoint padrão além do da
 * Groq, que é o serviço cuja chave você mesmo colou.
 */

const GROQ_STT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const STT_MODEL = 'whisper-large-v3-turbo';
const POLISH_MODEL = 'llama-3.3-70b-versatile';
export const USD_PER_HOUR = 0.04;

/** Aborta se o serviço não responder: sem isto, uma rede ruim trava a sessão. */
const TIMEOUT_MS = 120_000;

export interface TranscriptResult {
  text: string;
  segments: Segment[];
  duration: number | null;
  engine: Engine;
  cost: number;
  reason: string | null;
}

async function groqTranscribe(
  flac: string,
  key: string,
  language: string | null,
  prompt: string | null,
): Promise<{ text: string; segments: Segment[]; duration: number | null }> {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(flac)]), basename(flac));
  fd.append('model', STT_MODEL);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'segment');
  if (language) fd.append('language', language);
  if (prompt) fd.append('prompt', prompt);

  const r = await fetch(GROQ_STT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
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
      start: Number(s.start.toFixed(2)),
      end: Number(s.end.toFixed(2)),
      text: (s.text || '').trim(),
    })),
    duration: j.duration ?? null,
  };
}

/**
 * Reserva local: `faster-whisper` via Python, OPCIONAL. Sem Python instalado o
 * app segue funcionando só com a nuvem e diz isso na interface — instalar
 * Python nunca é pré-requisito pra usar o produto.
 */
function localTranscribe(
  flac: string,
  language: string | null,
  prompt: string | null,
  pythonBin: string,
): Promise<{ text: string; segments: Segment[]; duration: number | null }> {
  return new Promise((resolve, reject) => {
    const args = ['-m', 'stalkier_whisper', flac];
    if (language) args.push('--language', language);
    if (prompt) args.push('--prompt', prompt);
    const p = spawn(pythonBin, args, { windowsHide: true, cwd: process.env.STALKIER_PY_CWD });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => {
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
      if (code !== 0 || !line) return reject(new Error(`local whisper failed (${code}): ${err.slice(-300)}`));
      try {
        const j = JSON.parse(line);
        resolve({ text: (j.text || '').trim(), segments: j.segments || [], duration: j.duration ?? null });
      } catch (e) {
        reject(e as Error);
      }
    });
  });
}

async function polish(text: string, key: string): Promise<string> {
  const r = await fetch(GROQ_CHAT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
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

export async function transcribe(
  flac: string,
  durationSec: number,
  settings: Settings,
  recentText: string,
  pythonBin = process.env.STALKIER_PYTHON || 'python',
): Promise<TranscriptResult> {
  const key = getApiKey();
  const vocab = getVocabulary();
  const prompt = buildPrompt(vocab, recentText);
  const lang = settings.language;
  const useCloud = settings.engine !== 'local' && !!key;

  let raw: { text: string; segments: Segment[]; duration: number | null } | null = null;
  let engine: Engine = 'local';
  let cost = 0;
  let reason: string | null = null;

  if (useCloud) {
    try {
      raw = await groqTranscribe(flac, key!, lang, prompt);
      engine = 'groq';
      cost = ((raw.duration ?? durationSec) / 3600) * USD_PER_HOUR;
    } catch (e) {
      reason = String((e as Error).message);
    }
  } else if (settings.engine !== 'local') {
    reason = 'no API key';
  }

  if (!raw) raw = await localTranscribe(flac, lang, prompt, pythonBin);

  const text = correctWithVocabulary(raw.text, vocab);
  const segments = raw.segments.map((s) => ({ ...s, text: correctWithVocabulary(s.text, vocab) }));

  let final = text;
  if (settings.polish && engine === 'groq' && text && key) {
    try {
      final = await polish(text, key);
    } catch {
      /* polir é opcional: falhar aqui não pode perder a transcrição */
    }
  }

  return { text: final, segments, duration: raw.duration, engine, cost, reason };
}

export async function testKey(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const key = getApiKey();
  if (!key) return { ok: false, error: 'no key' };
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}
