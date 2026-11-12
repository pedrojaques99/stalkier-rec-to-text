import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Play, Scissors } from 'lucide-react';
import type { ClipCut, RecorderApi } from './api.js';
import type { Strings } from './strings.js';

/**
 * Aparar e recortar, dentro do diálogo que já está aberto.
 *
 * A decisão que segura o arquivo inteiro: **um só elemento de vídeo**. O
 * `<video>` é nosso, o `react-image-crop` desenha a moldura por cima dele e o
 * `wavesurfer` recebe esse MESMO elemento como `media`. Não há player
 * escondido, não há dois relógios pra sincronizar, e arrastar o cursor da onda
 * move o quadro que você está enquadrando.
 *
 * **Por que esta lib de recorte e não a outra.** O `react-easy-crop` (a
 * primeira escolha) não tem canto nenhum: a moldura dele é fixa e quem se move
 * é a mídia embaixo. Modelo legítimo — e não é o que a mão espera. Aqui a
 * moldura tem os oito punhos (quatro cantos, quatro bordas), livre é o padrão
 * quando não se trava proporção, e as setas do teclado já movem o recorte, com
 * `aria-label` em cada punho. O canto que eu tinha escrito à mão pra suprir a
 * falta sumiu junto: código custom que só existia porque a lib não fazia.
 *
 * O recorte mora em PORCENTAGEM, nunca em pixel de tela. Porcentagem da caixa
 * exibida é a mesma porcentagem da mídia original, então a conversão pro
 * ffmpeg é uma multiplicação — sem `scaleX` de largura renderizada, que muda
 * quando a janela muda de tamanho e transforma o recorte numa mentira.
 *
 * A onda NÃO é decodificada aqui. Os picos vêm prontos do `api.peaks()`, e é
 * por isso que o modo abre em milissegundos mesmo numa aula de 40 minutos:
 * baixar o mp4 inteiro pra decodificar no navegador travaria a aba antes de
 * desenhar a primeira barra. Sem a rota, sem o modo — ver `api.peaks`.
 */

const mmss = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

type Aspecto = 'original' | 'livre' | number;

const PROPORCOES: { id: Aspecto; rotulo: string }[] = [
  { id: 'original', rotulo: '' },
  { id: 9 / 16, rotulo: '9:16' },
  { id: 1, rotulo: '1:1' },
  { id: 16 / 9, rotulo: '16:9' },
  { id: 'livre', rotulo: '' },
];

export interface QuickEditProps {
  id: string;
  src: string;
  hasVideo: boolean;
  /** Duração de reserva (ms), pra desenhar algo enquanto os picos não chegam. */
  durMs: number;
  api: RecorderApi;
  t: Strings;
  onSaved: (id: string) => void;
}

