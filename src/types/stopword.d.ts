/**
 * `stopword` não publica tipos. Em vez de `any` solto pelo código, o contrato
 * fica declarado aqui — só o que este projeto usa.
 *
 * Os exports são NOMEADOS, e não um default: o pacote é CommonJS sem
 * `__esModule`, então `import sw from 'stopword'` compila pra
 * `stopword_1.default`, que é `undefined` em Node puro. Um bundler conserta
 * esse interop e esconde o problema; o backend do Jaques Studio é CJS e
 * quebrou na primeira chamada.
 */
declare module 'stopword' {
  /** Português. */
  export const por: string[];
  /** Inglês. */
  export const eng: string[];
  export function removeStopwords(tokens: string[], list?: string[]): string[];
}
