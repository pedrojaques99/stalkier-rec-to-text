/**
 * Dono do getUserMedia/MediaRecorder. Fica escondido e vivo o app inteiro: é
 * isso que faz o atalho global funcionar com a janela principal minimizada.
 *
 * O áudio sai daqui em PEDAÇOS (timeslice de 3s) e o processo principal vai
 * gravando em disco. Acumular o blob inteiro na memória custaria ~1,1 GB por
 * hora de tela, e é o tipo de limite que só aparece na reunião longa.
 *
 * Uma trilha de áudio só, sempre: mic e som do sistema entram num AudioContext
 * e saem mixados. Duas trilhas dariam dois arquivos, duas transcrições e a
 * pergunta "por que o texto está duplicado?".
 */

interface Config {
  kind: 'audio' | 'screen';
  mic: boolean;
  system: boolean;
  dictation: boolean;
  sourceId: string | null;
}

// H.264 primeiro: o mp4 do lado do processo principal vira remux (~1s) em vez
// de re-encode (minutos). Se o Chromium não oferecer, VP9/VP8 e o mp4 é
// re-encodado — mais lento, mas nunca falha.
const VIDEO_MIMES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/webm'];

const pickMime = (list: string[]): string => list.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

let recorder: MediaRecorder | null = null;
let streams: MediaStream[] = [];
let ctx: AudioContext | null = null;
let raf = 0;
let startedAt = 0;
let cancelled = false;

function stopEverything(): void {
  cancelAnimationFrame(raf);
  for (const s of streams) for (const t of s.getTracks()) t.stop();
  streams = [];
  if (ctx) {
    void ctx.close().catch(() => {});
    ctx = null;
  }
}

/** Nível do áudio pro HUD: é o que prova que o microfone está entrando. */
function meter(source: AudioNode, audioCtx: AudioContext): void {
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  let last = 0;
  const loop = (): void => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    const now = performance.now();
    if (now - last > 50) {
      last = now;
      window.api.recorder.level(Math.min(1, peak / 90));
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
}

async function begin(cfg: Config): Promise<void> {
  cancelled = false;
  try {
    const withAudio: MediaStream[] = [];
    let video: MediaStreamTrack | null = null;

    // O som do sistema (loopback) SÓ chega pelo getDisplayMedia, inclusive
    // quando não se quer vídeo nenhum, porque a especificação exige pedir
    // vídeo. Numa gravação só de áudio a trilha de vídeo é descartada na hora;
    // sem esse desvio, "som do sistema" não faria nada numa reunião sem tela.
    if (cfg.kind === 'screen' || cfg.system) {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: cfg.system });
      streams.push(display);
      if (cfg.kind === 'screen') video = display.getVideoTracks()[0] ?? null;
      else display.getVideoTracks().forEach((t) => t.stop());
      if (cfg.system && display.getAudioTracks().length) withAudio.push(display);
    }
    if (cfg.mic) {
      // Microfone ausente ou ocupado NAO derruba uma gravacao de tela: voce
      // fica com o video e o som do sistema, que e melhor do que ficar sem
      // nada e descobrir depois. Numa gravacao so de audio, ai sim e fatal.
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streams.push(mic);
        withAudio.push(mic);
      } catch (e) {
        if (!video && !withAudio.length) throw e;
      }
    }
    // Video mudo e uma gravacao legitima (demo de tela sem narracao). O que nao
    // existe e gravacao sem video E sem audio.
    if (!withAudio.length && !video) throw new Error('no audio source available');

    ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const mix = ctx.createGain();
    mix.connect(dest);
    for (const s of withAudio) ctx.createMediaStreamSource(s).connect(mix);
    if (withAudio.length) meter(mix, ctx);

    const audioTracks = withAudio.length ? dest.stream.getAudioTracks() : [];
    const finalStream = new MediaStream([...audioTracks, ...(video ? [video] : [])]);
    const mime = pickMime(video ? VIDEO_MIMES : AUDIO_MIMES);
    recorder = new MediaRecorder(finalStream, {
      mimeType: mime || undefined,
      audioBitsPerSecond: 96_000,
      videoBitsPerSecond: 2_500_000,
    });
    recorder.ondataavailable = async (e) => {
      if (!e.data.size || cancelled) return;
      window.api.recorder.chunk(await e.data.arrayBuffer());
    };
    recorder.onstop = () => {
      const durMs = Date.now() - startedAt;
      stopEverything();
      if (!cancelled) window.api.recorder.done({ durMs });
    };
    // A captura pode acabar por fora: voce clica em "parar de compartilhar" na
    // barra do Chromium, ou desconecta o monitor.
    if (video) {
      video.addEventListener('ended', () => {
        try {
          if (recorder && recorder.state !== 'inactive') recorder.stop();
        } catch {
          /* ja parado */
        }
      });
    }
    startedAt = Date.now();
    recorder.start(3000);
    // So AGORA existe gravacao: o processo principal sai de "preparando" e o
    // cronometro comeca.
    window.api.recorder.armed();
  } catch (e) {
    stopEverything();
    window.api.recorder.done({ error: String((e as Error).message || e) });
  }
}

window.api.recorder.onStart((cfg) => void begin(cfg as unknown as Config));
window.api.recorder.onStop(() => {
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch {
    /* já parado */
  }
});
window.api.recorder.onCancel(() => {
  cancelled = true;
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch {
    /* já parado */
  }
  stopEverything();
});
