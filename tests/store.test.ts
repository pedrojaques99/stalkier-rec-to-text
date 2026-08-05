import { describe, expect, it, vi } from 'vitest';

// O store fala com o Electron só pra descobrir a pasta do usuário. No teste ela
// é um diretório temporário — o que está sob teste é a FRONTEIRA de validação,
// não o sistema de arquivos.
vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP || '/tmp' },
}));

const { saveSession, getSession, removeSession, isValidId, newId } = await import('../src/main/store.js');
import type { Session } from '../src/shared/types.js';

const base = (over: Partial<Session> = {}): Session => ({
  id: newId(), createdAt: Date.now(), kind: 'audio', durMs: 1000, hasVideo: false,
  engine: 'groq', costUsd: 0.001, text: 'hello', segments: [], ...over,
});

describe('isValidId', () => {
  it('rejects anything that could walk out of the data dir', () => {
    expect(isValidId('../../etc/passwd')).toBe(false);
    expect(isValidId('a/b')).toBe(false);
    expect(isValidId('..')).toBe(false);
    expect(isValidId('')).toBe(false);
    expect(isValidId(newId())).toBe(true);
  });
});

describe('saveSession', () => {
  it('truncates a hostile transcript instead of letting it into the index', () => {
    const s = base({ text: 'x'.repeat(500_000) });
    saveSession(s);
    expect(getSession(s.id)!.text.length).toBe(200_000);
    removeSession(s.id);
  });

  it('coerces junk numbers coming from a remote response', () => {
    const s = base({ costUsd: Number.NaN, durMs: -5, engine: 'weird' as never });
    saveSession(s);
    const got = getSession(s.id)!;
    expect(got.costUsd).toBe(0);
    expect(got.durMs).toBe(0);
    expect(got.engine).toBe('local');
    removeSession(s.id);
  });

  it('refuses an id that is not app-generated', () => {
    expect(() => saveSession(base({ id: '../evil' }))).toThrow();
  });
});
