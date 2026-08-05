import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types.js';

/**
 * Preferências e chave de API.
 *
 * A CHAVE NUNCA É GRAVADA EM TEXTO PLANO. Ela passa pelo `safeStorage` do
 * Electron, que usa o DPAPI no Windows, o Keychain no macOS e a carteira do
 * ambiente no Linux — quem lê o arquivo sem ser o seu usuário vê bytes.
 *
 * Um `.env` ou um JSON com a chave crua seria mais simples e é exatamente o que
 * torna um repo público indefensável: basta um print de tela, um backup ou uma
 * pasta sincronizada pra vazar. Se o sistema não oferecer criptografia,
 * preferimos NÃO gravar e pedir a chave de novo a cada sessão.
 *
 * A chave também nunca volta pra interface: o renderer só recebe os quatro
 * últimos caracteres, o suficiente pra você reconhecer qual é.
 */

const settingsFile = () => join(app.getPath('userData'), 'settings.json');
const keyFile = () => join(app.getPath('userData'), 'apikey.bin');

function writeAtomic(path: string, data: string | Buffer): void {
  mkdirSync(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings(), ...patch };
  writeAtomic(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

export function hasEncryption(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

let keyInMemory: string | null = null;

export function setApiKey(key: string): { ok: boolean; reason?: string } {
  const clean = String(key || '').trim();
  if (!clean) {
    keyInMemory = null;
    try {
      writeAtomic(keyFile(), Buffer.alloc(0));
    } catch {
      /* nada a apagar */
    }
    return { ok: true };
  }
  keyInMemory = clean;
  if (!hasEncryption()) {
    // Sem criptografia do sistema a chave fica só na memória desta execução.
    // Perder a chave ao fechar o app é melhor que deixá-la legível no disco.
    return { ok: true, reason: 'sem cofre do sistema: a chave vale só nesta sessão' };
  }
  writeAtomic(keyFile(), safeStorage.encryptString(clean));
  return { ok: true };
}

export function getApiKey(): string | null {
  if (keyInMemory) return keyInMemory;
  try {
    if (!existsSync(keyFile()) || !hasEncryption()) return null;
    const buf = readFileSync(keyFile());
    if (!buf.length) return null;
    keyInMemory = safeStorage.decryptString(buf);
    return keyInMemory;
  } catch {
    return null;
  }
}

/** O que a interface pode ver: nunca a chave, só o bastante pra reconhecê-la. */
export function apiKeyHint(): string | null {
  const k = getApiKey();
  return k ? `…${k.slice(-4)}` : null;
}
