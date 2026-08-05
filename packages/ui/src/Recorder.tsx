import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, Copy, FileAudio, FileVideo, Keyboard,
  Mic, MonitorPlay, Plus, Search, Settings2, Sparkles, Square, Trash2, Volume2, X,
} from 'lucide-react';
import type { RecorderState, Session, SessionSummary, Settings, WordCandidate } from '@stalkier/core';
import type { MonthUsage, RecorderApi } from './api.js';
import type { Strings } from './strings.js';

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

const readable = (acc: string | null): string =>
  (acc || '').replace('CommandOrControl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');

export interface RecorderProps {
  /** Como esta casca fala com o sistema. Ver `RecorderApi`. */
  api: RecorderApi;
  /** Todo texto da tela. `en` e `pt` saem deste pacote. */
  t: Strings;
}

/**
 * A tela do gravador, inteira. Os dois apps montam ESTE componente: o público
 * com o adaptador de IPC e o inglês, a aba do Jaques Studio com o adaptador
 * HTTP e o português. Layout, estados, teclado e decisões são um só.
 */
export function Recorder({ api, t }: RecorderProps): JSX.Element {
  const [state, setState] = useState<RecorderState | null>(null);
  const [level, setLevel] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [month, setMonth] = useState<MonthUsage>({ cost: 0, sessions: 0, ms: 0 });
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Session | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [words, setWords] = useState<WordCandidate[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState(true);
  const [ffmpeg, setFfmpeg] = useState(true);
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

  // Cronômetro: só existe enquanto grava.
  useEffect(() => {
    if (!state?.recording) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [state?.recording]);

  const recording = !!state?.recording;
  const transcribing = !!state?.transcribing;
  const noKey = settings?.engine !== 'local' && !keyHint;

  const start = (kind: 'audio' | 'screen'): void => {
    void api
      .start({ kind, mic: settings?.mic ?? true, system: settings?.system ?? false })
      .then(setState);
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

  const teach = async (term: string): Promise<void> => {
    const list = await api.getVocabulary();
    await api.setVocabulary([...new Set([...list, term])]);
    setWords((w) => w.map((x) => (x.word === term ? { ...x, inLibrary: true } : x)));
  };

  const maxN = useMemo(() => Math.max(1, ...words.map((w) => w.n)), [words]);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 24px 40px' }}>
      <style>{`
        .row { transition: background-color var(--dur-fast) ease; }
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
          .row, .actions, .primary, .seg, .panel-in { transition-duration: .01ms; animation-duration: .01ms; }
          .skeleton { animation: none; }
          .wave[data-mode="sweep"] > span { animation: none; transform: scaleY(0.6); opacity: 0.6; }
        }
      `}</style>

      {/* ─── Controle: o único primário da tela ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {recording ? (
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
          settings={settings} keyHint={keyHint} encrypted={encrypted} shortcut={state?.shortcut ?? null} t={t} api={api}
          onSave={save} onClose={() => setSettingsOpen(false)}
          onKey={async (k) => { await api.setKey(k); loadSettings(); }}
          onShortcut={(acc) => { void save({ shortcut: acc }); void api.shortcut(acc).then(() => api.state().then((s) => setState(s as RecorderState))); }}
          onPause={(v) => void api.pauseShortcut(v).then(() => api.state().then((s) => setState(s as RecorderState)))}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: words.length ? 'minmax(0, 1fr) 232px' : 'minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={13} color="var(--faint)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              style={{
                width: '100%', padding: '8px 11px 8px 32px', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13,
              }} />
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
                  onOpen={() => void open(s.id)} onCopy={(t) => copy(s.id, t)} onRemove={() => void remove(s)} />
              ))}
            </div>
          )}
        </div>

        {/* Some quando não há nada: uma coluna vazia rotulada é moldura de nada. */}
        {words.length > 0 && (
          <aside>
            {/* Não é "as palavras que você mais fala" — isso é curiosidade. É o
                que o modelo provavelmente vai errar da próxima vez. O rótulo diz
                a tarefa, não a métrica. */}
            <div style={{ ...label, marginBottom: 9 }}>{t.teachTitle}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {words.map((w) => (
                <button key={w.word} className="seg"
                  onClick={() => !w.inLibrary && void teach(w.word)}
                  title={t.wordTitle(w.word, w.n, w.sessions, w.proper, w.inLibrary)}
                  style={{
                    ...mono, fontSize: 11 + Math.round((w.n / maxN) * 3),
                    padding: '3px 7px', borderRadius: 6, cursor: w.inLibrary ? 'default' : 'pointer',
                    border: `1px solid ${w.inLibrary ? 'var(--accent-dim)' : 'var(--border)'}`,
                    background: w.inLibrary ? 'var(--accent-dim)' : 'var(--surface)',
                    color: w.inLibrary ? 'var(--accent)' : 'var(--muted)',
                    opacity: 0.55 + (w.n / maxN) * 0.45,
                  }}>
                  {w.word}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.55, marginTop: 10 }}>
              {t.teachHint}
            </p>
          </aside>
        )}
      </div>
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

function Row({ s, t, api, last, open, detail, copied, onOpen, onCopy, onRemove }: {
  s: SessionSummary; t: Strings; api: RecorderApi; last: boolean; open: boolean;
  detail: Session | null; copied: boolean;
  onOpen: () => void; onCopy: (text: string) => void; onRemove: () => void;
}): JSX.Element {
  const text = detail?.text || s.preview || '';
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
          </span>
        </button>

        <div className="actions" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
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
function ShortcutCapture({ shortcut, t, onShortcut, onPause }: {
  shortcut: string | null; t: Strings; onShortcut: (acc: string) => void; onPause: (v: boolean) => void;
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

    // Tecla de função é a única que pode andar sozinha: F9 não aparece no meio
    // de um texto, então sequestrá-la globalmente não custa nada.
    if (!mods.length && !/^F\d{1,2}$/.test(key)) { setWarning(t.shortcutNeedsModifier); return; }

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
        {warning || t.shortcutHint}
      </span>
    </div>
  );
}

function SettingsPanel({ settings, keyHint, encrypted, shortcut, t, api, onSave, onClose, onKey, onShortcut, onPause }: {
  settings: Settings; keyHint: string | null; encrypted: boolean; shortcut: string | null;
  t: Strings; api: RecorderApi;
  onSave: (p: Partial<Settings>) => Promise<void>; onClose: () => void;
  onKey: (key: string) => Promise<void>; onShortcut: (acc: string) => void; onPause: (v: boolean) => void;
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
