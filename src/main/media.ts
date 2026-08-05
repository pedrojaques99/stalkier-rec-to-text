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
