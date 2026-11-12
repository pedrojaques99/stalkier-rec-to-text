import { describe, expect, it } from 'vitest';
import type { Session } from '../src/types.js';
import { wordPanels } from '../src/words.js';

const sess = (id: string, text: string, durMs = 60_000): Session => ({
  id, createdAt: Date.now(), kind: 'audio', durMs, hasVideo: false, hasPoster: false,
  status: 'ok', error: null, sizeBytes: 0, engine: 'groq', costUsd: 0, text, segments: [],
});

describe('wordPanels', () => {
  it('as mais ditas ignoram artigo e preposicao', () => {
    const p = wordPanels([sess('a', 'o projeto do cliente e o projeto da marca, projeto sempre')]);
    expect(p.top[0].word).toBe('projeto');
    expect(p.top.map((w) => w.word)).not.toContain('do');
  });

  it('rara e sua: muita repeticao dentro de poucas sessoes', () => {
    const p = wordPanels([
      sess('a', 'prancha prancha prancha aqui na prancha'),
      sess('b', 'reuniao normal sem nada demais'),
    ]);
    expect(p.rare.map((w) => w.word)).toContain('prancha');
  });

  it('vicio de linguagem sai com taxa por minuto', () => {
    const p = wordPanels([sess('a', 'entao ne, tipo, e ne tambem', 120_000)]);
    const tic = p.tics.find((x) => x.word === 'ne' || x.word === 'né');
    expect(p.minutes).toBe(2);
    expect(p.tics.length).toBeGreaterThan(0);
    if (tic) expect(tic.perMin).toBeCloseTo(tic.n / 2);
  });

  it('sessao velha fica de fora da janela', () => {
    const velha = { ...sess('a', 'palavra palavra palavra'), createdAt: Date.now() - 90 * 86_400_000 };
    expect(wordPanels([velha], [], 30).top).toEqual([]);
  });
});
