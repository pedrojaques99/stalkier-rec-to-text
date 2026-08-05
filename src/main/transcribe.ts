import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  type RawTranscript,
  type TranscriptResult,
  testApiKey,
  transcribe as transcribeCore,
} from '@stalkier/core';
import type { Settings } from '../shared/types.js';
import { getApiKey } from './settings.js';
import { getVocabulary } from './vocabulary.js';

/**
 * A ORQUESTRAÇÃO da transcrição mora em `@stalkier/core` (as três camadas, a
 * queda pra reserva, o custo). Aqui fica só o que é deste app: onde a chave
 * está guardada, onde o arquivo está no disco, e como se chama o Python.
 *
 * Nada aqui manda áudio pra lugar nenhum sem chave configurada por você. Não há
 * telemetria, não há servidor do projeto, e o único destino é o da API cuja
 * chave você mesmo colou.
 */

/**
 * Reserva local: `faster-whisper` via Python, OPCIONAL. Sem Python instalado o
 * app segue funcionando só com a nuvem e diz isso na interface — instalar
 * Python nunca é pré-requisito pra usar o produto.
 */
function localWhisper(
  file: string,
  pythonBin: string,
): (opts: { language: string | null; prompt: string | null }) => Promise<RawTranscript> {
  return ({ language, prompt }) =>
    new Promise((resolve, reject) => {
      const args = ['-m', 'stalkier_whisper', file];
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

export async function transcribe(
  flac: string,
  durationSec: number,
  settings: Settings,
  recentText: string,
  pythonBin = process.env.STALKIER_PYTHON || 'python',
): Promise<TranscriptResult> {
  const bytes = readFileSync(flac);
  return transcribeCore({
    audio: new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    filename: basename(flac),
    apiKey: getApiKey(),
    language: settings.language,
    vocabulary: getVocabulary(),
    recentText,
    durationSec,
    polish: settings.polish,
    forceLocal: settings.engine === 'local',
    local: localWhisper(flac, pythonBin),
  });
}

export const testKey = (): ReturnType<typeof testApiKey> => testApiKey(getApiKey());
