/**
 * @stalkier/core — a lógica que não depende de onde o app roda.
 *
 * Nada aqui importa Electron, Express, React ou sabe onde os dados moram. É
 * essa restrição que faz o app público e o Jaques Studio compartilharem UMA
 * regra de correção, UMA lista de muletas, UM limiar de Levenshtein e UM preço
 * por hora — em vez de duas cópias que divergem na primeira correção.
 *
 * Node é permitido (ffmpeg roda por `execFile`), navegador não.
 */
export * from './types.js';
export * from './vocabulary.js';
export * from './words.js';
export * from './media.js';
export * from './transcribe.js';
