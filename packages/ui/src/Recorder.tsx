import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileAudio, FileVideo,
  Clock, Keyboard, LayoutGrid, List, ListChecks, Mic, MonitorPlay, Play, Plus, RotateCcw, Search, Settings2,
  AlignLeft,
  Scissors, Sparkles, Square, Trash2, Volume2, X,
} from 'lucide-react';
import type { RecorderState, Session, SessionSummary, Settings, Sweep, TicStat, WordPanels, WordStat } from '@stalkier/core';
import type { MonthUsage, RecorderApi } from './api.js';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { Strings } from './strings.js';
import { tidyToText, tidyTranscript } from './tidy.js';
import { TranscriptEditor } from './Transcript.js';
import { SweepPanel } from './Sweep.js';
/**
 * O editor chega por um chunk separado, e chunk separado é uma requisição que
 * pode falhar: rede caindo, deploy trocando o arquivo debaixo de uma aba
 * aberta, dev server re-otimizando dependência. Sem esta cerca, a falha sobe
 * pelo React e **apaga a tela inteira** — você perde a leitura, a transcrição e
 * o diálogo, porque um botão opcional não carregou. Visto acontecer: tela preta,
 * `Failed to fetch dynamically imported module`.
 *
 * Com a cerca, o que quebra é só o editor, e a mensagem diz o que fazer.
 */
class CercaDoEditor extends Component<{ children: React.ReactNode; aviso: string; onSair: () => void }, { caiu: boolean }> {
  state = { caiu: false };
  static getDerivedStateFromError(): { caiu: boolean } { return { caiu: true }; }
  render(): React.ReactNode {
    if (!this.state.caiu) return this.props.children;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 8, background: 'var(--red-dim)' }}>
        <AlertTriangle size={15} color="var(--red)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{this.props.aviso}</span>
        <button onClick={this.props.onSair}
          style={{ marginLeft: 'auto', flexShrink: 0, background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          <RotateCcw size={12} />
        </button>
      </div>
    );
  }
}

/**
 * Sob demanda: o cropper e o wavesurfer somam ~90 kB, e quem abre uma gravação
 * abre pra LER. Fazer todo mundo baixar o editor pra depois não usá-lo é cobrar
 * de todos o preço de um botão. Chega no primeiro clique na tesoura.
 */
const QuickEdit = lazy(() => import('./QuickEdit.js').then((m) => ({ default: m.QuickEdit })));

