/**
 * Fala vira texto lido.
 *
 * O que o Whisper devolve é a fala picada em trechos de cinco segundos, com as
 * muletas todas ("né", "tipo", "éé") e sem parágrafo nenhum. Isso serve pra
 * legenda e pra pular no áudio, e não serve pra LER nem pra COLAR num lugar:
 * ninguém manda pro cliente um bloco de dezoito linhas soltas.
 *
 * Este módulo é a segunda leitura da mesma transcrição: junta os trechos,
 * tira o entulho, refaz a pontuação de início de frase e quebra em parágrafo
 * onde a pessoa realmente parou de falar. Determinístico de propósito, como a
 * correção de vocabulário: um LLM "organizando" a reunião reescreve o que foi
 * dito, e aqui o texto tem que continuar sendo o que a pessoa falou.
 *
 * O que ele NÃO faz: resumir, traduzir, trocar palavra por sinônimo, consertar
 * concordância. Some muleta, some repetição colada, entra parágrafo. Só.
 */
import type { Segment } from '@stalkier/core';

/**
 * Hesitação pura: som que não é palavra. Sai sempre, em qualquer posição.
 * `um` e `ah` ficam de fora de propósito — "um projeto" e "ah, entendi" são
 * palavras de verdade, e o preço de errar aqui é comer o texto de alguém.
 */
const HESITACAO = /(?<![\p{L}])(é{2,}|e{2,}h+|a{2,}h+|h+u+m+|u+h+u+m+|ã{2,}|hã|ahn|ahm|hmm+)(?![\p{L}])/giu;

/**
 * Muleta de fala: palavra de verdade, mas que só existe pra segurar o ritmo.
 * Só sai quando está CERCADA de vírgula ou no fim da frase, que é a posição em
 * que ela é enfeite. "Você sabe o caminho" não perde o "sabe"; "é ali, sabe,"
 * perde. É a mesma cautela do limiar curto do Levenshtein.
 */
// Mais longa primeiro: com 'tipo' antes de 'tipo assim' a alternância casa o
// pedaço curto, a checagem de pontuação falha e a muleta inteira fica.
const MULETAS = ['vamos dizer', 'tipo assim', 'entendeu', 'digamos', 'certo', 'assim', 'enfim', 'sabe', 'tipo', 'né', 'ne', 'tá', 'ta'];

const RE_MULETA_MEIO = new RegExp(String.raw`,\s*(?:${MULETAS.join('|')})(?![\p{L}])\s*(?=[,.!?…])`, 'giu');
const RE_MULETA_FIM = new RegExp(String.raw`(?<![\p{L}])[,\s]\s*(?:${MULETAS.join('|')})(?![\p{L}])\s*(?=[.!?…]|$)`, 'giu');
const RE_MULETA_INICIO = new RegExp(String.raw`(^|[.!?…]\s+)(?:${MULETAS.join('|')}),\s*`, 'giu');

/** "a a onde", "que que é": gagueira do Whisper e da boca. */
const RE_REPETIDA = /(?<![\p{L}])(\p{L}[\p{L}'’-]*)(\s+\1)+(?![\p{L}])/giu;

/** Pausa a partir da qual a pessoa mudou de assunto, e não de frase. */
const PAUSA_MS = 900;
/** Parágrafo que passa disso vira parede de texto mesmo sem pausa nenhuma. */
const MAX_CHARS = 420;

const limpa = (s: string): string =>
  s
    .replace(HESITACAO, ' ')
    .replace(RE_REPETIDA, '$1')
    .replace(RE_MULETA_MEIO, ',')
    .replace(RE_MULETA_FIM, '')
    .replace(RE_MULETA_INICIO, '$1')
    .replace(/\s+([,.!?…])/g, '$1')
    .replace(/([,.!?…])(?=[\p{L}])/gu, '$1 ')
    .replace(/,{2,}/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s]+/, '')
    .trim();

const maiuscula = (s: string): string =>
  s.replace(/(^|[.!?…]\s+)(\p{Ll})/gu, (_m, antes: string, letra: string) => antes + letra.toUpperCase());

/** Fecha a frase: transcrição sem ponto final é transcrição pela metade. */
const fecha = (s: string): string => (/[.!?…]$/.test(s) ? s : `${s.replace(/[,\s]+$/, '')}.`);

/**
 * Os parágrafos do texto lido. Vazio quando não sobrou nada — silêncio e falha
 * são estados de verdade, e inventar um parágrafo em cima deles é mentir.
 *
 * Sem `segments` (ditado, por exemplo) o corte é só por tamanho, sobre o texto
 * inteiro: sem tempo não há pausa pra ler.
 */
export function tidyTranscript(segments: Segment[] | undefined, text = ''): string[] {
  const trechos = (segments || []).map((s) => ({ ...s, text: (s.text || '').trim() })).filter((s) => s.text);
  if (!trechos.length) {
    const limpo = limpa(text || '');
    if (!limpo) return [];
    return quebraPorTamanho(limpo).map((p) => fecha(maiuscula(p)));
  }

  const paragrafos: string[] = [];
  let atual = '';
  let fim = trechos[0].start;

  for (const trecho of trechos) {
    const pausa = (trecho.start - fim) * 1000;
    // A pausa só vira parágrafo quando a frase anterior FECHOU. Respirar no
    // meio de uma oração é respirar, não é assunto novo.
    const fechou = /[.!?…]$/.test(atual);
    if (atual && ((pausa >= PAUSA_MS && fechou) || atual.length >= MAX_CHARS)) {
      paragrafos.push(atual);
      atual = '';
    }
    atual = atual ? `${atual} ${trecho.text}` : trecho.text;
    fim = trecho.end;
  }
  if (atual) paragrafos.push(atual);

  return paragrafos.map((p) => fecha(maiuscula(limpa(p)))).filter((p) => p.length > 1);
}

/** Sem tempo pra guiar, quebra na frase mais próxima do limite. */
function quebraPorTamanho(texto: string): string[] {
  const frases = texto.match(/[^.!?…]+[.!?…]*/g) || [texto];
  const out: string[] = [];
  let atual = '';
  for (const f of frases) {
    if (atual.length + f.length > MAX_CHARS && atual) { out.push(atual.trim()); atual = ''; }
    atual += f;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

/** O texto pronto pra colar em outro lugar: parágrafos separados por linha em branco. */
export const tidyToText = (segments: Segment[] | undefined, text = ''): string =>
  tidyTranscript(segments, text).join('\n\n');
