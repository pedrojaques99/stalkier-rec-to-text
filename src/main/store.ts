import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session, SessionSummary } from '../shared/types.js';

/**
 * Armazenamento em JSON, de propósito.
 *
 * SQLite traria `better-sqlite3` (módulo nativo, que precisa ser recompilado a
 * cada versão do Electron e é a causa nº 1 de "não instala na minha máquina") ou
 * o `node:sqlite`, que ainda é experimental. Num app que a pessoa instala pra
 * ditar uma frase, nenhum dos dois se paga.
 *
 * O limite está documentado no README: o índice é lido inteiro na memória. Com
 * 20 ditados por dia isso dá ~7 MB por ano, que carrega em milissegundos. Se um
 * dia doer, o caminho é SQLite — não um índice mais esperto.
 *
 * Tudo mora em `app.getPath('userData')`, nunca ao lado do executável: é o
 * diretório por usuário do sistema, e é o que faz duas contas na mesma máquina
 * não lerem a transcrição uma da outra.
 */

const ID = /^[a-z0-9]{6,24}$/;

export const dataDir = (): string => {
  const d = join(app.getPath('userData'), 'data');
  mkdirSync(d, { recursive: true });
  return d;
};

export const mediaDir = (): string => {
  const d = join(app.getPath('userData'), 'media');
  mkdirSync(d, { recursive: true });
  return d;
};

const indexFile = () => join(dataDir(), 'sessions.json');

export const isValidId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);

export const newId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Caminho de mídia, sempre derivado de um id validado — nunca de entrada crua. */
export function mediaPath(id: string, ext: 'mp3' | 'mp4' | 'webm' | 'flac'): string {
  if (!isValidId(id)) throw new Error('invalid id');
  return join(mediaDir(), `${id}.${ext}`);
}

function readAll(): Session[] {
  try {
    const raw = JSON.parse(readFileSync(indexFile(), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Escrita atômica: grava num temporário e renomeia. Sem isso, uma queda de
 * energia no meio do `writeFileSync` deixa o índice pela metade, e o app abre
 * na próxima vez com zero sessão — a pior falha possível, porque parece que os
 * dados sumiram.
 */
function writeAll(list: Session[]): void {
  const tmp = `${indexFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(list), 'utf8');
  renameSync(tmp, indexFile());
}

const summarize = (s: Session): SessionSummary => ({
  id: s.id,
  createdAt: s.createdAt,
  kind: s.kind,
  durMs: s.durMs,
  hasVideo: s.hasVideo,
  engine: s.engine,
  costUsd: s.costUsd,
  preview: (s.text || '').slice(0, 400),
});

export function listSessions(query = ''): SessionSummary[] {
  const q = query.trim().toLowerCase();
  return readAll()
    .filter((s) => !q || (s.text || '').toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(summarize);
}

export function getSession(id: string): Session | null {
  if (!isValidId(id)) return null;
  return readAll().find((s) => s.id === id) ?? null;
}

export function saveSession(s: Session): void {
  const list = readAll().filter((x) => x.id !== s.id);
  list.push(s);
  writeAll(list);
}

export function removeSession(id: string): boolean {
  if (!isValidId(id)) return false;
  const list = readAll();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  writeAll(next);
  for (const ext of ['mp3', 'mp4', 'webm', 'flac'] as const) {
    const p = join(mediaDir(), `${id}.${ext}`);
    if (existsSync(p)) rmSync(p, { force: true });
  }
  return true;
}

/** Gasto do mês corrente. É o número que responde "isso está saindo caro?". */
export function monthUsage(): { cost: number; sessions: number; ms: number } {
  const first = new Date();
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  const list = readAll().filter((s) => s.createdAt >= first.getTime());
  return {
    cost: list.reduce((a, s) => a + (s.costUsd || 0), 0),
    sessions: list.length,
    ms: list.reduce((a, s) => a + (s.durMs || 0), 0),
  };
}

export function allSessions(): Session[] {
  return readAll();
}
