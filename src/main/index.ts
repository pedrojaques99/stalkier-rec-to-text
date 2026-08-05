import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { createWriteStream, existsSync, rmSync, statSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Kind, RecorderState, StartOptions } from '../shared/types.js';
import { hasFfmpeg, toFlac, toMp3, toMp4, wordCandidates } from '@stalkier/core';
import { pasteText } from './paste.js';
import { apiKeyHint, getSettings, hasEncryption, setApiKey, setSettings } from './settings.js';
import {
  allSessions,
  getSession,
  isValidId,
  listSessions,
  mediaPath,
  monthUsage,
  newId,
  removeSession,
  saveSession,
} from './store.js';
import { testKey, transcribe } from './transcribe.js';
import { getVocabulary, setVocabulary } from './vocabulary.js';

/* ─────────────────────────── Segurança ───────────────────────────────────────
 *
 * Este app NÃO abre porta nenhuma. Tudo entre a interface e o sistema passa por
 * IPC do Electron. A versão anterior deste código falava com um servidor HTTP
 * local, o que significa que qualquer página aberta no navegador podia chamar a
 * API e ler as transcrições. Aqui não existe superfície de rede local.
 *
 * As outras travas, todas verificáveis abaixo:
 *   contextIsolation ligado e nodeIntegration desligado em TODAS as janelas
 *   sandbox ligado no renderer
 *   navegação externa e window.open bloqueados
 *   CSP restritiva injetada na resposta de toda janela
 *   mídia servida por protocolo próprio com id validado, nunca por caminho cru
 *   permissões negadas por padrão, exceto microfone/tela pedidos pelo app
 * ────────────────────────────────────────────────────────────────────────────*/

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let recorderWindow: BrowserWindow | null = null;
let pill: BrowserWindow | null = null;

let state: RecorderState = {
  recording: false,
  transcribing: false,
  kind: 'audio',
  since: 0,
  shortcut: null,
  error: null,
};

/** Quem recebe aviso de estado. Entra quem pergunta o estado (prova de vida). */
const subscribers = new Set<Electron.WebContents>();

function push(channel: string, payload: unknown = state): void {
  for (const wc of subscribers) {
    if (wc.isDestroyed()) {
      subscribers.delete(wc);
      continue;
    }
    try {
      wc.send(channel, payload);
    } catch {
      /* corrida de teardown: perder um evento aqui não custa nada */
    }
  }
  for (const w of [mainWindow, pill]) {
    if (!w || w.isDestroyed() || w.webContents.isDestroyed()) continue;
    try {
      w.webContents.send(channel, payload);
    } catch {
      /* idem */
    }
  }
}

// ─── Janelas ─────────────────────────────────────────────────────────────────

const rendererFile = (name: string) => join(import.meta.dirname, `../renderer/${name}.html`);
const rendererUrl = (name: string) =>
  isDev && process.env.ELECTRON_RENDERER_URL
    ? `${process.env.ELECTRON_RENDERER_URL}/${name}.html`
    : pathToFileURL(rendererFile(name)).toString();

const SAFE_WEB_PREFERENCES: Electron.WebPreferences = {
  preload: join(import.meta.dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
};

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 560,
    minHeight: 480,
    show: false,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: SAFE_WEB_PREFERENCES,
  });
  mainWindow.loadURL(rendererUrl('index'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
}

/**
 * A janela que grava fica ESCONDIDA e viva o app inteiro. É isso que faz o
 * atalho global funcionar com a janela principal minimizada: `getUserMedia` e
 * `MediaRecorder` só existem num renderer, e se a gravação morasse na tela
 * principal o atalho só serviria com ela aberta e na frente.
 */
function ensureRecorder(): BrowserWindow {
  if (recorderWindow && !recorderWindow.isDestroyed()) return recorderWindow;
  recorderWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 300,
    skipTaskbar: true,
    webPreferences: {
      ...SAFE_WEB_PREFERENCES,
      // Janela escondida com timer estrangulado grava áudio picotado.
      backgroundThrottling: false,
    },
  });
  recorderWindow.loadURL(rendererUrl('recorder'));
  recorderWindow.on('closed', () => (recorderWindow = null));
  return recorderWindow;
}