// ─── Tokens locais ───────────────────────────────────────────────────────────
const label = { fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' } as const;
const panel = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 } as const;
const mono = { fontFamily: 'var(--mono)' } as const;
const num = { ...mono, fontVariantNumeric: 'tabular-nums' } as const;
// Cifra NÃO é mono: mono é pra id, hash e caminho, e em cima de dinheiro ela
// grita "terminal". O que o número precisa é largura fixa de dígito.
const money = { fontVariantNumeric: 'tabular-nums' } as const;
const kbd = {
  ...mono, fontSize: 10.5, padding: '1px 5px', borderRadius: 4,
  border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)',
} as const;

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const when = (at: number, t: Strings): string => {
  const d = new Date(at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.getTime() >= today.getTime()) return `${t.today} ${time}`;
  if (d.getTime() >= today.getTime() - 86_400_000) return `${t.yesterday} ${time}`;
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${time}`;
};

// Centavo é a unidade real: dez minutos na nuvem custam US$0,0067. Mostrar
// "$0.01" em tudo apagaria a diferença entre uma reunião e um ditado.
const money$ = (usd: number): string => (usd >= 0.01 ? `$${usd.toFixed(2)}` : `${(usd * 100).toFixed(1)}¢`);

/** Documento sem nada dentro, do jeito que o ProseMirror escreve. */
const VAZIO = /^(<p>(\s|<br[^>]*>|&nbsp;)*<\/p>)?$/;

/** O texto limpo entra no editor como HTML, então o que veio da fala é escapado antes. */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const readable = (acc: string | null): string =>
  (acc || '').replace('CommandOrControl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');

export interface RecorderProps {
  /** Como esta casca fala com o sistema. Ver `RecorderApi`. */
  api: RecorderApi;
  /** Todo texto da tela. `en` e `pt` saem deste pacote. */
  t: Strings;
  /**
   * Atalhos globais do app hospedeiro que moram nos mesmos ajustes (o Studio
   * põe o da órbita aqui). Mesmo campo de captura, mesma pausa enquanto focado.
   */
  extraShortcuts?: ExtraShortcut[];
}

export interface ExtraShortcut {
  id: string;
  label: string;
  hint?: string;
  value: string | null;
  onChange: (acc: string) => void;
}

/**
 * A tela do gravador, inteira. Os dois apps montam ESTE componente: o público
 * com o adaptador de IPC e o inglês, a aba do Jaques Studio com o adaptador
 * HTTP e o português. Layout, estados, teclado e decisões são um só.
 */
export function Recorder({ api, t, extraShortcuts }: RecorderProps): JSX.Element {
  const [state, setState] = useState<RecorderState | null>(null);
  const [level, setLevel] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [month, setMonth] = useState<MonthUsage>({ cost: 0, sessions: 0, ms: 0 });
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Session | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Grade por padrão: o que se procura numa gravação de tela é a IMAGEM. A
  // lista continua ali porque ditado é texto, e texto se lê em linha.
  const [view, setView] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('rec:view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const [player, setPlayer] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(0);

  const [words, setWords] = useState<WordPanels | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState(true);
  const [ffmpeg, setFfmpeg] = useState(true);
  // Só aparece o botão de varrer se houver chave de LLM do outro lado da rota.
  const [canSweep, setCanSweep] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // ─── Dados ─────────────────────────────────────────────────────────────────
  const load = useCallback(async (q = '') => {
    try {
      const r = await api.listSessions(q);
      setSessions(r.sessions);
      setMonth(r.month);
      setError(null);
    } catch (e) {
      // Lista vazia e lista que não carregou são estados DIFERENTES. Colapsar os
      // dois em "nenhuma gravação" faria você jurar que perdeu o áudio.
      setError(String((e as Error).message || e));
    }
  }, []);

  const loadWords = useCallback(() => {
    void api.words().then(setWords).catch(() => {});
  }, []);

  const loadSettings = useCallback(() => {
    void api
      .getSettings()
      .then((r) => {
        setSettings(r.settings);
        setKeyHint(r.keyHint);
        setEncrypted(r.encrypted);
        setFfmpeg(r.ffmpeg);
        setCanSweep(!!r.sweep);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void load();
    loadWords();
    loadSettings();
  }, [load, loadWords, loadSettings]);

  // Busca com respiro: uma consulta por tecla digitada varre o índice inteiro.
  useEffect(() => {
    const t = setTimeout(() => void load(query), 220);
    return () => clearTimeout(t);
  }, [query, load]);

  useEffect(() => {
    void api.state().then(setState);
    const offState = api.onState((s) => {
      setState((prev) => {
        // Terminou de transcrever: a lista tem coisa nova pra mostrar.
        if (prev?.transcribing && !s.transcribing) {
          void load(query);
          loadWords();
        }
        return s;
      });
    });
    const offLevel = api.onLevel(setLevel);
    return () => {
      offState();
      offLevel();
    };
  }, [load, loadWords, query]);

  // Enquanto alguma sessão está sendo transcrita, a lista se atualiza sozinha.
  // Sem isto o card fica em "transcrevendo" até você mexer na tela — e a
  // gravação parece travada quando na verdade já terminou.
  const processing = sessions.some((s) => s.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void load(query), 2500);
    return () => clearInterval(t);
  }, [processing, load, query]);

  // Cronômetro: só existe enquanto grava.
  useEffect(() => {
    if (!state?.recording) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [state?.recording]);

  const recording = !!state?.recording;
  const preparing = !!state?.preparing;
  const transcribing = !!state?.transcribing;
  const noKey = settings?.engine !== 'local' && !keyHint;

  const start = (kind: 'audio' | 'screen'): void => {
    setDismissed(0);
    void api
      .start({ kind, mic: settings?.mic ?? true, system: settings?.system ?? false })
      .then(setState);
  };

  const retry = async (id: string): Promise<void> => {
    setRetrying(id);
    try { await api.retranscribe(id); } catch { /* o card já mostra o motivo */ }
    setRetrying(null);
    void load(query);
    loadWords();
  };
  const stop = (): void => void api.stop().then(setState);
  const cancel = (): void => void api.cancel().then(setState);

  // ─── Teclado ───────────────────────────────────────────────────────────────
  // Ordem das guardas: campo de texto, modificador, controle focado, tecla nua.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') {
        if (typing) { el!.blur(); return; }
        if (recording) { e.preventDefault(); cancel(); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && ['BUTTON', 'A', 'SELECT'].includes(el.tagName)) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recording]);

  const open = async (id: string): Promise<void> => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    setDetail(await api.getSession(id));
  };

  const copy = (id: string, text: string): void => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
  };

  const remove = async (s: SessionSummary): Promise<void> => {
    if (!window.confirm(t.removeConfirm(s.hasVideo))) return;
    await api.removeSession(s.id);
    if (openId === s.id) { setOpenId(null); setDetail(null); }
    void load(query);
    loadWords();
  };

  const save = async (patch: Partial<Settings>): Promise<void> => {
    setSettings(await api.setSettings(patch));
  };

  // A lateral só existe quando há o que pôr nela: coluna vazia rotulada é
  // moldura de nada, e ainda rouba 232px da lista.
  const temLateral = !!words && (words.teach.length > 0 || words.top.length > 0);

  const teach = async (term: string): Promise<void> => {
    const list = await api.getVocabulary();
    await api.setVocabulary([...new Set([...list, term])]);
    setWords((w) => (w ? { ...w, teach: w.teach.map((x) => (x.word === term ? { ...x, inLibrary: true } : x)) } : w));
  };

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 24px 40px' }}>
      <style>{`
        .row { transition: background-color var(--dur-fast) ease; }
        /* O card inteiro é o alvo: a capa é o botão, e o hover levanta a peça
           em vez de pintar um fundo — numa grade, fundo colorido brigaria com
           a própria imagem do vídeo. */
        .card { transition: border-color var(--dur-fast) ease, transform var(--dur-fast) var(--ease-out); }
        .card:hover { transform: translateY(-2px); }
        .card:hover .actions, .card:focus-within .actions { opacity: 1; }
        .card .play { opacity: 0; transition: opacity var(--dur-fast) ease; }
        .card:hover .play, .card:focus-within .play { opacity: 1; }
        @media (hover: none) { .card .play { opacity: 1; } }
        .row:hover { background: var(--surface-2); }
        .row:hover .actions, .row:focus-within .actions { opacity: 1; }
        .actions { opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); }
        @media (hover: none) { .actions { opacity: 1; } }
        .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
          border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--faint);
          cursor: pointer; transition: color var(--dur-fast) ease, background-color var(--dur-fast) ease; }
        .icon-btn:hover { color: var(--text); background: var(--surface-3); }
        .icon-btn[data-danger]:hover { color: var(--red); background: var(--red-dim); }
        .icon-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .primary { transition: transform var(--dur-press) var(--ease-out), background-color var(--dur-fast) ease, border-color var(--dur-fast) ease; }
        .primary:active { transform: scale(0.985); }
        .seg { transition: color var(--dur-fast) ease, background-color var(--dur-fast) ease; }
        .panel-in { animation: panel-in var(--dur-fast) var(--ease-out); }
        .ts { background: none; border: none; padding: 0; cursor: pointer; color: var(--faint); }
        .ts:hover { color: var(--accent); }
        .wave[data-mode="sweep"] > span { animation: sweep 1.05s ease-in-out infinite; }
        .skeleton { animation: breathe 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .row, .actions, .primary, .seg, .panel-in, .card, .card .play { transition-duration: .01ms; animation-duration: .01ms; }
          .card:hover { transform: none; }
          .skeleton { animation: none; }
          .wave[data-mode="sweep"] > span { animation: none; transform: scaleY(0.6); opacity: 0.6; }
        }
      `}</style>

      {/* ─── Controle: o único primário da tela ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {preparing ? (
          // Entre o toque e a captura. Sem cronômetro de propósito: não existe
          // gravação ainda, e um contador correndo aqui seria mentira. O botão
          // continua sendo o de parar, porque é isso que você vai querer se o
          // picker do sistema não abrir.
          <>
            <button className="primary" onClick={cancel} autoFocus
              style={{
                display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 18px', borderRadius: 10,
                border: '1px solid var(--yellow)', background: 'var(--surface)', color: 'var(--text)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
              <Wave mode="sweep" color="var(--yellow)" bars={5} />
              {state?.kind === 'screen' ? t.preparingScreen : t.preparing}
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{t.escDiscards}</span>
          </>
        ) : recording ? (
          <>
            <button className="primary" onClick={stop} autoFocus
              style={{
                display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 18px', borderRadius: 10,
                border: '1px solid var(--red)', background: 'var(--red-dim)', color: 'var(--text)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
              <Square size={14} fill="currentColor" color="var(--red)" />
              {t.stop}
              <span style={{ ...num, fontSize: 14, minWidth: 44, textAlign: 'right' }}>{mmss(now - (state?.since || now))}</span>
              <Wave level={level} />
            </button>
            <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{t.escDiscards}</span>
          </>
        ) : transcribing ? (
          <span aria-live="polite" style={{
            display: 'flex', alignItems: 'center', gap: 11, height: 44, padding: '0 18px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 14, fontWeight: 600,
          }}>
            <Wave mode="sweep" color="var(--accent)" bars={6} />
            {t.transcribing}
          </span>
        ) : (
          <>
            <button className="primary" onClick={() => start('audio')}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, height: 44, padding: '0 20px', borderRadius: 10,
                border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--text)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}>
              <Mic size={16} color="var(--accent)" /> {t.record}
            </button>
            <button className="primary" onClick={() => start('screen')}
              title={t.withScreenHint}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 15px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)',
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}>
              <MonitorPlay size={15} /> {t.withScreen}
              {/* O atalho vive NO botão. É a única forma de você aprender que dá
                  pra gravar a tela sem trazer esta janela pra frente — que é o
                  caso em que gravar a tela serve pra alguma coisa. */}
              {state?.shortcutScreen && <kbd style={kbd}>{readable(state.shortcutScreen)}</kbd>}
            </button>
          </>
        )}

        {/* Fontes: dois toggles sempre à vista, porque a escolha é POR gravação.
            Escondê-los num menu faria você descobrir que gravou sem o som da
            reunião depois de transcrever o silêncio. */}
        {!recording && !transcribing && settings && (
          <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <Source on={settings.mic} onClick={() => void save({ mic: !settings.mic })} icon={<Mic size={13} />} name={t.mic} t={t} />
            <Source on={settings.system} onClick={() => void save({ system: !settings.system })} icon={<Volume2 size={13} />} name={t.system} t={t} />
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* O atalho fica na linha do botão, não escondido nos ajustes: ele é o
              jeito PRINCIPAL de usar isto (a janela nem precisa estar aberta), e
              informação que só existe atrás de uma engrenagem não é aprendida. */}
          {state?.shortcut && (
            <span title={t.shortcutTitle}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--faint)' }}>
              <kbd style={kbd}>{readable(state.shortcut)}</kbd> {t.shortcutAnywhere}
            </span>
          )}
          {month.cost > 0 && (
            <span title={t.monthTitle(month.sessions, mmss(month.ms))}
              style={{ ...money, fontSize: 11.5, color: 'var(--faint)' }}>
              {t.monthCost(money$(month.cost))}
            </span>
          )}
          <button className="icon-btn" onClick={() => setSettingsOpen((v) => !v)}
            title={t.settings} aria-label={t.settingsAria} aria-expanded={settingsOpen}>
            <Settings2 size={15} />
          </button>
        </div>
      </div>

      {/* Só aparece quando há o que dizer. Faixa cheia perderia pro que importa:
          o estado ao vivo tem que pesar mais que um aviso que não muda há dias. */}
      {(state?.error || noKey || !ffmpeg || !api.available) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 12px 8px 10px',
          borderLeft: '2px solid var(--yellow)', fontSize: 12.5, color: 'var(--muted)',
        }}>
          <AlertTriangle size={14} color="var(--yellow)" style={{ flexShrink: 0 }} />
          {!api.available ? t.unavailable : !ffmpeg ? t.noFfmpeg : state?.error ? state.error : t.noKey}
          {noKey && ffmpeg && !state?.error && (
            <button onClick={() => setSettingsOpen(true)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>
              {t.addKey}
            </button>
          )}
        </div>
      )}

      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings} keyHint={keyHint} encrypted={encrypted}
          shortcut={state?.shortcut ?? null} shortcutScreen={state?.shortcutScreen ?? null} t={t} api={api}
          extraShortcuts={extraShortcuts}
          onSave={save} onClose={() => setSettingsOpen(false)}
          onKey={async (k) => { await api.setKey(k); loadSettings(); }}
          onShortcut={(acc) => { void save({ shortcut: acc }); void api.shortcut(acc).then(() => api.state().then((s) => setState(s as RecorderState))); }}
          onShortcutScreen={(acc) => { void save({ shortcutScreen: acc }); void api.shortcutScreen(acc).then(() => api.state().then((s) => setState(s as RecorderState))); }}
          onPause={(v) => void api.pauseShortcut(v).then(() => api.state().then((s) => setState(s as RecorderState)))}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: temLateral ? 'minmax(0, 1fr) 232px' : 'minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <Search size={13} color="var(--faint)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t.search}
                style={{
                  width: '100%', padding: '8px 11px 8px 32px', background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13,
                }} />
            </div>
            {/* Duas visualizações porque são dois conteúdos: gravação de tela se
                reconhece pela imagem, ditado se reconhece pela frase. */}
            <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              {(['grid', 'list'] as const).map((v) => (
                <button key={v} className="seg" aria-pressed={view === v}
                  onClick={() => { setView(v); try { localStorage.setItem('rec:view', v); } catch { /* modo anônimo */ } }}
                  title={v === 'grid' ? t.viewGrid : t.viewList} aria-label={v === 'grid' ? t.viewGrid : t.viewList}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 30,
                    borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: view === v ? 'var(--surface-3)' : 'transparent',
                    color: view === v ? 'var(--text)' : 'var(--faint)',
                  }}>
                  {v === 'grid' ? <LayoutGrid size={14} /> : <List size={14} />}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div style={{ ...panel, padding: 18, display: 'flex', alignItems: 'center', gap: 9, color: 'var(--red)', fontSize: 12.5 }}>
              <AlertTriangle size={15} /> {t.loadError(error)}
            </div>
          ) : sessions.length === 0 && !transcribing ? (
            <div style={{ ...panel, padding: '26px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 5 }}>
                {query ? t.searchEmpty : t.empty}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                {query ? t.searchEmpty : (
                  <>{t.emptyHintBefore} <b style={{ color: 'var(--text)' }}>{t.record}</b>{', '}
                    <kbd style={kbd}>{readable(state?.shortcut ?? null) || '—'}</kbd> {t.emptyHintAfter}</>
                )}
              </div>
            </div>
          ) : view === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))', gap: 12 }}>
              {(recording || preparing || transcribing) && <LiveCard t={t} state={state} />}
              {sessions.map((s) => (
                <Card key={s.id} s={s} t={t} api={api} retrying={retrying === s.id}
                  onOpen={() => setPlayer(s.id)} onRetry={() => void retry(s.id)} onRemove={() => void remove(s)} />
              ))}
            </div>
          ) : (
            <div style={{ ...panel, overflow: 'hidden' }}>
              {/* A linha em processamento tem a MESMA anatomia da linha pronta:
                  um spinner solto colapsaria a altura e a lista saltaria quando
                  a sessão chegasse, bem no momento em que você está lendo. */}
              {transcribing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span className="skeleton" style={{ display: 'block', height: 9, width: '38%', borderRadius: 3, background: 'var(--surface-3)' }} />
                    <span style={{ ...num, fontSize: 11, color: 'var(--faint)' }}>{t.transcribing.toLowerCase()}</span>
                  </div>
                  <Wave mode="sweep" color="var(--accent)" bars={4} />
                </div>
              )}
              {sessions.map((s, i) => (
                <Row key={s.id} s={s} t={t} api={api} last={i === sessions.length - 1}
                  open={openId === s.id} detail={openId === s.id ? detail : null} copied={copied === s.id}
                  retrying={retrying === s.id} onRetry={() => void retry(s.id)}
                  onOpen={() => void open(s.id)} onCopy={(text) => copy(s.id, text)} onRemove={() => void remove(s)} />
              ))}
            </div>
          )}
        </div>

        {/* Some quando não há nada: uma coluna vazia rotulada é moldura de nada. */}
        {temLateral && words && (
          <aside style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            {/* Quatro leituras das mesmas sessões, empilhadas no MESMO cartão.
                A primeira é tarefa (o que ensinar), as outras três são leitura
                sobre você — por isso ela abre e elas ficam fechadas. */}
            <SidePanel id="teach" title={t.teachTitle} hint={t.teachHint} n={words.teach.length} t={t} defaultOpen>
              <Chips>
                {words.teach.map((w) => (
                  <Chip key={w.word} label={w.word} weight={w.n / Math.max(1, words.teach[0]?.n || 1)}
                    active={w.inLibrary} onClick={w.inLibrary ? undefined : () => void teach(w.word)}
                    title={t.wordTitle(w.word, w.n, w.sessions, w.proper, w.inLibrary)} />
                ))}
              </Chips>
            </SidePanel>

            <SidePanel id="top" title={t.topTitle} hint={t.topHint} n={words.top.length} t={t}>
              <Chips>
                {words.top.map((w: WordStat) => (
                  <Chip key={w.word} label={w.word} weight={w.n / Math.max(1, words.top[0]?.n || 1)}
                    count={w.n} title={t.statTitle(w.word, w.n, w.sessions)} />
                ))}
              </Chips>
            </SidePanel>

            <SidePanel id="rare" title={t.rareTitle} hint={t.rareHint} n={words.rare.length} t={t}>
              <Chips>
                {words.rare.map((w: WordStat) => (
                  <Chip key={w.word} label={w.word} weight={w.n / Math.max(1, words.rare[0]?.n || 1)}
                    count={w.n} title={t.statTitle(w.word, w.n, w.sessions)} />
                ))}
              </Chips>
            </SidePanel>

            <SidePanel id="tics" title={t.ticsTitle} hint={t.ticsHint} n={words.tics.length} t={t}>
              <Chips>
                {words.tics.map((w: TicStat) => (
                  <Chip key={w.word} label={w.word} weight={w.n / Math.max(1, words.tics[0]?.n || 1)}
                    count={w.perMin >= 0.1 ? `${w.perMin.toFixed(1)}/min` : w.n} warn
                    title={t.ticTitle(w.word, w.n, w.perMin.toFixed(1))} />
                ))}
              </Chips>
            </SidePanel>
          </aside>
        )}
      </div>

      {/* Resultado da última gravação. É o par do "deu certo/deu errado": a
          pílula some quando a gravação termina, e sem isto não sobra nada
          dizendo se o arquivo existe. */}
      {state?.last && state.last.at !== dismissed && !recording && !preparing && !transcribing && (
        <Result last={state.last} t={t} onOpen={(id) => { setPlayer(id); setDismissed(state.last!.at || 0); }}
          onClose={() => setDismissed(state.last?.at || 0)} />
      )}

      {player && (
        <Player id={player} sessions={sessions} api={api} t={t} canSweep={canSweep}
          onClose={() => setPlayer(null)}
          onGo={(id) => setPlayer(id)}
          onRetry={(id) => void retry(id)}
          onReload={() => void load(query)}
          retrying={retrying} />
      )}
    </div>
  );
}

/**
 * A MESMA onda faz os dois trabalhos, e é de propósito.
 *
 * `level`: altura pelo volume do microfone — prova que o áudio está entrando.
 * Barra parada com você falando é dispositivo errado, e sem isso você só
 * descobre depois de transcrever o silêncio.
 *
 * `sweep`: enquanto transcreve. Um spinner seria o loader genérico de qualquer
 * app; a onda varrendo diz o que está acontecendo — o que estava ouvindo agora
 * está lendo. Sem barra de progresso, porque não existe progresso pra mostrar.
 */
function Wave({ level = 0, mode = 'level', color = 'var(--text)', bars = 5 }: {
  level?: number; mode?: 'level' | 'sweep'; color?: string; bars?: number;
}): JSX.Element {
  return (
    <span aria-hidden className="wave" data-mode={mode}
      style={{ display: 'flex', alignItems: 'center', gap: 2, height: 14, marginLeft: 2 }}>
      {Array.from({ length: bars }, (_, i) => {
        const weight = 1 - Math.abs(i - (bars - 1) / 2) / bars;
        const h = Math.max(0.2, Math.min(1, level * (0.7 + weight)));
        return (
          <span key={i} style={{
            width: 2.5, height: '100%', borderRadius: 2, background: color,
            animationDelay: `${i * 0.09}s`,
            ...(mode === 'level'
              ? { opacity: 0.35 + h * 0.55, transform: `scaleY(${h.toFixed(2)})`, transition: 'transform 90ms linear, opacity 90ms linear' }
              : null),
          }} />
        );
      })}
    </span>
  );
}

function Source({ on, onClick, icon, name, t }: { on: boolean; onClick: () => void; icon: JSX.Element; name: string; t: Strings }): JSX.Element {
  return (
    <button className="seg" onClick={onClick} aria-pressed={on}
      title={t.sourceHint(name, on)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 7,
        border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
        background: on ? 'var(--surface-3)' : 'transparent',
        color: on ? 'var(--text)' : 'var(--faint)',
      }}>
      {icon} {name}
    </button>
  );
}

function Row({ s, t, api, last, open, detail, copied, retrying, onRetry, onOpen, onCopy, onRemove }: {
  s: SessionSummary; t: Strings; api: RecorderApi; last: boolean; open: boolean;
  detail: Session | null; copied: boolean; retrying: boolean; onRetry: () => void;
  onOpen: () => void; onCopy: (text: string) => void; onRemove: () => void;
}): JSX.Element {
  // Copia o texto ARRUMADO, não a fala picada: quem clica em copiar vai colar
  // num e-mail, num brief ou num chat, e é lá que a transcrição crua aparece
  // como bloco ilegível. A fala com tempo continua na tela, pra pular no áudio.
  const text = detail ? tidyToText(detail.segments, detail.text) : s.preview || '';
  return (
    <div style={{ borderBottom: last && !open ? 'none' : '1px solid var(--border-soft)' }}>
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 13px' }}>
        <button onClick={onOpen} aria-expanded={open}
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {/* O que se lê é a FALA, cortada pela largura da coluna. Um "título"
              de N palavras produz frase quebrada no meio, que parece defeito. */}
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.preview}
          </span>
          <span style={{ ...num, fontSize: 11, color: 'var(--faint)', display: 'flex', gap: 8 }}>
            <span>{when(s.createdAt, t)}</span>
            <span>{mmss(s.durMs)}</span>
            {/* Motor só aparece quando NÃO é o padrão: "groq" em toda linha é
                textura. "local" é o que explica a demora e o custo zero. */}
            {s.engine === 'local' && <span style={{ color: 'var(--yellow)' }}>{t.localEngine}</span>}
            {s.kind === 'dictation' && <span>{t.dictation}</span>}
            {s.status === 'processing' && <span style={{ color: 'var(--accent)' }}>{t.processing}</span>}
            {s.status === 'failed' && <span style={{ color: 'var(--red)' }} title={t.failedHint(s.error || '')}>{t.failed}</span>}
          </span>
        </button>

        <div className="actions" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {s.status === 'failed' && (
            <button className="icon-btn" onClick={onRetry} disabled={retrying} title={t.retry} aria-label={t.retry}>
              <RotateCcw size={14} />
            </button>
          )}
          <button className="icon-btn" onClick={() => onCopy(text)} title={t.copy} aria-label={t.copy}>
            {copied ? <Check size={14} color="var(--accent)" /> : <Copy size={14} />}
          </button>
          <a className="icon-btn" href={api.mediaUrl(s.id, 'mp3')} download={`${s.id}.mp3`} title={t.downloadMp3} aria-label={t.downloadMp3}>
            <FileAudio size={14} />
          </a>
          {s.hasVideo && (
            <a className="icon-btn" href={api.mediaUrl(s.id, 'mp4')} download={`${s.id}.mp4`} title={t.downloadMp4} aria-label={t.downloadMp4}>
              <FileVideo size={14} />
            </a>
          )}
          <button className="icon-btn" data-danger="" onClick={onRemove} title={t.remove} aria-label={t.remove}>
            <Trash2 size={14} />
          </button>
        </div>
        <ChevronDown size={14} color="var(--faint)"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
      </div>

      {open && (
        <div className="panel-in" style={{ padding: '4px 13px 16px' }}>
          {!detail ? (
            <div style={{ fontSize: 12, color: 'var(--faint)', padding: '8px 0' }}>{t.opening}</div>
          ) : (
            <>
              {s.hasVideo ? (
                <video controls src={api.mediaUrl(s.id, 'mp4')}
                  style={{ width: '100%', maxHeight: 340, borderRadius: 8, background: 'var(--bg)', marginBottom: 12 }} />
              ) : (
                <audio controls src={api.mediaUrl(s.id, 'mp3')} style={{ width: '100%', height: 34, marginBottom: 12 }} />
              )}
              <div style={{ display: 'grid', gap: 5, fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>
                {detail.segments?.length ? detail.segments.map((seg, i) => (
                  <p key={i} style={{ display: 'flex', gap: 9 }}>
                    <button className="ts" style={{ ...num, fontSize: 10.5, paddingTop: 3, flexShrink: 0 }}
                      onClick={() => {
                        const el = document.querySelector<HTMLMediaElement>(`[src="${api.mediaUrl(s.id, s.hasVideo ? 'mp4' : 'mp3')}"]`);
                        if (el) { el.currentTime = seg.start; void el.play(); }
                      }}
                      title={t.jumpTo}>
                      {mmss(seg.start * 1000)}
                    </button>
                    <span>{seg.text}</span>
                  </p>
                )) : <p>{detail.text || <em style={{ color: 'var(--faint)' }}>{t.silence}</em>}</p>}
              </div>
              <div style={{ ...money, fontSize: 10.5, color: 'var(--faint)', marginTop: 12 }}>
                {t.engineLine(detail.engine, money$(detail.costUsd || 0))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * O cartão da lateral, um só pros quatro painéis.
 *
 * Antes havia UM bloco desenhado à mão ("pra ensinar ao whisper") e cada painel
 * novo seria outro bloco desenhado à mão: quatro títulos com espaçamento
 * levemente diferente é como uma lateral vira colcha de retalho. Aqui o título,
 * o contador, o estado aberto e a dica moram num lugar só.
 *
 * Fica lembrado por painel: quem abriu "vícios de linguagem" quer ele aberto na
 * próxima gravação, e quem fechou não quer ser lembrado de novo.
 */
function SidePanel({ id, title, hint, n, t, defaultOpen, children }: {
  id: string; title: string; hint: string; n: number; t: Strings;
  defaultOpen?: boolean; children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(`rec:panel:${id}`);
      return v === null ? !!defaultOpen : v === 'open';
    } catch { return !!defaultOpen; }
  });

  const toggle = (): void => {
    setOpen((v) => {
      try { localStorage.setItem(`rec:panel:${id}`, v ? 'closed' : 'open'); } catch { /* modo anônimo */ }
      return !v;
    });
  };

  return (
    <div style={{ ...panel, overflow: 'hidden' }}>
      <button onClick={toggle} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ ...label }}>{title}</span>
        <span style={{ ...num, marginLeft: 'auto', fontSize: 10.5, color: 'var(--faint)' }}>{n}</span>
        <ChevronDown size={13} color="var(--faint)"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
      </button>
      {open && (
        <div className="panel-in" style={{ padding: '0 11px 11px' }}>
          {n > 0 ? children : <p style={{ fontSize: 11.5, color: 'var(--faint)' }}>{t.panelEmpty}</p>}
          <p style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.55, marginTop: 9 }}>{hint}</p>
        </div>
      )}
    </div>
  );
}

const Chips = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{children}</div>
);

/**
 * A pastilha de palavra. O TAMANHO diz a frequência — é o que faz a lista ser
 * lida de relance em vez de linha por linha. Sem `onClick` ela não finge ser
 * botão: cursor normal, e o clique não faz nada.
 */
function Chip({ label: text, weight, count, active, warn, title, onClick }: {
  label: string; weight: number; count?: number | string; active?: boolean; warn?: boolean;
  title: string; onClick?: () => void;
}): JSX.Element {
  const cor = active ? 'var(--accent)' : warn ? 'var(--yellow)' : 'var(--muted)';
  return (
    <button className="seg" onClick={onClick} title={title} disabled={!onClick}
      style={{
        ...mono, fontSize: 11 + Math.round(weight * 3), display: 'inline-flex', alignItems: 'baseline', gap: 5,
        padding: '3px 7px', borderRadius: 6, cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--border)'}`,
        background: active ? 'var(--accent-dim)' : 'var(--surface)',
        color: cor, opacity: 0.55 + weight * 0.45,
      }}>
      {text}
      {count !== undefined && <span style={{ ...num, fontSize: 9.5, opacity: 0.7 }}>{count}</span>}
    </button>
  );
}

