import { eng, por } from 'stopword';
import type { Session, TicStat, WordCandidate, WordPanels, WordStat } from './types.js';

/**
 * "O que vale ensinar ao modelo" — não "as palavras mais ditas".
 *
 * Contagem crua responde "quais palavras eu repito", que é curiosidade. A
 * pergunta útil é "o que ele vai escrever errado da próxima vez", e a resposta
 * é outra lista: nome próprio e jargão, nunca verbo comum e muleta de fala.
 */

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/**
 * A lista `por` do pacote `stopword` é curta demais pro português FALADO: tira
 * artigo e preposição, e deixa passar exatamente o que enche uma transcrição de
 * conversa. Sem este complemento o painel mostrava "vai, tão, seja, ser, agora,
 * aqui" — filler puro ocupando a lateral inteira sem informar nada.
 */
const FILLER_PT = [
  'vai', 'vou', 'vamos', 'tão', 'seja', 'ser', 'sou', 'estou', 'está', 'estar', 'esta', 'este', 'isso', 'isto',
  'agora', 'aqui', 'ali', 'lá', 'bom', 'boa', 'vez', 'vezes', 'pra', 'pro', 'tipo', 'coisa', 'coisas',
  'gente', 'cara', 'certo', 'então', 'daí', 'aí', 'né', 'tá', 'ok', 'legal', 'melhor', 'pior', 'muito',
  'pouco', 'todo', 'toda', 'tudo', 'nada', 'algo', 'alguma', 'algum', 'outro', 'outra', 'mesmo', 'mesma',
  'ainda', 'sempre', 'nunca', 'talvez', 'quase', 'já', 'depois', 'antes', 'hoje', 'ontem', 'amanhã',
  'fazer', 'faz', 'fez', 'feito', 'ter', 'tem', 'tinha', 'ficar', 'fica', 'ficou', 'ver', 'vendo', 'visto',
  'dar', 'dá', 'deu', 'ir', 'vem', 'vindo', 'poder', 'pode', 'consegue', 'quer', 'quero', 'sabe', 'sei',
  'acho', 'acha', 'falar', 'falando', 'fala', 'dizer', 'disse', 'usar', 'usando', 'hora', 'horas', 'dia',
  'forma', 'jeito', 'parte', 'lado', 'pessoal', 'galera', 'primeira', 'primeiro', 'segunda',
  'precisa', 'preciso', 'coloca', 'colocar', 'deixa', 'deixar', 'pega', 'pegar', 'olha', 'olhar',
];

const FILLER_EN = [
  'gonna', 'wanna', 'kinda', 'sorta', 'yeah', 'okay', 'right', 'like', 'just', 'really', 'actually',
  'basically', 'literally', 'stuff', 'thing', 'things', 'going', 'want', 'know', 'think', 'make', 'made',
];

interface Counted {
  n: number;
  proper: boolean;
  form: string;
}

/**
 * A CAIXA ORIGINAL é sinal: nome próprio no meio da frase vem com maiúscula, e
 * é justamente ele o candidato a biblioteca.
 */
export function countWords(text: string): Map<string, Counted> {
  const out = new Map<string, Counted>();
  if (!text) return out;
  const stop = new Set<string>([...por, ...eng, ...FILLER_PT, ...FILLER_EN]);
  // Divide em frases pra saber quem está no começo (onde a maiúscula não diz nada).
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.match(WORD) || [];
    words.forEach((raw, i) => {
      const w = raw.toLowerCase();
      if (w.length < 4 || /^\d+$/.test(w) || stop.has(w)) return;
      const proper = i > 0 && /^[A-ZÀ-Ý]/.test(raw);
      const at = out.get(w) ?? { n: 0, proper: false, form: raw };
      at.n += 1;
      if (proper) {
        at.proper = true;
        at.form = raw;
      }
      out.set(w, at);
    });
  }
  return out;
}

/**
 * Ordem por SCORE, não por frequência:
 *   nome próprio provável pesa 3x
 *   aparecer em mais de uma sessão pesa 2x (jargão seu, não acidente de um áudio)
 * O que já está na biblioteca cai pro fim: já foi ensinado, não é tarefa.
 */