/**
 * Pílula flutuante: o HUD.
 *
 * `focusable: false` não é enfeite — é o que garante que a janela onde você
 * estava digitando não perde o foco. Sem isso o texto é colado na pílula.
 *
 * `setContentProtection(true)` a tira de qualquer captura de tela (é
 * `WDA_EXCLUDEFROMCAPTURE` no Windows): visível pra você, invisível na gravação
 * de tela e no OBS. Uma tarja "gravando" dentro do vídeo entregue é a marca
 * d'água que ninguém pediu.
 */
function showPill(): void {
  if (pill && !pill.isDestroyed()) {
    pill.showInactive();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const w = 208;
  const h = 44;
  pill = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(workArea.x + workArea.width / 2 - w / 2),
    y: workArea.y + workArea.height - h - 24,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: SAFE_WEB_PREFERENCES,
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.setVisibleOnAllWorkspaces(true);
  pill.setContentProtection(true);
  pill.loadURL(rendererUrl('overlay'));
  pill.once('ready-to-show', () => pill?.showInactive());
  pill.on('closed', () => (pill = null));
}

const hidePill = (): void => {
  if (pill && !pill.isDestroyed()) pill.hide();
};

// ─── Gravação ────────────────────────────────────────────────────────────────

let capture: { id: string; kind: Kind; dictation: boolean; stream: WriteStream } | null = null;

async function start(opts: StartOptions = {}): Promise<RecorderState> {
  if (state.recording) return state;
  const s = getSettings();
  const cfg = {
    kind: (opts.kind || 'audio') as Kind,
    mic: opts.mic ?? s.mic,
    system: opts.system ?? s.system,
    dictation: !!opts.dictation,
    sourceId: opts.sourceId ?? null,
  };
  if (!cfg.mic && !cfg.system) cfg.mic = true; // gravar silêncio não é uma opção

  const id = newId();
  capture = {
    id,
    kind: cfg.kind,
    dictation: cfg.dictation,
    stream: createWriteStream(mediaPath(id, 'webm')),
  };

  const w = ensureRecorder();
  const send = () => w.webContents.send('recorder:start', cfg);
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();

  state = { ...state, recording: true, transcribing: false, kind: cfg.kind, since: Date.now(), error: null };
  showPill();
  push('state');
  return state;
}

function stop(): RecorderState {
  if (!state.recording) return state;
  recorderWindow?.webContents.send('recorder:stop');
  state = { ...state, recording: false, transcribing: true };
  push('state');
  return state;
}

function cancel(): RecorderState {
  if (!state.recording && !state.transcribing) return state;
  recorderWindow?.webContents.send('recorder:cancel');
  capture?.stream.destroy();
  if (capture) rmSync(mediaPath(capture.id, 'webm'), { force: true });
  capture = null;
  state = { ...state, recording: false, transcribing: false };
  hidePill();
  push('state');
  return state;
}

async function finish(durMs: number): Promise<void> {
  const job = capture;
  capture = null;
  if (!job) {
    state = { ...state, transcribing: false };
    hidePill();
    push('state');
    return;
  }

  const webm = mediaPath(job.id, 'webm');
  const flac = mediaPath(job.id, 'flac');
  await new Promise<void>((r) => job.stream.end(() => r()));

  try {
    if (!existsSync(webm) || statSync(webm).size === 0) throw new Error('empty recording');
    await toFlac(webm, flac);

    const settings = getSettings();
    const recent = allSessions()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((s) => s.text)
      .join(' ');
    const r = await transcribe(flac, durMs / 1000, settings, recent);

    // Ditado curto não vira sessão: senão o histórico enche de "ok" e "testando"
    // e o painel de palavras vira lixo.
    const keep = !job.dictation || durMs >= 3000;
    if (keep && r.text) {
      await toMp3(webm, mediaPath(job.id, 'mp3'));
      let hasVideo = false;
      if (job.kind === 'screen') {
        try {
          await toMp4(webm, mediaPath(job.id, 'mp4'));
          hasVideo = true;
        } catch {
          /* sem vídeo: o áudio e o texto já estão salvos */
        }
      }
      saveSession({
        id: job.id,
        createdAt: Date.now(),
        kind: job.dictation ? 'dictation' : job.kind,
        durMs,
        hasVideo,
        engine: r.engine,
        costUsd: r.cost,
        text: r.text,
        segments: r.segments,
      });
    }

    state = {
      ...state,
      transcribing: false,
      error: null,
      last: { id: job.id, text: r.text, engine: r.engine },
    };
    if (job.dictation && r.text) pasteText(r.text, { paste: getSettings().paste });
  } catch (e) {
    const msg = String((e as Error).message);
    state = {
      ...state,
      transcribing: false,
      error: msg === 'FFMPEG_MISSING' ? 'ffmpeg not found on PATH' : msg,
      last: { error: msg },
    };
  } finally {
    rmSync(webm, { force: true });
    rmSync(flac, { force: true });
    hidePill();
    push('state');
  }
}

// ─── Atalho global ───────────────────────────────────────────────────────────

let lastShortcut = getSettingsSafe().shortcut;
let lastPress = 0;
let holdVotes = 0;
let holdTimer: NodeJS.Timeout | null = null;

function getSettingsSafe() {
  try {
    return getSettings();
  } catch {
    return { shortcut: 'CommandOrControl+Shift+Space' } as ReturnType<typeof getSettings>;
  }
}

/**
 * Toque alterna, segurar é push-to-talk.
 *
 * O Electron não entrega keyup pra atalho global, então "segurar" é inferido
 * pelo auto-repeat do sistema: pressão repetida em menos de 350ms é a tecla
 * presa, e o silêncio de 450ms depois é você soltando. Se o auto-repeat não
 * chegar (depende de teclado e driver), o comportamento cai sozinho no
 * toque-alterna, que funciona em qualquer máquina.
 *
 * Ele para QUALQUER gravação, não só ditado: é o único jeito de encerrar uma
 * gravação de tela com a janela principal atrás de tudo.
 */
function registerShortcut(accelerator?: string): boolean {
  globalShortcut.unregisterAll();
  const acc = accelerator || lastShortcut || 'CommandOrControl+Shift+Space';
  let ok = false;
  try {
    ok = globalShortcut.register(acc, () => {
      const now = Date.now();
      const repeat = now - lastPress < 350;
      lastPress = now;

      if (!state.recording) {
        if (state.transcribing) return;
        holdVotes = 0;
        void start({ kind: 'audio', dictation: true });
        return;
      }
      if (repeat) {
        holdVotes++;
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => {
          if (state.recording && holdVotes >= 2) stop();
        }, 450);
        return;
      }
      stop();
    });
  } catch {
    ok = false;
  }
  if (ok) lastShortcut = acc;
  // Falhar calado seria o pior caso: você aperta, nada acontece, e não há onde
  // ler por quê. A interface mostra este texto.
  state = { ...state, shortcut: ok ? acc : null, error: ok ? null : `another app already uses ${acc}` };
  push('state');
  return ok;
}

