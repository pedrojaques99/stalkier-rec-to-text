import { contextBridge, ipcRenderer } from 'electron';
import type { Session, SessionSummary, Settings, StartOptions } from '../shared/types.js';

/**
 * A ÚNICA superfície que a interface enxerga.
 *
 * Nada de `fs`, `child_process` ou `ipcRenderer` cru chega ao renderer: cada
 * função aqui é um canal nomeado, com o argumento que o processo principal
 * valida do outro lado. É o que impede que um bug de XSS na interface vire
 * acesso ao disco.
 */

const on = (channel: string, cb: (payload: never) => void): (() => void) => {
  const handler = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload as never);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api = {
  rec: {
    start: (opts: StartOptions) => ipcRenderer.invoke('rec:start', opts),
    stop: () => ipcRenderer.invoke('rec:stop'),
    cancel: () => ipcRenderer.invoke('rec:cancel'),
    /** Também inscreve esta janela nos avisos de estado e de nível. */
    state: () => ipcRenderer.invoke('rec:state'),
    sources: () => ipcRenderer.invoke('rec:sources'),
    shortcut: (accelerator: string) => ipcRenderer.invoke('rec:shortcut', accelerator),
    pauseShortcut: (pause: boolean) => ipcRenderer.invoke('rec:shortcutPause', pause),
    onState: (cb: (s: never) => void) => on('state', cb),
    onLevel: (cb: (v: never) => void) => on('level', cb),
  },
  sessions: {
    list: (query: string): Promise<{ sessions: SessionSummary[]; month: { cost: number; sessions: number; ms: number } }> =>
      ipcRenderer.invoke('sessions:list', query),
    get: (id: string): Promise<Session | null> => ipcRenderer.invoke('sessions:get', id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('sessions:remove', id),
    reveal: (id: string): Promise<boolean> => ipcRenderer.invoke('sessions:reveal', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch),
  },
  key: {
    set: (key: string) => ipcRenderer.invoke('key:set', key),
    test: () => ipcRenderer.invoke('key:test'),
  },
  words: {
    list: () => ipcRenderer.invoke('words:list'),
  },
  vocabulary: {
    get: (): Promise<string[]> => ipcRenderer.invoke('vocabulary:get'),
    set: (list: string[]): Promise<string[]> => ipcRenderer.invoke('vocabulary:set', list),
  },
  /** Só o que a janela que grava usa. */
  recorder: {
    onStart: (cb: (cfg: never) => void) => on('recorder:start', cb),
    onStop: (cb: () => void) => on('recorder:stop', cb as (p: never) => void),
    onCancel: (cb: () => void) => on('recorder:cancel', cb as (p: never) => void),
    chunk: (buf: ArrayBuffer) => ipcRenderer.send('recorder:chunk', buf),
    done: (payload: { durMs?: number; error?: string }) => ipcRenderer.send('recorder:done', payload),
    level: (v: number) => ipcRenderer.send('recorder:level', v),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
