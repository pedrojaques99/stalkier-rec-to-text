import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * ffmpeg.
 *
 * Duas regras de segurança, e as duas são o motivo de este arquivo existir em
 * vez de um `exec("ffmpeg " + args)` espalhado pelo código:
 *
 * 1. **`execFile` com array, nunca shell.** Nome de arquivo com aspas, `&&` ou
 *    `;` viraria comando se passasse por shell. Aqui os caminhos são sempre
 *    derivados de um id validado, e ainda assim nada passa por shell.
 * 2. **Nenhuma entrada do usuário vira flag.** Bitrate, formato e codec são
 *    constantes deste arquivo.
 *
 * O binário NÃO é embutido. Baixar um ffmpeg no primeiro uso é superfície de
 * supply chain que este app não precisa: quem instala escolhe a origem, e o app
 * só verifica se ele existe e diz como instalar quando não existe.
 */

const BASE = ['-hide_banner', '-loglevel', 'error', '-y'];

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await run('ffmpeg', [...BASE, ...args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message?: string; code?: string };
    if (err.code === 'ENOENT') throw new Error('FFMPEG_MISSING');
    throw new Error(String(err.stderr || err.message).slice(0, 400));
  }
}

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffmpeg', ['-version'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 16 kHz mono FLAC é o pré-processamento que a própria documentação da Groq
 * recomenda: corta o arquivo em ~10x e mantém o limite de 25 MB longe mesmo
 * numa reunião longa. Não perde qualidade — o Whisper trabalha em 16 kHz.
 */
export const toFlac = (src: string, dest: string): Promise<void> =>
  ffmpeg(['-i', src, '-ar', '16000', '-ac', '1', dest]);

export const toMp3 = (src: string, dest: string): Promise<void> =>
  ffmpeg(['-i', src, '-vn', '-b:a', '96k', dest]);

/** Dimensão do vídeo, ou null quando não há faixa de vídeo (ou nem ffprobe). */
async function videoSize(src: string): Promise<{ w: number; h: number } | null> {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src],
      { windowsHide: true },
    );
    const [w, h] = stdout.trim().split(/[,\r\n]+/).map(Number);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