// ─── Protocolo de mídia ──────────────────────────────────────────────────────

/**
 * `media://<id>.mp3` em vez de servir um caminho de arquivo.
 *
 * O renderer nunca recebe nem envia caminho: manda um id, que é validado contra
 * `^[a-z0-9]{6,24}$` e só então vira caminho dentro da pasta do app. É o que
 * fecha travessia de diretório — `../../` não sobrevive ao regex.
 */
function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const url = new URL(request.url);
    const [id, ext] = `${url.hostname}${url.pathname}`.replace(/^\/+/, '').split('.');
    if (!isValidId(id) || (ext !== 'mp3' && ext !== 'mp4')) return new Response('bad request', { status: 400 });
    const file = mediaPath(id, ext);
    if (!existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

function registerIpc(): void {
  const handlers: Record<string, (e: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown> = {
    'rec:start': (_e, opts: StartOptions) => start(opts ?? {}),
    'rec:stop': () => stop(),
    'rec:cancel': () => cancel(),
    // Perguntar o estado é o que inscreve o renderer nos avisos.
    'rec:state': (e) => {
      subscribers.add(e.sender);
      return state;
    },
    'rec:sources': async () =>
      (await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })).map(
        (s) => ({ id: s.id, name: s.name, isScreen: s.id.startsWith('screen') }),
      ),
    'rec:shortcut': (_e, acc: string) => registerShortcut(typeof acc === 'string' ? acc : undefined),
    // Enquanto o campo de captura está focado, o atalho ANTIGO sai do ar: sem
    // isso, apertar a combinação atual pra reconfirmar dispararia uma gravação
    // em vez de ser lida pelo campo.
    'rec:shortcutPause': (_e, pause: boolean) => {
      if (pause) {
        globalShortcut.unregisterAll();
        state = { ...state, shortcut: null };
        push('state');
        return true;
      }
      return registerShortcut(lastShortcut);
    },

    'sessions:list': (_e, q: string) => ({
      sessions: listSessions(typeof q === 'string' ? q : ''),
      month: monthUsage(),
    }),
    'sessions:get': (_e, id: string) => getSession(id),
    'sessions:remove': (_e, id: string) => removeSession(id),
    'sessions:reveal': (_e, id: string) => {
      if (!isValidId(id)) return false;
      const mp3 = mediaPath(id, 'mp3');
      if (!existsSync(mp3)) return false;
      shell.showItemInFolder(mp3);
      return true;
    },

    // `await` no ffmpeg: devolver a Promise crua faz o IPC estourar com
    // "An object could not be cloned" — e o handler morre inteiro, então a
    // interface fica sem ajustes nenhum por causa de um detector de binário.
    'settings:get': async () => ({
      settings: getSettings(),
      keyHint: apiKeyHint(),
      encrypted: hasEncryption(),
      ffmpeg: await hasFfmpeg(),
    }),
    'settings:set': (_e, patch) => setSettings(patch ?? {}),
    'key:set': (_e, key: string) => setApiKey(typeof key === 'string' ? key : ''),
    'key:test': () => testKey(),

    'words:list': () => wordCandidates(allSessions(), getVocabulary()),
    'vocabulary:get': () => getVocabulary(),
    'vocabulary:set': (_e, list: string[]) => setVocabulary(list),
  };

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, fn as Parameters<typeof ipcMain.handle>[1]);
  }

  // Do renderer que grava. `send`, não `invoke`: são eventos, não perguntas.
  ipcMain.on('recorder:chunk', (_e, chunk: ArrayBuffer) => {
    if (!capture) return;
    capture.stream.write(Buffer.from(chunk));
  });
  ipcMain.on('recorder:done', (_e, payload: { durMs?: number; error?: string }) => {
    if (payload?.error) {
      capture?.stream.destroy();
      capture = null;
      state = { ...state, recording: false, transcribing: false, error: payload.error, last: { error: payload.error } };
      hidePill();
      push('state');
      return;
    }
    void finish(Number(payload?.durMs) || 0);
  });
  ipcMain.on('recorder:level', (_e, v: number) => push('level', Number(v) || 0));
}

