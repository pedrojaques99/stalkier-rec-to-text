import { execFile } from 'node:child_process';
import { clipboard } from 'electron';

/**
 * Copiar sempre, colar se você deixou.
 *
 * O Electron não injeta tecla; o sistema injeta. Nenhuma dependência nativa
 * aqui de propósito: `robotjs`/`nut-js` exigem toolchain de compilação e
 * quebram a cada versão do Electron, o que num app que a pessoa só quer
 * instalar é custo sem retorno.
 *
 * O texto NUNCA é interpolado num comando. Ele vai pra área de transferência
 * pela API do Electron, e o que é injetado é só a combinação de teclas fixa
 * (Ctrl+V / Cmd+V), escrita à mão neste arquivo. Interpolar o texto ditado num
 * shell seria injeção de comando com a sua própria voz.
 */
export function pasteText(text: string, { paste }: { paste: boolean }): void {
  clipboard.writeText(text);
  if (!paste) return;

  if (process.platform === 'win32') {
    // -STA é obrigatório: sem apartamento single-thread o SendKeys do WinForms
    // não inicializa e a chamada volta com código 0 sem ter feito nada.
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-STA',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ],
      { windowsHide: true },
      () => {},
    );
    return;
  }

  if (process.platform === 'darwin') {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      () => {},
    );
    return;
  }

  // Linux: xdotool é o caminho comum e não vem instalado por padrão. Falhar aqui
  // não é erro fatal — o texto já está na área de transferência.
  execFile('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], () => {});
}
