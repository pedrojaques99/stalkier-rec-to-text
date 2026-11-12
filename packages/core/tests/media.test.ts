import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cutClip, hasFfmpeg, peaks } from '../src/media.js';

const run = promisify(execFile);

/**
 * O portão determinístico do quick edit.
 *
 * Um corte que sai com a duração errada, ou com o recorte no lugar errado,
 * falha CALADO: sai um mp4 legítimo, do tamanho esperado, que só está errado
 * quando alguém assiste. Por isso o teste não verifica "gerou arquivo" — ele
 * pergunta ao ffprobe quanto tempo e que dimensão o arquivo TEM.
 *
 * A fonte é sintetizada aqui mesmo (testsrc + senoide), então a suíte não
 * depende de nenhum arquivo commitado nem da máquina de quem roda.
 */

const temFfmpeg = await hasFfmpeg();
const talvez = temFfmpeg ? describe : describe.skip;

let dir = '';
const fonte = (): string => join(dir, 'fonte.mp4');

const probe = async (file: string, campos: string): Promise<string[]> => {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', campos, '-of', 'csv=p=0', file,
  ]);
  return stdout.trim().split(/[,\r\n]+/);
};

const segundos = async (file: string): Promise<number> => {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
};

beforeAll(async () => {
  if (!temFfmpeg) return;
  dir = await mkdtemp(join(tmpdir(), 'stalkier-media-'));
  // 6s, 640x360, com áudio: curto pra suíte rodar rápido, longo o bastante pra
  // um corte no meio não cair no primeiro keyframe por acidente.
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-shortest', fonte(),
  ]);
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

talvez('cutClip', () => {
  it('apara no ponto pedido, nao no keyframe mais proximo', async () => {
    const out = join(dir, 'apara.mp4');
    await cutClip(fonte(), out, { start: 2, end: 3.5 });
    expect(await segundos(out)).toBeCloseTo(1.5, 1);
  }, 60_000);

  it('recorta o quadro na dimensao pedida', async () => {
    const out = join(dir, 'recorta.mp4');
    await cutClip(fonte(), out, { start: 1, end: 3, crop: { x: 100, y: 60, width: 320, height: 180 } });
    expect(await probe(out, 'stream=width,height')).toEqual(['320', '180']);
    expect(await segundos(out)).toBeCloseTo(2, 1);
  }, 60_000);

  it('arredonda lado impar pra par em vez de estourar o encoder', async () => {
    const out = join(dir, 'impar.mp4');
    await cutClip(fonte(), out, { start: 0, end: 1, crop: { x: 0, y: 0, width: 321, height: 179 } });
    const [w, h] = (await probe(out, 'stream=width,height')).map(Number);
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
  }, 60_000);

  /**
   * A moldura arrastada na tela passa da borda por arredondamento o tempo
   * todo. Antes de grampear, isso não saía torto: NÃO SAÍA — o ffmpeg parava
   * com "Invalid too big or non positive size" e o corte se perdia inteiro.
   */
  it('retangulo maior que o quadro e grampeado, nao derruba o corte', async () => {
    const out = join(dir, 'estoura.mp4');
    await cutClip(fonte(), out, { start: 0, end: 1, crop: { x: 100, y: 50, width: 720, height: 1280 } });
    const [w, h] = (await probe(out, 'stream=width,height')).map(Number);
    expect(w).toBeLessThanOrEqual(640 - 100);
    expect(h).toBeLessThanOrEqual(360 - 50);
    expect(w).toBeGreaterThan(0);
  }, 60_000);

  it('audio sai sem faixa de video', async () => {
    const out = join(dir, 'so-audio.mp3');
    await cutClip(fonte(), out, { start: 1, end: 3 });
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=index', '-of', 'csv=p=0', out,
    ]);
    expect(stdout.trim()).toBe('');
  }, 60_000);
});

talvez('peaks', () => {
  it('devolve a quantidade pedida, toda ela entre 0 e 1', async () => {
    const p = await peaks(fonte(), 200);
    expect(p).toHaveLength(200);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...p)).toBeLessThanOrEqual(1);
  }, 60_000);

  /**
   * O que se olha numa onda é onde a fala COMEÇA — e média mata isso: um
   * estalo de 0,2s dentro de um balde de 3s vira um borrão de nada. O teste
   * usa uma fonte quase toda em silêncio com um único estouro curto: com pico,
   * o balde do estouro fica ordens de grandeza acima dos vizinhos; com média,
   * afundaria junto com eles.
   */
  it('um estouro curto sobrevive a reducao — pico, nao media', async () => {
    const burst = join(dir, 'estouro.wav');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-af', "volume=enable='between(t,3,3.2)':volume=1, volume=enable='lt(t,3)+gt(t,3.2)':volume=0",
      burst,
    ]);
    const p = await peaks(burst, 30);
    const ordenado = [...p].sort((a, b) => a - b);
    const mediana = ordenado[Math.floor(ordenado.length / 2)];
    expect(Math.max(...p)).toBeGreaterThan(mediana * 10 + 0.01);
  }, 60_000);
});
