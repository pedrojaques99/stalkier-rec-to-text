/**
 * `stopword` não publica tipos. Em vez de `any` solto pelo código, o contrato
 * fica declarado aqui — só o que este projeto usa.
 */
declare module 'stopword' {
  const sw: {
    /** Português. */
    por: string[];
    /** Inglês. */
    eng: string[];
    removeStopwords: (tokens: string[], list?: string[]) => string[];
  };
  export default sw;
}