// ─── Ciclo de vida ───────────────────────────────────────────────────────────

// Uma instância só: duas registrariam o mesmo atalho global e a segunda perderia.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);

  app.whenReady().then(() => {
    registerMediaProtocol();

    // CSP em todas as respostas: sem script externo, sem eval, sem conexão que
    // não seja a do próprio app. A interface é 100% local.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            isDev
              ? "default-src 'self' 'unsafe-inline' data: blob: media: ws://localhost:*; media-src 'self' media: blob:;"
              : "default-src 'self' 'unsafe-inline' data: blob: media:; media-src 'self' media: blob:; script-src 'self';",
          ],
        },
      });
    });

    // Permissão negada por padrão. Só microfone e captura de tela passam, que é
    // o que este app faz — e só quando pedidos por uma janela nossa.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      const ours = [mainWindow, recorderWindow, pill].some((w) => w && !w.isDestroyed() && w.webContents === wc);
      callback(ours && (permission === 'media' || permission === 'display-capture'));
    });

    // Som do sistema (loopback) só existe no Windows. Quem pede o áudio é o
    // próprio getDisplayMedia do renderer, não um estado global daqui.
    session.defaultSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
          const target = sources.find((s) => s.id.startsWith('screen')) ?? sources[0];
          callback({ video: target, audio: request.audioRequested ? 'loopback' : undefined });
        } catch {
          callback({});
        }
      },
      { useSystemPicker: false },
    );

    registerIpc();
    createMainWindow();
    registerShortcut(getSettings().shortcut);
    ensureRecorder(); // pré-aquece: a primeira gravação não espera um renderer subir

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  // Nenhuma janela navega pra fora, e nenhum link abre janela do Electron.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      const allowed = isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL);
      if (!allowed && !url.startsWith('file://')) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Atalho global é registro no sistema: sem soltar, uma instância que morreu
  // feio deixa a combinação sequestrada até o próximo login.
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
