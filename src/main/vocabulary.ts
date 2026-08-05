import { app } from 'electron';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { distance } from 'fastest-levenshtein';
import sw from 'stopword';

/**
 * A biblioteca de palavras: nomes próprios, apelidos, apps e jargão que o
 * modelo erra por não conhecer.
 *
 * Ela nasce VAZIA. Um dicionário de fábrica com nomes de alguém seria dado
 * pessoal versionado num repositório público — e ainda enviesaria a
 * transcrição de todo mundo com palavras que não são delas.
 */

const file = () => join(app.getPath('userData'), 'vocabulary.json');

export function getVocabulary(): string[] {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'));
    return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function setVocabulary(list: unknown): string[] {
  const clean = [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim()))]
    .filter((s) => s && s.length <= 60)
    .slice(0, 400);
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8');
  renameSync(tmp, file());
  return clean;
}

/**
 * O campo `prompt` da API aceita ~224 tokens e a biblioteca pode ter centenas
 * de termos: mandar tudo faz o serviço truncar em silêncio, e o que sobra é o
 * começo alfabético em vez do que você realmente fala. O corte é por uso —
 * termo visto nas últimas sessões vem primeiro.
 */
export function buildPrompt(vocab: string[], recentText: string): string | null {
  if (!vocab.length) return null;
  const recent = recentText.toLowerCase();
  const used = vocab.filter((t) => recent.includes(t.toLowerCase()));
  const rest = vocab.filter((t) => !used.includes(t));
  let s = [...used, ...rest].slice(0, 40).join(', ');
  if (s.length > 700) s = s.slice(0, s.lastIndexOf(',', 700));
  return `${s}.`;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/**
 * Conserta o que o modelo ouviu certo e escreveu errado. Determinístico de
 * propósito: um LLM "corrigindo" nome próprio inventa nome próprio.
 *
 * O limiar é curto e cresce com o tamanho da palavra — até 7 letras só aceita 1
 * de distância. Sem isso, "cloud" (distância 2 de "Claude") viraria "Claude"
 * toda vez que alguém falasse de nuvem: o erro mais caro possível, porque é
 * silencioso e parece certo.
 */
export function correctWithVocabulary(text: string, vocab: string[]): string {
  if (!text || !vocab.length) return text;
  const terms = vocab.filter((t) => !/\s/.test(t) && t.length >= 3);
  if (!terms.length) return text;
  const exact = new Map(terms.map((t) => [t.toLowerCase(), t]));
  const stop = new Set<string>([...sw.por, ...sw.eng]);

  return text.replace(WORD, (w) => {
    const l = w.toLowerCase();
    if (exact.has(l)) return exact.get(l)!;
    if (l.length < 4 || stop.has(l)) return w;
    const max = l.length >= 8 ? 2 : 1;
    let best: string | null = null;
    let bestD = Infinity;
    for (const t of terms) {
      const tl = t.toLowerCase();
      if (Math.abs(tl.length - l.length) > max) continue;
      const d = distance(l, tl);
      if (d > 0 && d <= max && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best ?? w;
  });
}
