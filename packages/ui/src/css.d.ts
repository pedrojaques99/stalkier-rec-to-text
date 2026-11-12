/**
 * Importar CSS de dentro de um .tsx é o que mantém o estilo da lib de recorte
 * colado no componente que precisa dele. O `tsc` não sabe o que é um .css e
 * reclama; quem resolve o import é o Vite dos dois apps que consomem isto.
 *
 * Sem esta declaração a alternativa seria pedir pra cada app lembrar de
 * importar o CSS da lib — e app que precisa lembrar é app que esquece.
 */
declare module '*.css';