async function videoCodec(src: string): Promise<string> {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', src],
      { windowsHide: true },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * A decisão é pelo codec de ENTRADA, e não por "tenta copiar e vê no que dá":
 * o ffmpeg aceita copiar VP9 pra dentro de um .mp4 sem reclamar, e o arquivo
 * resultante não abre no player do Windows. Falha silenciosa — sai um mp4 do
 * tamanho certo que ninguém consegue assistir.
 */
export async function toMp4(src: string, dest: string): Promise<'remux' | 'reencode'> {
  const common = ['-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k'];
  if ((await videoCodec(src)) === 'h264') {
    try {
      await ffmpeg(['-i', src, '-c:v', 'copy', ...common, dest]);
      return 'remux';
    } catch {
      /* cai pro re-encode */
    }
  }
  await ffmpeg(['-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', ...common, dest]);
  return 'reencode';
}

/**
 * Um frame como capa da gravação. É o que separa uma galeria de uma lista com
 * ícone: sem capa, cinco gravações de tela do mesmo dia são cinco retângulos
 * idênticos e você abre as cinco pra achar a certa.
 *
 * `-ss` ANTES do `-i` busca por keyframe e volta em milissegundos; depois do
 * `-i` ele decodifica tudo até o instante pedido, o que num mp4 de uma hora
 * custa mais que o resto do processamento junto. O instante é ~1s porque o
 * primeiro frame de uma captura de tela costuma ser preto.
 */
export const toPoster = (src: string, dest: string, atSec = 1): Promise<void> =>
  ffmpeg(['-ss', String(Math.max(0, atSec)), '-i', src, '-frames:v', '1',
    '-vf', 'scale=640:-2', '-q:v', '4', dest]);

/* ── Quick edits: aparar e recortar ──────────────────────────────────────── */

/** Retângulo de recorte em pixels da mídia ORIGINAL, como o cropper devolve. */
export interface CropRect { x: number; y: number; width: number; height: number }

export interface CutOptions {
  /** Início do trecho, em segundos. */
  start: number;
  /** Fim do trecho, em segundos. */
  end: number;
  /** Recorte. Ausente = quadro inteiro. Ignorado quando a mídia é só áudio. */
  crop?: CropRect | null;
}

/** h264 em yuv420p exige lado par: 719 de largura não codifica, 718 codifica. */
const par = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/**
 * Corta um trecho, opcionalmente recortando o quadro. Uma passada de ffmpeg.
 *
 * Três decisões que custam caro se invertidas:
 *
 * 1. **`-ss` antes do `-i`, `-t` depois.** `-ss` antes busca por keyframe e
 *    volta em milissegundos mesmo num arquivo de uma hora. Já `-to` DEPOIS de
 *    um `-ss` de entrada muda de referência conforme a versão do ffmpeg (ora
 *    absoluto na linha do tempo original, ora relativo ao ponto de busca) —
 *    `-t`, que é duração, significa a mesma coisa em todas.
 * 2. **Re-encode quando há trim de vídeo.** `-c copy` corta no keyframe mais
 *    próximo, não onde você pediu: o corte sai até dois segundos fora do lugar,
 *    e o começo congela. Áudio puro não tem esse problema e continua em cópia.
 * 3. **Lados pares.** Ver `par()` acima. Sem isso o ffmpeg falha com uma
 *    mensagem sobre "width not divisible by 2" que não parece ter nada a ver
 *    com o retângulo que você arrastou na tela.
 */
export async function cutClip(src: string, dest: string, opts: CutOptions): Promise<void> {
  const start = Math.max(0, opts.start);
  const dur = Math.max(0.05, opts.end - start);
  const audioOnly = /\.(mp3|m4a|flac|wav|ogg)$/i.test(dest);

  if (audioOnly) {
    // Copiar a faixa só funciona quando a origem JÁ é do mesmo formato. Pedir
    // `-c:a copy` de um mp4 (aac) pra dentro de um .mp3 não degrada nem avisa:
    // o ffmpeg recusa o cabeçalho e o corte não existe. Quando os formatos
    // batem a cópia é instantânea e sem perda; quando não batem, re-codifica
    // no mesmo bitrate do resto do app.
    const mesmoFormato = src.slice(src.lastIndexOf('.')).toLowerCase() === dest.slice(dest.lastIndexOf('.')).toLowerCase();
    const codec = mesmoFormato ? ['-c:a', 'copy'] : ['-b:a', '96k'];
    await ffmpeg(['-ss', String(start), '-i', src, '-t', String(dur), '-vn', ...codec, dest]);
    return;
  }

  const args = ['-ss', String(start), '-i', src, '-t', String(dur)];
  if (opts.crop) {
    // O retângulo vem de uma moldura arrastada na tela, e por arredondamento
    // (ou por um zoom que passa da borda) ele encosta ou passa do quadro. Sem
    // grampear, o ffmpeg para com "Invalid too big or non positive size" — que
    // não diz nada a quem só arrastou uma moldura, e perde o corte inteiro por
    // um pixel. Grampeado, o corte sai: um pixel a menos ninguém vê.
    const tam = await videoSize(src);
    const { x, y, width, height } = opts.crop;
    const px = Math.max(0, Math.round(x));
    const py = Math.max(0, Math.round(y));
    const pw = tam ? Math.min(par(width), tam.w - px) : par(width);
    const ph = tam ? Math.min(par(height), tam.h - py) : par(height);
    args.push('-vf', `crop=${par(pw)}:${par(ph)}:${px}:${py}`);
  }
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dest,
  );
  await ffmpeg(args);
}

/**
 * Os picos da onda, prontos pro desenho: um array de -1..1 por coluna.
 *
 * Calcular isto no NAVEGADOR seria baixar o mp4 inteiro e decodificar tudo —
 * numa aula de 40 minutos a aba trava antes de aparecer a primeira barra. Aqui
 * o ffmpeg já devolve mono 8 kHz, que é ~1/300 do arquivo, e o resultado cabe
 * num JSON que dá pra guardar em cache pra sempre: a mídia não muda.
 *
 * Devolve o pico ABSOLUTO de cada balde, não a média. Média achata a fala num
 * borrão uniforme e a onda perde justamente o que se olha nela — onde começa a
 * frase, onde tem silêncio pra cortar.
 */
export async function peaks(src: string, buckets = 2000): Promise<number[]> {
  const { stdout } = await run(
    'ffmpeg',
    [...BASE, '-i', src, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'],
    { windowsHide: true, maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' },
  ).catch((e: { stderr?: Buffer; message?: string; code?: string }) => {
    if (e.code === 'ENOENT') throw new Error('FFMPEG_MISSING');
    throw new Error(String(e.stderr || e.message).slice(0, 400));
  }) as { stdout: Buffer };

  const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
  if (!pcm.length) return [];

  const n = Math.max(1, Math.min(buckets, pcm.length));
  const passo = pcm.length / n;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const de = Math.floor(i * passo);
    const ate = Math.min(pcm.length, Math.floor((i + 1) * passo));
    let alto = 0;
    for (let k = de; k < ate; k++) {
      const v = pcm[k] < 0 ? -pcm[k] : pcm[k];
      if (v > alto) alto = v;
    }
    out[i] = Math.round((alto / 32768) * 1000) / 1000;
  }
  return out;
}
