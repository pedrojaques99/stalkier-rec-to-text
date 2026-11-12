import { useState } from 'react';
import { Check, Copy, ListChecks, RotateCcw, Trash2 } from 'lucide-react';
import type { Sweep as SweepData } from '@stalkier/core';
import type { Strings } from './strings.js';

/**
 * O que sobra da conversa quando se tira a conversa.
 *
 * Uma gravação de reunião só vira trabalho quando alguém lê e escreve o que
 * ficou decidido, quem faz o quê e o que ficou no ar. Este bloco é esse passo,
 * e ele fica ACIMA da transcrição de propósito: a transcrição é a prova, o
 * checklist é o que você veio buscar.
 *
 * As tarefas são marcáveis e o estado é gravado. Checklist que não marca é
 * decoração, e decoração é o que faz alguém copiar tudo pro Notion na mão.
 */
export function SweepPanel({ sweep, t, busy, onToggle, onAgain, onClear }: {
  sweep: SweepData;
  t: Strings;
  busy: boolean;
  onToggle: (id: string) => void;
  onAgain: () => void;
  onClear: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const vazio = !sweep.decisions.length && !sweep.tasks.length && !sweep.open.length;

  const copy = (): void => {
    const linhas: string[] = [];
    if (sweep.decisions.length) {
      linhas.push(`## ${t.sweepDecisions}`, ...sweep.decisions.map((d) => `- ${d}`), '');
    }
    if (sweep.tasks.length) {
      linhas.push(`## ${t.sweepTasks}`, ...sweep.tasks.map((x) => `- [${x.done ? 'x' : ' '}] ${x.text}${x.who ? ` (${x.who})` : ''}`), '');
    }
    if (sweep.open.length) {
      linhas.push(`## ${t.sweepOpen}`, ...sweep.open.map((o) => `- ${o}`));
    }
    void navigator.clipboard.writeText(linhas.join('\n').trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="panel-in" style={{
      marginTop: 14, padding: '11px 13px 13px', borderRadius: 10,
      border: '1px solid var(--border)', background: 'var(--surface-2)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: vazio ? 0 : 10 }}>
        <ListChecks size={14} color="var(--accent)" />
        <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          {busy ? t.sweeping : t.sweepEngine(sweep.engine)}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button className="icon-btn" onClick={copy} title={copied ? t.copied : t.copy} aria-label={copied ? t.copied : t.copy}>
            {copied ? <Check size={13} color="var(--accent)" /> : <Copy size={13} />}
          </button>
          <button className="icon-btn" onClick={onAgain} disabled={busy} title={t.sweepAgain} aria-label={t.sweepAgain}>
            <RotateCcw size={13} />
          </button>
          <button className="icon-btn" data-danger="" onClick={onClear} title={t.sweepClear} aria-label={t.sweepClear}>
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {vazio ? (
        <p style={{ fontSize: 12.5, color: 'var(--faint)' }}>{t.sweepEmpty}</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <Bloco title={t.sweepDecisions} n={sweep.decisions.length}>
            {sweep.decisions.map((d, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>{d}</li>
            ))}
          </Bloco>

          {sweep.tasks.length > 0 && (
            <div>
              <Titulo>{t.sweepTasks}</Titulo>
              <div style={{ display: 'grid', gap: 5 }}>
                {sweep.tasks.map((task) => (
                  <label key={task.id}
                    style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, lineHeight: 1.5 }}>
                    <input type="checkbox" checked={task.done} onChange={() => onToggle(task.id)}
                      style={{ marginTop: 3, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    <span style={{
                      color: task.done ? 'var(--faint)' : 'var(--text)',
                      textDecoration: task.done ? 'line-through' : 'none',
                    }}>
                      {task.text}
                      {task.who && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent)' }}>{task.who}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Bloco title={t.sweepOpen} n={sweep.open.length}>
            {sweep.open.map((o, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>{o}</li>
            ))}
          </Bloco>
        </div>
      )}
    </div>
  );
}

const Titulo = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div style={{
    fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--faint)', marginBottom: 5,
  }}>
    {children}
  </div>
);

/** Bloco de lista que some quando está vazio: título sem item é moldura de nada. */
function Bloco({ title, n, children }: { title: string; n: number; children: React.ReactNode }): JSX.Element | null {
  if (!n) return null;
  return (
    <div>
      <Titulo>{title}</Titulo>
      <ul style={{ display: 'grid', gap: 4, margin: 0, paddingLeft: 16 }}>{children}</ul>
    </div>
  );
}
