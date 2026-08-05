import type { RecorderState } from '../../shared/types';

/** O HUD. Visível pra você, fora de qualquer captura (ver setContentProtection). */

const pill = document.getElementById('pill')!;
const time = document.getElementById('time')!;
const label = document.getElementById('label')!;
const level = document.getElementById('level')!;

const BARS = 7;
for (let i = 0; i < BARS; i++) level.appendChild(document.createElement('i'));
const bars = [...level.children] as HTMLElement[];

let since = 0;
let timer: number | undefined;

const mmss = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

window.api.rec.onState((raw) => {
  const s = raw as unknown as RecorderState;
  const mode = s.recording ? 'recording' : s.transcribing ? 'transcribing' : 'idle';
  pill.dataset.mode = mode;

  if (mode === 'idle') {
    pill.removeAttribute('data-on');
    window.clearInterval(timer);
    return;
  }
  requestAnimationFrame(() => pill.setAttribute('data-on', ''));

  if (s.recording) {
    since = s.since || Date.now();
    label.textContent = s.kind === 'screen' ? 'screen' : '';
    window.clearInterval(timer);
    time.textContent = mmss(Date.now() - since);
    timer = window.setInterval(() => (time.textContent = mmss(Date.now() - since)), 250);
  } else {
    // O cronômetro CONGELA no tempo gravado em vez de sumir: ele deixa de ser
    // cronômetro e vira informação — quanto áudio está sendo lido.
    window.clearInterval(timer);
    label.textContent = 'transcribing';
    bars.forEach((b) => {
      b.style.transform = '';
      b.removeAttribute('data-lit');
    });
  }
});

// Onda com decaimento: o pico salta na hora (você fala, ela sobe) e cai devagar,
// senão a barra pisca a 20 Hz e vira ruído em vez de sinal.
let smooth = 0;
window.api.rec.onLevel((raw) => {
  const v = Number(raw) || 0;
  smooth = Math.max(v, smooth * 0.82);
  bars.forEach((b, i) => {
    const weight = 1 - Math.abs(i - (BARS - 1) / 2) / BARS;
    const h = Math.max(0.22, Math.min(1, smooth * (0.7 + weight)));
    b.style.transform = `scaleY(${h.toFixed(2)})`;
    if (h > 0.3) b.setAttribute('data-lit', '');
    else b.removeAttribute('data-lit');
  });
});
