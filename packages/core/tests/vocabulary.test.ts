import { describe, expect, it } from 'vitest';
import { correctWithVocabulary } from '../src/vocabulary.js';
import { countWords, wordCandidates } from '../src/words.js';
import type { Session } from '../src/types.js';

// A correção é a única lógica do app que dá pra errar em silêncio. Um falso
// negativo você percebe lendo; um falso POSITIVO passa despercebido e muda o
// sentido — "cloud" virando "Claude" num texto sobre infraestrutura é um erro
// que parece certo.
const VOCAB = ['Anthropic', 'Claude', 'Kubernetes', 'ffmpeg', 'Zyra'];
const fix = (s: string): string => correctWithVocabulary(s, VOCAB);

describe('correctWithVocabulary', () => {
  it('fixes a misspelled proper noun', () => {
    expect(fix('anthropick shipped it')).toBe('Anthropic shipped it');
    expect(fix('the kubernets cluster is down')).toBe('the Kubernetes cluster is down');
  });

  it('normalizes the case of a term written correctly', () => {
    expect(fix('talked to zyra today')).toBe('talked to Zyra today');
    expect(fix('ran ffmpeg')).toBe('ran ffmpeg');
  });

  it('does NOT turn a common word into a look-alike term', () => {
    // distância 2 de "Claude", mas com 5 letras o limiar é 1 — e é isso que
    // impede o erro silencioso.
    expect(fix('cloud computing is expensive')).toBe('cloud computing is expensive');
  });

  it('leaves short words and stopwords alone', () => {
    expect(fix('the of and to')).toBe('the of and to');
  });

  it('is inert without a library', () => {
    expect(correctWithVocabulary('anthropick', [])).toBe('anthropick');
  });
});

describe('countWords', () => {
  it('drops filler and keeps content', () => {
    const m = countWords('So now I am gonna test the Zyra interface here, like, really.');
    expect([...m.keys()].sort()).toEqual(['interface', 'test', 'zyra']);
  });

  it('flags a capitalized word mid-sentence as a likely proper noun', () => {
    const m = countWords('today I spoke with Zyra about it.');
    expect(m.get('zyra')?.proper).toBe(true);
  });

  it('does not flag the first word of a sentence', () => {
    const m = countWords('Interface shipped today. Interface looks fine.');
    expect(m.get('interface')?.proper).toBe(false);
  });
});

describe('wordCandidates', () => {
  const session = (id: string, text: string): Session => ({
    id, createdAt: Date.now(), kind: 'dictation', durMs: 5000, hasVideo: false,
    engine: 'local', costUsd: 0, text, segments: [],
  });

  it('ranks a likely proper noun above a common word said as often', () => {
    const out = wordCandidates([session('aaaaaa', 'the Zyra interface shipped today')], []);
    expect(out[0]?.word).toBe('Zyra');
  });

  // Repetir em MAIS DE UMA sessão é sinal mais forte que aparecer uma vez, mesmo
  // sendo nome próprio: o que se repete ao longo dos dias é o seu jargão, e o
  // que apareceu uma vez pode ter sido acidente daquele áudio.
  it('ranks a word repeated across sessions above a one-off proper noun', () => {
    const out = wordCandidates(
      [session('aaaaaa', 'the Zyra interface shipped today'), session('bbbbbb', 'interface interface interface')],
      [],
    );
    expect(out[0]?.word).toBe('interface');
    expect(out.map((w: { word: string }) => w.word)).toContain('Zyra');
  });
});