/**
 * Campo de captura do atalho: clica, aperta a combinação, pronto.
 *
 * Três coisas fazem isto funcionar e nenhuma é óbvia:
 *   1. o atalho antigo SAI DO AR enquanto o campo está focado — atalho global
 *      intercepta antes de qualquer página, e apertar a combinação atual pra
 *      reconfirmar dispararia uma gravação;
 *   2. exige modificador — sem isso dava pra gravar "a" como atalho global e
 *      perder a letra A no sistema inteiro;
 *   3. usa `e.code`, não `e.key` — com Ctrl+Shift apertado o `key` vem como o
 *      caractere transformado, e o acelerador quer a tecla física.
 */
function ShortcutCapture({ shortcut, t, hint, onShortcut, onPause }: {
  shortcut: string | null; t: Strings; hint?: string;
  onShortcut: (acc: string) => void; onPause: (v: boolean) => void;
}): JSX.Element {
  const [capturing, setCapturing] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { (e.target as HTMLElement).blur(); return; }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) { setWarning(null); return; }

    const mods: string[] = [];
    if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');

    const c = e.code;
    let key = '';
    if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
    else if (/^Digit\d$/.test(c)) key = c.slice(5);
    else if (/^F\d{1,2}$/.test(c)) key = c;
    else if (c === 'Space') key = 'Space';
    if (!key) { setWarning(t.shortcutBadKey); return; }

    // Tecla de função pode andar sozinha — mas só até F11. O Windows reserva o
    // F12 pro debugger e RECUSA F13 a F24 sem modificador (medido: registrar
    // devolve falso, sem conflito nenhum). Deixar escolher aqui só empurraria a
    // descoberta pra depois, na forma de um atalho que não faz nada.
    const soltaProibida = /^F(1[2-9]|2[0-4])$/.test(key);
    if (!mods.length && (!/^F\d{1,2}$/.test(key) || soltaProibida)) { setWarning(t.shortcutNeedsModifier); return; }

    setWarning(null);
    onShortcut([...mods, key].join('+'));
    (e.target as HTMLElement).blur();
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div role="button" tabIndex={0}
        onFocus={() => { setCapturing(true); setWarning(null); onPause(true); }}
        onBlur={() => { setCapturing(false); onPause(false); }}
        onKeyDown={onKeyDown}
        title={t.shortcutChange}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 190, height: 34, padding: '0 12px',
          borderRadius: 8, cursor: 'pointer', userSelect: 'none',
          border: `1px solid ${capturing ? 'var(--accent)' : 'var(--border)'}`,
          background: 'var(--surface-2)',
        }}>
        {capturing ? (
          <>
            <Wave mode="sweep" color="var(--accent)" bars={3} />
            <span style={{ fontSize: 12.5, color: 'var(--accent)' }}>{t.shortcutPress}</span>
          </>
        ) : (
          <>
            <span style={{ ...mono, fontSize: 12, color: 'var(--text)' }}>{readable(shortcut) || t.shortcutNone}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--faint)' }}>{t.shortcutChange}</span>
          </>
        )}
      </div>
      <span style={{ fontSize: 11.5, color: warning ? 'var(--yellow)' : 'var(--faint)', maxWidth: 260, lineHeight: 1.5 }}>
        {warning || hint || t.shortcutHint}
      </span>
    </div>
  );
}