export function QuickEdit({ id, src, hasVideo, durMs, api, t, onSaved }: QuickEditProps): JSX.Element {
  const [onda, setOnda] = useState<{ peaks: number[]; duration: number } | null>(null);
  const [ondaErro, setOndaErro] = useState(false);
  const [trecho, setTrecho] = useState<{ start: number; end: number } | null>(null);

  const [aspecto, setAspecto] = useState<Aspecto>('original');
  const [recorte, setRecorte] = useState<Crop | undefined>();
  const [tamanhoMidia, setTamanhoMidia] = useState<{ naturalWidth: number; naturalHeight: number } | null>(null);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ondaBox = useRef<HTMLDivElement>(null);
  const midia = useRef<HTMLMediaElement | null>(null);
  const ws = useRef<WaveSurfer | null>(null);
  const regiao = useRef<Region | null>(null);
  // Um contador que muda quando o elemento de mídia aparece: o `setVideoRef` do
  // cropper entrega um RefObject, não dispara render, e sem este empurrão o
  // efeito que cria a onda rodaria antes do vídeo existir e não rodaria de novo.
  const [midiaPronta, setMidiaPronta] = useState(0);
  /**
   * A mídia já sabe quanto tempo tem?
   *
   * Isto não é preciosismo: o wavesurfer tira a duração do ELEMENTO, não dos
   * picos (os picos só valem quando não há mídia nenhuma). Criar a região antes
   * dos metadados chegarem a faz nascer com 0 de largura — e ela não se conserta
   * sozinha depois, porque já foi posicionada. O resultado era um editor mudo:
   * onda desenhada, trecho "0:00 → 0:00" e nada pra arrastar.
   */
  const [temMetadados, setMetadados] = useState(false);

  const duracao = onda?.duration || durMs / 1000 || 0;

  /**
   * Registra o elemento de mídia, venha ele do cropper ou do `<audio>` daqui, e
   * fica de olho em quando ele souber a própria duração. `readyState >= 1` já
   * cobre o caso de a mídia estar pronta ANTES de nós — aí o evento nunca mais
   * dispara, e esperar por ele seria esperar pra sempre.
   */
  const anotarMidia = useCallback((el: HTMLMediaElement): void => {
    if (midia.current === el) return;
    midia.current = el;
    setMetadados(el.readyState >= 1 && Number.isFinite(el.duration) && el.duration > 0);
    el.addEventListener('loadedmetadata', () => setMetadados(true), { once: true });
    setMidiaPronta((n) => n + 1);
  }, []);

  /* ── Os picos ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    let vivo = true;
    setOnda(null);
    setOndaErro(false);
    setTrecho(null);
    if (!api.peaks) { setOndaErro(true); return; }
    void api.peaks(id)
      .then((r) => { if (vivo) setOnda(r?.peaks?.length ? r : null); if (vivo && !r?.peaks?.length) setOndaErro(true); })
      .catch(() => { if (vivo) setOndaErro(true); });
    return () => { vivo = false; };
  }, [id, api]);

  /* ── A onda e a região ────────────────────────────────────────────────── */
  useEffect(() => {
    const el = midia.current;
    if (!onda || !ondaBox.current || !el || !temMetadados) return;

    const regioes = RegionsPlugin.create();
    const w = WaveSurfer.create({
      container: ondaBox.current,
      // O elemento que JÁ está na tela. Sem isto o wavesurfer cria um <audio>
      // próprio e passam a existir duas posições de reprodução diferentes.
      media: el,
      // Com picos e duração na mão ele pula fetch e decode inteiros. A duração
      // que manda no playback continua sendo a do elemento de mídia.
      peaks: [onda.peaks],
      duration: onda.duration,
      height: 64,
      waveColor: 'var(--border)',
      progressColor: 'var(--faint)',
      cursorColor: 'var(--accent)',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      plugins: [regioes],
    });
    ws.current = w;

    // A duração do elemento manda, porque é ela que o wavesurfer usa pra
    // posicionar a região. A dos picos entra só como reserva.
    const fim = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : onda.duration;
    const r = regioes.addRegion({
      start: 0,
      end: fim,
      drag: true,
      resize: true,
      minLength: 0.1,
      color: 'color-mix(in srgb, var(--accent) 18%, transparent)',
    });
    regiao.current = r;
    setTrecho({ start: r.start, end: r.end ?? fim });

    // `update` dispara a cada quadro do arrasto; `update-end` só ao soltar. Os
    // dois: o número em cima precisa acompanhar o dedo, e o estado final é o
    // que vai pro corte.
    const acompanhar = (): void => setTrecho({ start: r.start, end: r.end ?? fim });
    r.on('update', acompanhar);
    r.on('update-end', acompanhar);

    // Tocar só o trecho: sem isto o "tocar" atravessa o fim da região e você
    // passa a ouvir o que decidiu jogar fora.
    regioes.on('region-out', (saiu) => { if (saiu === r) w.pause(); });

    return () => {
      regiao.current = null;
      ws.current = null;
      // Não destrói o elemento de mídia junto: ele é do cropper, e destruí-lo
      // deixaria a moldura sem quadro ao sair e voltar do modo.
      w.unAll();
      w.destroy();
    };
  }, [onda, midiaPronta, temMetadados]);

  /* ── A moldura ────────────────────────────────────────────────────────── */
  // `undefined` é o que a lib entende por LIVRE. Não é ausência de valor: é a
  // instrução de não travar razão nenhuma.
  const aspectoNum = useMemo((): number | undefined => {
    if (aspecto === 'livre') return undefined;
    if (aspecto === 'original') {
      if (!tamanhoMidia) return undefined;
      return tamanhoMidia.naturalWidth / tamanhoMidia.naturalHeight;
    }
    return aspecto;
  }, [aspecto, tamanhoMidia]);

  /**
   * O recorte começa cobrindo o quadro inteiro, centrado. Começar menor seria a
   * tela decidindo por você que há algo a cortar — e nove vezes em dez você
   * abriu isto pra aparar o TEMPO, não o quadro.
   */
  const molduraCheia = useCallback((w: number, h: number, razao?: number): PercentCrop => {
    const base = { unit: '%' as const, width: 100 };
    return razao
      ? centerCrop(makeAspectCrop(base, razao, w, h), w, h)
      : centerCrop({ ...base, height: 100, x: 0, y: 0 }, w, h);
  }, []);

  // Trocar de proporção redesenha a moldura na razão nova. Sem isto ela ficaria
  // com a forma antiga e o rótulo diria 9:16 sobre um retângulo que não é.
  useEffect(() => {
    if (!tamanhoMidia) return;
    setRecorte(molduraCheia(tamanhoMidia.naturalWidth, tamanhoMidia.naturalHeight, aspectoNum));
  }, [aspectoNum, tamanhoMidia, molduraCheia]);

  /**
   * De porcentagem pra pixel da mídia. Uma multiplicação, e é o motivo de o
   * estado morar em `%`: a fração é a mesma na caixa exibida e no arquivo, então
   * redimensionar a janela não mexe no que vai pro ffmpeg.
   */
  const recorteEmPixels = useMemo(() => {
    if (!tamanhoMidia || !recorte || recorte.unit !== '%' || !recorte.width || !recorte.height) return null;
    const { naturalWidth: W, naturalHeight: H } = tamanhoMidia;
    return {
      x: (recorte.x / 100) * W,
      y: (recorte.y / 100) * H,
      width: (recorte.width / 100) * W,
      height: (recorte.height / 100) * H,
    };
  }, [recorte, tamanhoMidia]);

  // Moldura do tamanho do quadro não é recorte, é o quadro. Mandar assim faria
  // o ffmpeg rodar um filtro pra devolver o que já tinha.
  const semRecorte = !recorteEmPixels || !tamanhoMidia
    || (Math.round(recorteEmPixels.width) >= tamanhoMidia.naturalWidth - 2
      && Math.round(recorteEmPixels.height) >= tamanhoMidia.naturalHeight - 2);

  /* ── Salvar ───────────────────────────────────────────────────────────── */
  const tocarTrecho = (): void => {
    const r = regiao.current;
    if (r) { r.play(true); return; }
    const el = midia.current;
    if (el && trecho) { el.currentTime = trecho.start; void el.play(); }
  };

  const salvar = async (): Promise<void> => {
    if (!api.exportClip || !trecho) return;
    setSalvando(true);
    setErro(null);
    const cut: ClipCut = { start: trecho.start, end: trecho.end };
    // Recorte só entra quando é MENOR que o quadro: mandar o quadro inteiro
    // como "recorte" forçaria um re-encode com filtro por nada.
    if (hasVideo && recorteEmPixels && !semRecorte) cut.crop = recorteEmPixels;
    try {
      const r = await api.exportClip(id, cut);
      onSaved(r.id);
    } catch (e) {
      setErro(String((e as Error).message || e));
    } finally {
      setSalvando(false);
    }
  };

  const inteiro = !trecho || (trecho.start <= 0.05 && trecho.end >= duracao - 0.05);

  return (
    // `panel-in` é a entrada que o resto do diálogo já usa (Recorder.tsx:289) e
    // que o guard de `prefers-reduced-motion` de lá já cobre. O modo passa a
    // ENTRAR em vez de aparecer: trocar de ler pra cortar é uma mudança de
    // ferramenta, e mudança de ferramenta sem peso a pessoa confere com o olho.
    <div className="panel-in" style={{ display: 'grid', gap: 12 }}>
      {hasVideo ? (
        <div className="recorte" style={{ display: 'grid', justifyContent: 'center', width: '100%', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
          <ReactCrop
            crop={recorte}
            aspect={aspectoNum}
            ruleOfThirds
            minWidth={24}
            minHeight={24}
            // Guardamos a porcentagem, não o pixel: é a fração que sobrevive a
            // redimensionar a janela.
            onChange={(_, emPorcento) => setRecorte(emPorcento)}
            ariaLabels={{
              cropArea: t.cropArea,
              nwDragHandle: t.cropNW, nDragHandle: t.cropN, neDragHandle: t.cropNE,
              eDragHandle: t.cropE, seDragHandle: t.cropSE, sDragHandle: t.cropS,
              swDragHandle: t.cropSW, wDragHandle: t.cropW,
            }}>
            {/* O `<video>` é nosso: é ele que o wavesurfer toca, então nada de
                `muted` nem de laço — o cropper da outra lib forçava os dois
                porque lá o vídeo era só pré-visualização de enquadramento. */}
            <video ref={(el) => { if (el) anotarMidia(el); }}
              src={src} preload="metadata" playsInline
              onLoadedMetadata={(e) => setTamanhoMidia({
                naturalWidth: e.currentTarget.videoWidth,
                naturalHeight: e.currentTarget.videoHeight,
              })}
              style={{ display: 'block', maxHeight: '46vh', maxWidth: '100%' }} />
          </ReactCrop>
        </div>
      ) : (
        <audio ref={(el) => { if (el) anotarMidia(el); }}
          src={src} preload="metadata" style={{ display: 'none' }} />
      )}

      {hasVideo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>{t.aspect}</span>
          <span style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            {PROPORCOES.map((p) => {
              const ativo = aspecto === p.id;
              const texto = p.rotulo || (p.id === 'original' ? t.aspectOriginal : t.aspectFree);
              return (
                <button key={String(p.id)} className="seg" aria-pressed={ativo}
                  onClick={() => setAspecto(p.id)}
                  style={{
                    height: 26, padding: '0 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    fontSize: 11.5, fontWeight: 600,
                    background: ativo ? 'var(--surface-3)' : 'transparent',
                    color: ativo ? 'var(--text)' : 'var(--faint)',
                  }}>
                  {texto}
                </button>
              );
            })}
          </span>
        </div>
      )}

      {/* A onda. Enquanto os picos não chegam fica a linha de espera — barra
          falsa daria a impressão de que a gravação tem esta forma. */}
      {/* A caixa tem a altura final SEMPRE. Antes, a espera era uma linha de
          texto e a onda nascia com 64px do nada, empurrando o botão de salvar
          pra baixo — salto de layout exatamente onde a mão ia clicar. A frase
          "arraste as bordas" saiu: quem ensina o gesto agora é o punho, e o
          texto virou o rótulo que o leitor de tela precisa (punho não se lê). */}
      <div style={{ minHeight: 64, display: 'grid', alignContent: 'center' }}
        aria-label={t.dragToTrim}>
        {onda && temMetadados ? (
          <div className="onda" ref={ondaBox} style={{ width: '100%' }} />
        ) : ondaErro ? (
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>{t.waveFail}</span>
        ) : (
          <span className="skeleton" aria-live="polite"
            style={{ height: 64, borderRadius: 6, background: 'var(--surface-2)' }} />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Sem trecho não há travessão: "—" é o número dizendo que não sabe,
            e ocupa a linha do mesmo jeito. A linha nasce quando há o que dizer. */}
        {trecho && (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: inteiro && semRecorte ? 'var(--faint)' : 'var(--text)' }}>
            {t.rangeLine(mmss(trecho.start), mmss(trecho.end), mmss(trecho.end - trecho.start))}
          </span>
        )}
        {/* Mesma regra do primário: controle morto não se desenha. Sem trecho
            não há o que tocar, e um botão cinza só ocupa a linha prometendo. */}
        {trecho && temMetadados && (
          <button className="primary" onClick={tocarTrecho}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none',
              border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px',
              color: 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
            <Play size={12} /> {t.playRange}
          </button>
        )}

        {/* Botão primário cinza é mentira: ele promete uma ação e não diz por
            que ela não sai. Enquanto a mídia não tem duração não há trecho pra
            cortar, então no lugar do botão fica a única coisa verdadeira — que
            a tela está esperando o arquivo. O botão volta inteiro, nunca apagado.
            Desabilitado só durante o corte, que é ação em voo, não promessa. */}
        {temMetadados && trecho && api.exportClip ? (
          <button className="primary" onClick={() => void salvar()} disabled={salvando}
            style={{
              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6,
              border: '1px solid var(--accent)', borderRadius: 7, padding: '6px 12px',
              background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
              color: 'var(--accent)', fontSize: 12.5, fontWeight: 700,
              cursor: salvando ? 'progress' : 'pointer', opacity: salvando ? 0.7 : 1,
            }}>
            <Scissors size={13} /> {salvando ? t.savingClip : t.saveClip}
          </button>
        ) : (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>
            {ondaErro ? t.waveFail : t.waveLoading}
          </span>
        )}
      </div>

      {erro && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--red-dim)', fontSize: 12.5, color: 'var(--muted)' }}>
          {t.clipFail(erro)}
        </div>
      )}
    </div>
  );
}