export function wordCandidates(
  sessions: Session[],
  vocabulary: string[] = [],
  days = 30,
  limit = 60,
): WordCandidate[] {
  const since = Date.now() - days * 86_400_000;
  const totals = new Map<string, { n: number; sessions: Set<string>; proper: boolean; form: string }>();

  for (const s of sessions) {
    if (s.createdAt < since) continue;
    for (const [w, v] of countWords(s.text || '')) {
      const at = totals.get(w) ?? { n: 0, sessions: new Set<string>(), proper: false, form: v.form };
      at.n += v.n;
      at.sessions.add(s.id);
      if (v.proper) {
        at.proper = true;
        at.form = v.form;
      }
      totals.set(w, at);
    }
  }

  const library = new Set(vocabulary.map((v) => v.toLowerCase()));
  return [...totals.entries()]
    .map(([w, v]) => {
      const inLibrary = library.has(w);
      const score = v.n * (v.proper ? 3 : 1) * (v.sessions.size > 1 ? 2 : 1) * (inLibrary ? 0.2 : 1);
      return { word: v.form || w, n: v.n, sessions: v.sessions.size, proper: v.proper, inLibrary, score };
    })
    .sort((a, b) => b.score - a.score || b.n - a.n)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}


/**
 * A lista de muletas que o painel MEDE. É a mesma família que o `tidy` remove do
 * texto, e é de propósito: o que some da leitura tem que aparecer em algum lugar,
 * senão você nunca fica sabendo que fala assim.
 */
const TICS = ['né', 'tipo', 'assim', 'tá', 'sabe', 'entendeu', 'enfim', 'cara', 'então', 'aí', 'daí', 'certo', 'ok', 'like', 'you know', 'right'];
const RE_TICS = TICS.map((tic): [string, RegExp] => [tic, new RegExp(String.raw`(?<![\p{L}])${tic}(?![\p{L}])`, 'giu')]);
const HESITACOES = /(?<![\p{L}])(é{2,}|e{2,}h+|a{2,}h+|h+u+m+|u+h+u+m+|ã{2,}|hã|ahn|ahm|hmm+|uh+|erm+)(?![\p{L}])/giu;

/**
 * Os quatro cartões da lateral, de um varrimento só.
 *
 * `top` é curiosidade honesta: quais palavras são suas de fato. `rare` é a
 * pergunta boa disfarçada de curiosidade — palavra que aparece muito DENTRO de
 * poucas sessões é jargão de projeto, não vocabulário geral. `tics` é o único
 * que mede você e não o modelo.
 */
export function wordPanels(
  sessions: Session[],
  vocabulary: string[] = [],
  days = 30,
  limit = 24,
): WordPanels {
  const since = Date.now() - days * 86_400_000;
  const recentes = sessions.filter((s) => s.createdAt >= since && (s.text || '').trim());

  const totais = new Map<string, { n: number; sessoes: Set<string> }>();
  const tics = new Map<string, number>();
  let ms = 0;

  for (const s of recentes) {
    ms += s.durMs || 0;
    const texto = s.text || '';
    // A MESMA contagem do "pra ensinar": artigo, preposição e muleta fora. Uma
    // lista de "mais ditas" encabeçada por "aqui, vai, tem, gente" é verdadeira
    // e não informa nada — o que se procura ali é vocabulário seu.
    for (const [w, v] of countWords(texto)) {
      const at = totais.get(w) ?? { n: 0, sessoes: new Set<string>() };
      at.n += v.n;
      at.sessoes.add(s.id);
      totais.set(w, at);
    }
    for (const [tic, re] of RE_TICS) {
      const n = (texto.match(re) || []).length;
      if (n) tics.set(tic, (tics.get(tic) || 0) + n);
    }
    const h = (texto.match(HESITACOES) || []).length;
    if (h) tics.set('éé', (tics.get('éé') || 0) + h);
  }

  const minutes = ms / 60_000;
  const entradas = [...totais.entries()].map(([word, v]): WordStat => ({ word, n: v.n, sessions: v.sessoes.size }));

  const top = [...entradas].sort((a, b) => b.n - a.n || a.word.localeCompare(b.word)).slice(0, limit);

  // Densidade, não contagem: a palavra tem que ser repetida DENTRO de poucas
  // sessões. Sem o piso de 3 ocorrências, qualquer erro de transcrição que
  // aparece uma vez só entraria como "jargão seu".
  const rare = entradas
    .filter((w) => w.n >= 3 && w.sessions <= 2 && w.word.length >= 5)
    .sort((a, b) => b.n / b.sessions - a.n / a.sessions || b.n - a.n)
    .slice(0, limit);

  const ticStats = [...tics.entries()]
    .map(([word, n]): TicStat => ({ word, n, perMin: minutes > 0 ? n / minutes : 0 }))
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);

  return {
    teach: wordCandidates(sessions, vocabulary, days, limit * 2),
    top,
    rare,
    tics: ticStats,
    minutes,
  };
}
