import { describe, expect, it } from 'vitest';
import type { Segment } from '@stalkier/core';
import { tidyToText, tidyTranscript } from '../src/tidy.js';

const seg = (start: number, end: number, text: string): Segment => ({ start, end, text });

describe('tidyTranscript', () => {
  it('junta os trechos num parágrafo enquanto a pessoa não para de falar', () => {
    const p = tidyTranscript([
      seg(0, 3, 'Daí na casa, sim, pode ser algo chamativo,'),
      seg(3, 6, 'a gente pode explorar bastante coisas.'),
    ]);
    expect(p).toHaveLength(1);
    expect(p[0]).toBe('Daí na casa, sim, pode ser algo chamativo, a gente pode explorar bastante coisas.');
  });

  it('quebra parágrafo na pausa longa, mas só com a frase fechada', () => {
    const cortou = tidyTranscript([seg(0, 3, 'Primeira ideia pronta.'), seg(5, 8, 'Segunda ideia agora.')]);
    expect(cortou).toHaveLength(2);

    // Mesma pausa, frase aberta: respirar no meio da oração não é assunto novo.
    const naoCortou = tidyTranscript([seg(0, 3, 'Primeira ideia'), seg(5, 8, 'ainda em pé.')]);
    expect(naoCortou).toHaveLength(1);
  });

  it('tira hesitação e muleta sem comer palavra de verdade', () => {
    const [p] = tidyTranscript([seg(0, 4, 'éé, o cliente quer ver a estrutura, né, não tanto o material.')]);
    expect(p).toBe('O cliente quer ver a estrutura, não tanto o material.');

    const [q] = tidyTranscript([seg(0, 4, 'Você sabe o caminho de um projeto assim.')]);
    expect(q).toContain('Você sabe o caminho');
    expect(q).toContain('um projeto');
  });

  it('come a palavra repetida colada', () => {
    const [p] = tidyTranscript([seg(0, 4, 'a a onde vai o projeto')]);
    expect(p).toBe('A onde vai o projeto.');
  });

  it('fecha a frase e sobe a maiúscula do começo', () => {
    const [p] = tidyTranscript([seg(0, 2, 'então pode pensar em uma casa')]);
    expect(p).toBe('Então pode pensar em uma casa.');
  });

  it('sem segmentos, corta o texto solto por tamanho', () => {
    const frase = 'Uma frase de tamanho normal aqui. ';
    const p = tidyTranscript(undefined, frase.repeat(30));
    expect(p.length).toBeGreaterThan(1);
    expect(p.every((x) => x.length <= 460)).toBe(true);
  });

  it('silêncio continua silêncio', () => {
    expect(tidyTranscript([], '')).toEqual([]);
    expect(tidyTranscript([seg(0, 1, '   ')], '')).toEqual([]);
  });

  it('o texto pra colar sai com linha em branco entre os parágrafos', () => {
    const t = tidyToText([seg(0, 3, 'Primeira ideia pronta.'), seg(5, 8, 'Segunda ideia agora.')]);
    expect(t).toBe('Primeira ideia pronta.\n\nSegunda ideia agora.');
  });
});
