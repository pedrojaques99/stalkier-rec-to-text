import { Recorder, en, type RecorderApi } from '@stalkier/ui';
import '@stalkier/ui/theme.css';

/**
 * A casca deste app: adaptador de IPC + inglês.
 *
 * A tela inteira vem de `@stalkier/ui` e é a MESMA que a aba do Jaques Studio
 * monta com um adaptador HTTP e as strings em português. Tudo o que muda entre
 * os dois está neste arquivo.
 */
const api: RecorderApi = {
  available: true,

  start: (opts) => window.api.rec.start(opts),
  stop: () => window.api.rec.stop(),
  cancel: () => window.api.rec.cancel(),
  state: () => window.api.rec.state(),
  onState: (cb) => window.api.rec.onState(cb as (s: never) => void),
  onLevel: (cb) => window.api.rec.onLevel(cb as (v: never) => void),
  shortcut: (acc) => window.api.rec.shortcut(acc),
  pauseShortcut: (v) => window.api.rec.pauseShortcut(v),

  listSessions: (q) => window.api.sessions.list(q),
  getSession: (id) => window.api.sessions.get(id),
  removeSession: (id) => window.api.sessions.remove(id),
  // Protocolo próprio, com id validado do outro lado — nunca caminho de arquivo.
  mediaUrl: (id, kind) => `media://${id}.${kind}`,

  getSettings: () => window.api.settings.get(),
  setSettings: (patch) => window.api.settings.set(patch),
  setKey: (key) => window.api.key.set(key),
  testKey: () => window.api.key.test(),

  words: () => window.api.words.list(),
  getVocabulary: () => window.api.vocabulary.get(),
  setVocabulary: (list) => window.api.vocabulary.set(list),
};

export default function App(): JSX.Element {
  return <Recorder api={api} t={en} />;
}