function SettingsPanel({ settings, keyHint, encrypted, shortcut, shortcutScreen, extraShortcuts, t, api, onSave, onClose, onKey, onShortcut, onShortcutScreen, onPause }: {
  settings: Settings; keyHint: string | null; encrypted: boolean;
  shortcut: string | null; shortcutScreen: string | null; extraShortcuts?: ExtraShortcut[];
  t: Strings; api: RecorderApi;
  onSave: (p: Partial<Settings>) => Promise<void>; onClose: () => void;
  onKey: (key: string) => Promise<void>; onShortcut: (acc: string) => void;
  onShortcutScreen: (acc: string) => void; onPause: (v: boolean) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [test, setTest] = useState<null | { ok: boolean; error?: string }>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState('');

  useEffect(() => { void api.getVocabulary().then(setTerms); }, [api]);

  const saveTerms = async (list: string[]): Promise<void> => {
    setTerms(list);
    await api.setVocabulary(list);
  };
  const addTerms = (): void => {
    const next = term.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
    if (!next.length) return;
    void saveTerms([...new Set([...terms, ...next])]);
    setTerm('');
  };

  const subLabel = { fontSize: 12, fontWeight: 500, color: 'var(--muted)' } as const;

  return (
    <div className="panel-in" style={{ ...panel, padding: 16, marginBottom: 14, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.settings}</span>
        <button className="icon-btn" onClick={onClose} style={{ marginLeft: 'auto' }} aria-label={t.closeSettings}><X size={14} /></button>
      </div>

      <div>
        <div style={{ ...subLabel, marginBottom: 7 }}>{t.keyLabel}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} type="password" spellCheck={false}
            placeholder={t.keyPlaceholder(keyHint)}
            style={{ flex: '1 1 220px', minWidth: 0, padding: '7px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13, ...mono }} />
          <button onClick={async () => { await onKey(draft.trim()); setDraft(''); setTest(null); }} disabled={!draft.trim()}
            style={{ padding: '7px 13px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: draft.trim() ? 'pointer' : 'default', border: `1px solid ${draft.trim() ? 'var(--accent)' : 'var(--border)'}`, background: draft.trim() ? 'var(--accent-dim)' : 'var(--surface-2)', color: draft.trim() ? 'var(--accent)' : 'var(--faint)' }}>
            {t.save}
          </button>
          {keyHint && (
            <button onClick={async () => setTest(await api.testKey())}
              style={{ padding: '7px 13px', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)' }}>
              {t.test}
            </button>
          )}
          {test && (
            <span style={{ fontSize: 12, color: test.ok ? 'var(--accent)' : 'var(--red)' }}>
              {test.ok ? t.keyOk : t.keyRejected(String(test.error))}
            </span>
          )}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.55, marginTop: 7 }}>
          {encrypted ? t.keyStoredEncrypted : t.keyMemoryOnly}{' '}{t.price}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <Toggle label={t.pasteLabel} hint={t.pasteHint}
          on={settings.paste} onToggle={() => void onSave({ paste: !settings.paste })} />
        <Toggle label={t.polishLabel} hint={t.polishHint}
          on={settings.polish} onToggle={() => void onSave({ polish: !settings.polish })} />
        <Toggle label={t.localLabel} hint={t.localHint}
          on={settings.engine === 'local'} onToggle={() => void onSave({ engine: settings.engine === 'local' ? 'groq' : 'local' })} />
      </div>

      <div>
        <div style={{ ...subLabel, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Keyboard size={12} /> {t.shortcutLabel}
        </div>
        <ShortcutCapture shortcut={shortcut} t={t} onShortcut={onShortcut} onPause={onPause} />
      </div>

      <div>
        <div style={{ ...subLabel, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
          <MonitorPlay size={12} /> {t.shortcutScreenLabel}
        </div>
        <ShortcutCapture shortcut={shortcutScreen} t={t} hint={t.shortcutScreenHint}
          onShortcut={onShortcutScreen} onPause={onPause} />
      </div>

      {extraShortcuts?.map((x) => (
        <div key={x.id}>
          <div style={{ ...subLabel, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Keyboard size={12} /> {x.label}
          </div>
          <ShortcutCapture shortcut={x.value} t={t} hint={x.hint} onShortcut={x.onChange} onPause={onPause} />
        </div>
      ))}

      <div>
        <div style={{ ...subLabel, marginBottom: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={12} /> {t.libraryLabel}
          <span style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>{terms.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
          <input value={term} onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTerms(); } }}
            placeholder={t.libraryPlaceholder}
            style={{ flex: 1, padding: '7px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 13 }} />
          <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label={t.libraryAdd} onClick={addTerms}>
            <Plus size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 132, overflowY: 'auto' }}>
          {/* `item`, e não `t`: o `t` deste arquivo é o dicionário de strings, e
              o map sombreando ele foi o único erro que a extração introduziu. */}
          {terms.map((item) => (
            <span key={item} style={{ ...mono, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 4px 3px 8px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
              {item}
              <button className="icon-btn" style={{ width: 16, height: 16 }} aria-label={t.libraryRemove(item)}
                onClick={() => void saveTerms(terms.filter((x) => x !== item))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.55, marginTop: 8 }}>
          {t.libraryHint}
        </p>
      </div>
    </div>
  );
}

function Toggle({ label: text, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button onClick={onToggle} role="switch" aria-checked={on} className="seg"
      style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
      <span style={{
        width: 34, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative',
        background: on ? 'var(--accent)' : 'var(--surface-3)',
        transition: 'background-color var(--dur-fast) ease',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: '50%', background: 'var(--text)',
          transform: on ? 'translateX(14px)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--text)' }}>{text}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>{hint}</span>
      </span>
    </button>
  );
}

// ─── Galeria ─────────────────────────────────────────────────────────────────

const mb = (bytes: number): string => (bytes / 1_048_576).toFixed(bytes > 10_485_760 ? 0 : 1);

/**
 * O card. A capa é o conteúdo: cinco gravações de tela do mesmo dia são cinco
 * linhas idênticas numa lista, e cinco imagens diferentes numa grade.
 *
 * Sem capa (áudio, ditado, ou o ffmpeg que não gerou) o lugar dela NÃO fica
 * vazio: entra a onda estática, que ocupa a mesma caixa. Card sem imagem no
 * meio de cards com imagem lê como card quebrado.
 */
function Card({ s, t, api, retrying, onOpen, onRetry, onRemove }: {
  s: SessionSummary; t: Strings; api: RecorderApi; retrying: boolean;
  onOpen: () => void; onRetry: () => void; onRemove: () => void;
}): JSX.Element {
  const failed = s.status === 'failed';
  const busy = s.status === 'processing';

  return (
    <div className="card" style={{
      ...panel, overflow: 'hidden', position: 'relative',
      borderColor: failed ? 'var(--red)' : 'var(--border)',
    }}>
      <button onClick={onOpen} aria-label={t.play}
        style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{
          position: 'relative', aspectRatio: '16 / 9', background: 'var(--bg)',
          borderBottom: '1px solid var(--border-soft)', overflow: 'hidden',
        }}>
          {s.hasPoster ? (
            <img src={api.mediaUrl(s.id, 'jpg')} alt="" loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            // Sem capa (áudio, ditado, ou vídeo antigo): o lugar dela não fica
            // vazio. Um retângulo preto no meio de capas lê como card quebrado,
            // então entra o ícone da fonte sobre um fundo que é claramente
            // um fundo, e não uma imagem que não carregou.
            <span style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
              color: 'var(--faint)',
            }}>
              {s.hasVideo ? <MonitorPlay size={26} /> : <Mic size={26} />}
            </span>
          )}
          <span className="play" style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--bg) 45%, transparent)',
          }}>
            <Play size={22} fill="var(--text)" color="var(--text)" />
          </span>
          {/* Duração no canto, como em qualquer galeria de vídeo. É o dado que
              você usa pra escolher, e no rodapé competiria com a frase. */}
          <span style={{
            ...num, position: 'absolute', right: 6, bottom: 6, fontSize: 10.5, padding: '1px 5px',
            borderRadius: 4, background: 'color-mix(in srgb, #000 62%, transparent)', color: '#fff',
          }}>{mmss(s.durMs)}</span>
          <span style={{
            position: 'absolute', left: 6, top: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: 4,
            background: 'color-mix(in srgb, #000 62%, transparent)', color: '#fff',
          }}>
            {s.hasVideo ? <MonitorPlay size={10} /> : <Mic size={10} />}
            {s.hasVideo ? t.screenBadge : s.kind === 'dictation' ? t.dictation : t.mic}
          </span>
        </div>

        <div style={{ padding: '9px 11px 10px' }}>
          <span style={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            fontSize: 12.5, lineHeight: 1.45, color: s.preview ? 'var(--text)' : 'var(--faint)',
            minHeight: 36,
          }}>
            {busy ? t.processing : s.preview || (failed ? t.failed : t.noSpeech)}
          </span>
          <span style={{ ...num, display: 'flex', gap: 7, marginTop: 6, fontSize: 10.5, color: 'var(--faint)' }}>
            <span>{when(s.createdAt, t)}</span>
            {s.sizeBytes > 0 && <span>{t.size(mb(s.sizeBytes))}</span>}
            {s.engine === 'local' && <span style={{ color: 'var(--yellow)' }}>{t.localEngine}</span>}
          </span>
        </div>
      </button>

      {/* Estado do TEXTO, nunca da mídia: o vídeo está salvo nos três casos, e
          é por isso que a falha aparece como faixa no card e não como card
          cinza. Perder a transcrição não é perder a gravação. */}
      {busy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderTop: '1px solid var(--border-soft)' }}>
          <Wave mode="sweep" color="var(--accent)" bars={4} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t.processing}</span>
        </div>
      )}
      {failed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px 6px 11px', borderTop: '1px solid var(--border-soft)', background: 'var(--red-dim)' }}>
          <AlertTriangle size={12} color="var(--red)" style={{ flexShrink: 0 }} />
          <span title={t.failedHint(s.error || '')}
            style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.failed}
          </span>
          <button onClick={onRetry} disabled={retrying}
            style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--text)', fontSize: 11, fontWeight: 600, cursor: retrying ? 'default' : 'pointer' }}>
            <RotateCcw size={11} /> {retrying ? t.retrying : t.retry}
          </button>
        </div>
      )}

      <div className="actions" style={{ position: 'absolute', right: 5, top: 5, display: 'flex', gap: 2 }}>
        <a className="icon-btn" style={{ background: 'color-mix(in srgb, #000 55%, transparent)' }}
          href={api.mediaUrl(s.id, s.hasVideo ? 'mp4' : 'mp3')} download={`${s.id}.${s.hasVideo ? 'mp4' : 'mp3'}`}
          title={s.hasVideo ? t.downloadMp4 : t.downloadMp3} aria-label={s.hasVideo ? t.downloadMp4 : t.downloadMp3}>
          {s.hasVideo ? <FileVideo size={13} /> : <FileAudio size={13} />}
        </a>
        <button className="icon-btn" data-danger="" style={{ background: 'color-mix(in srgb, #000 55%, transparent)' }}
          onClick={onRemove} title={t.remove} aria-label={t.remove}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * O card da gravação que está acontecendo AGORA, na mesma caixa das outras.
 * Existe pra grade não saltar quando a sessão chega: sem ele o primeiro card
 * empurra a grade inteira no instante em que você está lendo.
 */
function LiveCard({ t, state }: { t: Strings; state: RecorderState | null }): JSX.Element {
  const rec = !!state?.recording;
  const color = rec ? 'var(--red)' : 'var(--yellow)';
  return (
    <div style={{ ...panel, overflow: 'hidden', borderColor: color }}>
      <div style={{
        position: 'relative', aspectRatio: '16 / 9', background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Wave mode="sweep" color={color} bars={9} />
        <span style={{
          position: 'absolute', left: 6, top: 6, display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
          padding: '2px 7px', borderRadius: 4, background: 'color-mix(in srgb, #000 62%, transparent)', color: '#fff',
        }}>
          <span className={rec ? 'skeleton' : undefined}
            style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
          {state?.kind === 'screen' ? t.screenBadge : t.mic}
        </span>
      </div>
      <div style={{ padding: '9px 11px 10px' }}>
        <span className="skeleton" style={{ display: 'block', height: 9, width: '70%', borderRadius: 3, background: 'var(--surface-3)' }} />
        <span style={{ ...num, display: 'block', marginTop: 9, fontSize: 10.5, color: 'var(--faint)' }}>
          {state?.preparing ? t.preparing : rec ? t.stop.toLowerCase() : t.processing}
        </span>
      </div>
    </div>
  );
}

/**
 * O player. Modal, e não expansão dentro da grade: expandir um card empurra a
 * linha inteira e move os outros de lugar, que é a coisa mais desorientadora
 * que uma galeria pode fazer.
 *
 * ←/→ andam entre as gravações sem fechar. Esc fecha.
 */
function Player({ id, sessions, api, t, canSweep, onClose, onGo, onRetry, onReload, retrying }: {
  id: string; sessions: SessionSummary[]; api: RecorderApi; t: Strings; canSweep: boolean;
  onClose: () => void; onGo: (id: string) => void; onRetry: (id: string) => void;
  onReload: () => void; retrying: string | null;
}): JSX.Element | null {
  // Ler ou editar. Nasce em ler SEMPRE, inclusive ao trocar de gravação: abrir
  // uma gravação pra ler e cair numa tela de corte seria o diálogo decidindo
  // por você o que você veio fazer.
  const [editando, setEditando] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  // Texto limpo por padrão: o que a pessoa abre a gravação pra fazer é LER e
  // COLAR em outro lugar, e transcrição crua não serve pra nenhum dos dois. Os
  // trechos com tempo continuam a um clique porque são eles que pulam no áudio.
  const [mode, setMode] = useState<'clean' | 'stamps'>(() => {
    try { return localStorage.getItem('rec:transcript') === 'stamps' ? 'stamps' : 'clean'; } catch { return 'clean'; }
  });
  const [copied, setCopied] = useState(false);
  // O que está no editor agora. Sai do `edited` gravado quando existe, e do
  // texto limpo automático quando não: uma retranscrição melhora o texto de
  // quem nunca editou e não apaga o de quem editou.
  const [html, setHtml] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepErr, setSweepErr] = useState<string | null>(null);
  const editorRef = useRef<TiptapEditor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const paragraphs = useMemo(() => tidyTranscript(detail?.segments, detail?.text || ''), [detail]);
  const limpo = useMemo(() => paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') || '<p></p>', [paragraphs]);
  const editavel = typeof api.saveTranscript === 'function';

  // `html` é só o que VOCÊ digitou nesta sessão de tela. Enquanto for null, o
  // que aparece é o gravado (ou o limpo automático). Guardar isso num estado
  // que começa vazio fazia o editor montar sem conteúdo, e o primeiro evento do
  // ProseMirror gravava esse vazio por cima do texto — perda silenciosa.
  const conteudo = html ?? detail?.edited ?? limpo;

  // Guarda 800 ms depois da última tecla. Guardar a cada tecla é uma escrita em
  // disco por letra; guardar só no fechar perde tudo quando o app cai.
  const change = (next: string): void => {
    if (next === conteudo) return;
    // Documento vazio só se você APAGOU tudo mesmo. Vindo do editor recém-montado
    // é o vazio de antes do conteúdo entrar, e gravar isso apaga a transcrição.
    if (VAZIO.test(next) && !VAZIO.test(conteudo)) return;
    setHtml(next);
    if (!api.saveTranscript) return;
    setSaving(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api.saveTranscript?.(id, next === limpo ? '' : next).finally(() => setSaving(false));
    }, 800);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Varre o que está NA TELA (com as suas edições), não a fala crua do banco:
  // varrer uma coisa e mostrar outra é o pior dos dois mundos.
  const varrer = async (): Promise<void> => {
    if (!api.sweep) return;
    const texto = editorRef.current?.getText({ blockSeparator: '\n\n' }) || paragraphs.join('\n\n');
    if (!texto.trim()) return;
    setSweeping(true);
    setSweepErr(null);
    try {
      setSweep(await api.sweep(id, texto));
    } catch (e) {
      setSweepErr(String((e as Error).message || e));
    } finally {
      setSweeping(false);
    }
  };

  const marcar = (taskId: string): void => {
    setSweep((atual) => {
      if (!atual) return atual;
      const next = { ...atual, tasks: atual.tasks.map((x) => (x.id === taskId ? { ...x, done: !x.done } : x)) };
      void api.saveSweep?.(id, next);
      return next;
    });
  };

  const limparSweep = (): void => {
    setSweep(null);
    setSweepErr(null);
    void api.saveSweep?.(id, null);
  };

  const restore = (): void => {
    if (!window.confirm(t.restoreConfirm)) return;
    setHtml(limpo);
    setDetail((d) => (d ? { ...d, edited: null } : d));
    void api.saveTranscript?.(id, '');
  };

  const pick = (v: 'clean' | 'stamps'): void => {
    setMode(v);
    try { localStorage.setItem('rec:transcript', v); } catch { /* modo anônimo */ }
  };

  // Copia o que está NA TELA: copiar uma coisa e mostrar outra é a forma mais
  // rápida de a pessoa colar em cima do cliente um bloco que ela não leu.
  const copy = (): void => {
    const e = editorRef.current;
    const text = mode === 'clean'
      ? (e ? e.getText({ blockSeparator: '\n\n' }) : paragraphs.join('\n\n'))
      : (detail?.segments?.length
        ? detail.segments.map((seg) => `${mmss(seg.start * 1000)}  ${seg.text.trim()}`).join('\n')
        : detail?.text || '');
    if (!text.trim()) return;

    // Duas versões na área de transferência: quem cola no Gmail ou no Notion
    // recebe o negrito e a lista, quem cola no terminal recebe texto puro. Onde
    // o navegador não souber fazer isso, texto puro é o que sempre funciona.
    const rico = mode === 'clean' && e ? e.getHTML() : '';
    if (rico && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      void navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([rico], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]).catch(() => navigator.clipboard.writeText(text));
    } else {
      void navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const i = sessions.findIndex((x) => x.id === id);
  const s = sessions[i];

  useEffect(() => {
    setDetail(null);
    setEditando(false);
    setCopied(false);
    setSweepErr(null);
    setSweep(null);
    setHtml(null);
    void api.getSession(id).then((s) => { setDetail(s); setSweep(s?.sweep || null); });
  }, [id, api]);

  useEffect(() => { box.current?.focus(); }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Esc volta UMA camada. Editando, a camada é o modo — fechar o diálogo
      // inteiro jogaria fora o trecho marcado por um atalho que a pessoa
      // apertou pra "sair disto aqui", não pra "sair de tudo".
      if (e.key === 'Escape') { e.preventDefault(); if (editando) setEditando(false); else onClose(); return; }
      // Seta só navega quando o foco NÃO está no player: dentro do <video> ela
      // é o atalho nativo de avançar 5 segundos, e sequestrar isso seria trocar
      // um controle que todo mundo conhece por um que ninguém pediu.
      const tag = document.activeElement?.tagName;
      if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'INPUT') return;
      // E no modo edição ela não navega de jeito nenhum: pular de gravação com
      // um trecho marcado apaga o trabalho em silêncio. Medido na tela aberta —
      // um ArrowRight levava de 0:27 pra outra gravação E saía do modo, sem
      // aviso nenhum. Atalho que destrói trabalho não é atalho, é armadilha.
      if (editando) return;
      if (e.key === 'ArrowRight' && sessions[i + 1]) { e.preventDefault(); onGo(sessions[i + 1].id); }
      if (e.key === 'ArrowLeft' && sessions[i - 1]) { e.preventDefault(); onGo(sessions[i - 1].id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, sessions, onClose, onGo, editando]);

  if (!s) return null;
  const src = api.mediaUrl(s.id, s.hasVideo ? 'mp4' : 'mp3');

  return (
    <div role="dialog" aria-modal="true" aria-label={s.preview || t.play}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: 'color-mix(in srgb, #000 72%, transparent)', backdropFilter: 'blur(3px)',
      }}>
      <div ref={box} tabIndex={-1} className="panel-in"
        style={{
          ...panel, outline: 'none', width: 'min(940px, 100%)', maxHeight: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 14px', borderBottom: '1px solid var(--border-soft)' }}>
          <span style={{ ...num, fontSize: 11.5, color: 'var(--faint)', display: 'flex', gap: 8 }}>
            <span>{when(s.createdAt, t)}</span>
            <span>{mmss(s.durMs)}</span>
            {s.sizeBytes > 0 && <span>{t.size(mb(s.sizeBytes))}</span>}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            <button className="icon-btn" onClick={() => sessions[i - 1] && onGo(sessions[i - 1].id)}
              disabled={!sessions[i - 1]} title={t.prev} aria-label={t.prev}><ChevronLeft size={15} /></button>
            <button className="icon-btn" onClick={() => sessions[i + 1] && onGo(sessions[i + 1].id)}
              disabled={!sessions[i + 1]} title={t.next} aria-label={t.next}><ChevronRight size={15} /></button>
            {api.exportClip && s.status !== 'failed' && (
              <button className="icon-btn" onClick={() => setEditando((v) => !v)}
                title={editando ? t.editLeave : t.edit} aria-label={editando ? t.editLeave : t.edit}
                aria-pressed={editando}>
                <Scissors size={15} color={editando ? 'var(--accent)' : undefined} />
              </button>
            )}
            {canSweep && api.sweep && (
              <button className="icon-btn" onClick={() => void varrer()}
                disabled={!detail || sweeping || s.status === 'failed'}
                title={t.sweep} aria-label={t.sweep}>
                <ListChecks size={15} color={sweep ? 'var(--accent)' : undefined} />
              </button>
            )}
            <button className="icon-btn" onClick={copy} disabled={!detail || s.status === 'failed'}
              title={copied ? t.copied : t.copy} aria-label={copied ? t.copied : t.copy}>
              {copied ? <Check size={15} color="var(--accent)" /> : <Copy size={15} />}
            </button>
            <a className="icon-btn" href={src} download={`${s.id}.${s.hasVideo ? 'mp4' : 'mp3'}`}
              title={s.hasVideo ? t.downloadMp4 : t.downloadMp3} aria-label={s.hasVideo ? t.downloadMp4 : t.downloadMp3}>
              {s.hasVideo ? <FileVideo size={14} /> : <FileAudio size={14} />}
            </a>
            <button className="icon-btn" onClick={onClose} title={t.close} aria-label={t.close}><X size={15} /></button>
          </span>
        </div>

        <div style={{ overflowY: 'auto', padding: 14 }}>
          {editando ? (
            <CercaDoEditor aviso={t.editFail} onSair={() => setEditando(false)}>
              <Suspense fallback={<div style={{ fontSize: 12, color: 'var(--faint)', padding: '14px 0' }}>{t.opening}</div>}>
                <QuickEdit key={id} id={s.id} src={src} hasVideo={!!s.hasVideo} durMs={s.durMs} api={api} t={t}
                  onSaved={(novo) => { setEditando(false); onReload(); onGo(novo); }} />
              </Suspense>
            </CercaDoEditor>
          ) : (<>
          {s.hasVideo ? (
            <video ref={media} controls autoPlay src={src}
              style={{ width: '100%', maxHeight: '52vh', borderRadius: 8, background: '#000', display: 'block' }} />
          ) : (
            <audio ref={media} controls autoPlay src={src} style={{ width: '100%', height: 36 }} />
          )}

          {s.status === 'failed' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--red-dim)' }}>
              <AlertTriangle size={15} color="var(--red)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{t.failedHint(s.error || '')}</span>
              <button onClick={() => onRetry(s.id)} disabled={retrying === s.id}
                style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <RotateCcw size={12} /> {retrying === s.id ? t.retrying : t.retry}
              </button>
            </div>
          ) : !detail ? (
            <div style={{ fontSize: 12, color: 'var(--faint)', padding: '14px 0 4px' }}>{t.opening}</div>
          ) : (
            <>
              {sweeping && !sweep && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 12.5, color: 'var(--faint)' }}>
                  <Wave mode="sweep" color="var(--accent)" bars={4} />
                  {t.sweeping}
                </div>
              )}
              {sweepErr && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--red-dim)' }}>
                  <AlertTriangle size={15} color="var(--red)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{t.sweepFail(sweepErr)}</span>
                </div>
              )}
              {sweep && (
                <SweepPanel sweep={sweep} t={t} busy={sweeping}
                  onToggle={marcar} onAgain={() => void varrer()} onClear={limparSweep} />
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                <span style={{ ...label }}>{mode === 'clean' ? t.transcriptClean : t.transcriptStamps}</span>
                {mode === 'clean' && saving && <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{t.saving}</span>}
                {mode === 'clean' && !saving && detail.edited && (
                  <>
                    <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>{t.edited}</span>
                    <button className="icon-btn" onClick={restore} title={t.restoreClean} aria-label={t.restoreClean}>
                      <RotateCcw size={13} />
                    </button>
                  </>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 2, padding: 3, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  {(['clean', 'stamps'] as const).map((v) => (
                    <button key={v} className="seg" aria-pressed={mode === v} onClick={() => pick(v)}
                      title={v === 'clean' ? t.transcriptClean : t.transcriptStamps}
                      aria-label={v === 'clean' ? t.transcriptClean : t.transcriptStamps}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 26,
                        borderRadius: 7, border: 'none', cursor: 'pointer',
                        background: mode === v ? 'var(--surface-3)' : 'transparent',
                        color: mode === v ? 'var(--text)' : 'var(--faint)',
                      }}>
                      {v === 'clean' ? <AlignLeft size={13} /> : <Clock size={13} />}
                    </button>
                  ))}
                </span>
              </div>

              {mode === 'clean' ? (
                paragraphs.length || detail.edited ? (
                  <TranscriptEditor key={id} html={conteudo} editable={editavel} t={t}
                    onChange={change} onReady={(e) => { editorRef.current = e; }} />
                ) : (
                  <p style={{ marginTop: 10 }}><em style={{ color: 'var(--faint)' }}>{t.silence}</em></p>
                )
              ) : (
                <div style={{ display: 'grid', gap: 5, marginTop: 10, fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>
                  {detail.segments?.length ? detail.segments.map((seg, k) => (
                    <p key={k} style={{ display: 'flex', gap: 9 }}>
                      <button className="ts" style={{ ...num, fontSize: 10.5, paddingTop: 3, flexShrink: 0 }}
                        onClick={() => { if (media.current) { media.current.currentTime = seg.start; void media.current.play(); } }}
                        title={t.jumpTo}>
                        {mmss(seg.start * 1000)}
                      </button>
                      <span>{seg.text}</span>
                    </p>
                  )) : <p>{detail.text || <em style={{ color: 'var(--faint)' }}>{t.silence}</em>}</p>}
                </div>
              )}
            </>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}

/**
 * Deu certo ou deu errado, na hora. A pílula flutuante some quando a gravação
 * termina, e antes disto não sobrava nada dizendo se o arquivo existe — você
 * ficava com o silêncio, que é indistinguível de ter perdido tudo.
 *
 * Não desaparece sozinho no erro: aviso que some é aviso que você perdeu.
 */
function Result({ last, t, onOpen, onClose }: {
  last: NonNullable<RecorderState['last']>; t: Strings;
  onOpen: (id: string) => void; onClose: () => void;
}): JSX.Element {
  const err = last.error;

  useEffect(() => {
    if (err) return;
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [err, onClose]);

  return (
    <div role="status" aria-live="polite"
      style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 40, maxWidth: 380,
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px 10px 13px',
        ...panel, borderColor: err ? 'var(--red)' : 'var(--border)',
        boxShadow: '0 10px 30px rgba(0,0,0,.45)',
        animation: 'toast-in var(--dur-base) var(--ease-out)',
      }}>
      {err
        ? <AlertTriangle size={15} color="var(--red)" style={{ flexShrink: 0 }} />
        : <Check size={15} color="var(--accent)" style={{ flexShrink: 0 }} />}
      <span style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.45, minWidth: 0 }}>
        {err ? t.savedFail(err) : t.savedOk(mmss(last.durMs || 0))}
        {!err && last.warning && (
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--yellow)' }}>{t.noMicWarning}</span>
        )}
      </span>
      {!err && last.id && (
        <button onClick={() => onOpen(last.id as string)}
          style={{ marginLeft: 'auto', flexShrink: 0, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {t.openRecording}
        </button>
      )}
      <button className="icon-btn" onClick={onClose} title={t.dismiss} aria-label={t.dismiss}
        style={{ flexShrink: 0, marginLeft: err ? 'auto' : 0 }}>
        <X size={13} />
      </button>
    </div>
  );
}
