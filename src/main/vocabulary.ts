import { app } from 'electron';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeVocabulary } from '@stalkier/core';

/**
 * Onde a biblioteca MORA. A regra (o que é termo válido, como o prompt é
 * montado, como a correção decide) vive em `@stalkier/core` e é a mesma do
 * Jaques Studio — aqui só tem disco.
 *
 * Ela nasce VAZIA. Um dicionário de fábrica com nomes de alguém seria dado
 * pessoal versionado num repositório público, e ainda enviesaria a transcrição
 * de todo mundo com palavras que não são delas.
 */

const file = (): string => join(app.getPath('userData'), 'vocabulary.json');

export function getVocabulary(): string[] {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'));
    return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function setVocabulary(list: unknown): string[] {
  const clean = normalizeVocabulary(list);
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  renameSync(tmp, file());
  return clean;
}
