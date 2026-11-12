/**
 * Todo texto que aparece na tela, num lugar só.
 *
 * O componente é o mesmo nos dois apps; o idioma não. Sem esta camada, ou a aba
 * do Jaques Studio passava a falar inglês, ou a UI voltava a ser duas cópias —
 * e a segunda cópia é onde a divergência começa, porque é onde mais se mexe.
 *
 * Regras da voz PT (herdadas da casa): sem travessão, sem bolinha separadora,
 * sem ponto-e-vírgula, sem emoji, sem abertura de guru.
 */
export interface Strings {
  record: string;
  withScreen: string;
  withScreenHint: string;
  stop: string;
  escDiscards: string;
  transcribing: string;
  mic: string;
  system: string;
  sourceHint: (name: string, on: boolean) => string;
  shortcutAnywhere: string;
  shortcutTitle: string;
  monthCost: (v: string) => string;
  monthTitle: (sessions: number, duration: string) => string;
  settings: string;
  settingsAria: string;
  closeSettings: string;

  unavailable: string;
  noFfmpeg: string;
  noKey: string;
  addKey: string;

  search: string;
  searchEmpty: string;
  empty: string;
  emptyHintBefore: string;
  emptyHintAfter: string;
  loadError: (msg: string) => string;
  backendDown: string;

  copy: string;
  copied: string;
  transcriptClean: string;
  transcriptStamps: string;
  bold: string;
  italic: string;
  strike: string;
  bulletList: string;
  orderedList: string;
  edited: string;
  saving: string;
  restoreClean: string;
  restoreConfirm: string;
  sweep: string;
  sweeping: string;
  sweepDecisions: string;
  sweepTasks: string;
  sweepOpen: string;
  sweepEmpty: string;
  sweepAgain: string;
  sweepClear: string;
  sweepFail: (err: string) => string;
  sweepEngine: (engine: string) => string;
  downloadMp3: string;
  downloadMp4: string;
  remove: string;
  removeConfirm: (withVideo: boolean) => string;
  opening: string;
  jumpTo: string;
  silence: string;
  localEngine: string;
  dictation: string;
  engineLine: (engine: string, cost: string) => string;
  today: string;
  yesterday: string;

  teachTitle: string;
  teachHint: string;
  topTitle: string;
  topHint: string;
  rareTitle: string;
  rareHint: string;
  ticsTitle: string;
  ticsHint: string;
  statTitle: (word: string, n: number, sessions: number) => string;
  ticTitle: (word: string, n: number, perMin: string) => string;
  panelEmpty: string;
  wordTitle: (word: string, n: number, sessions: number, proper: boolean, inLibrary: boolean) => string;

  keyLabel: string;
  keyPlaceholder: (hint: string | null) => string;
  save: string;
  test: string;
  keyOk: string;
  keyRejected: (err: string) => string;
  keyStoredEncrypted: string;
  keyMemoryOnly: string;
  price: string;

  pasteLabel: string;
  pasteHint: string;
  polishLabel: string;
  polishHint: string;
  localLabel: string;
  localHint: string;

  shortcutLabel: string;
  shortcutScreenLabel: string;
  shortcutScreenHint: string;
  shortcutChange: string;
  shortcutNone: string;
  shortcutPress: string;
  shortcutHint: string;
  shortcutNeedsModifier: string;
  shortcutBadKey: string;

  libraryLabel: string;
  libraryPlaceholder: string;
  libraryAdd: string;
  libraryRemove: (term: string) => string;
  libraryHint: string;

  // ─── Galeria ───
  viewGrid: string;
  viewList: string;
  screenBadge: string;
  processing: string;
  failed: string;
  failedHint: (err: string) => string;
  retry: string;
  retrying: string;
  noSpeech: string;
  play: string;
  close: string;
  prev: string;
  next: string;
  size: (mb: string) => string;
  // ─── Quick edits: aparar e recortar ───
  edit: string;
  editLeave: string;
  aspect: string;
  aspectFree: string;
  aspectOriginal: string;
  playRange: string;
  rangeLine: (from: string, to: string, dur: string) => string;
  saveClip: string;
  savingClip: string;
  clipFail: (err: string) => string;
  clipFrom: string;
  waveLoading: string;
  waveFail: string;
  dragToTrim: string;
  cropArea: string;
  cropNW: string; cropN: string; cropNE: string; cropE: string;
  cropSE: string; cropS: string; cropSW: string; cropW: string;
  editFail: string;

  // ─── Resultado ───
  preparing: string;
  preparingScreen: string;
  savedOk: (duration: string) => string;
  savedFail: (err: string) => string;
  noMicWarning: string;
  openRecording: string;
  dismiss: string;
}

export const en: Strings = {
  record: 'Record',
  withScreen: 'With screen',
  withScreenHint: 'Records the main screen too. You get an .mp4 alongside the .mp3',
  stop: 'Stop',
  escDiscards: 'Esc discards',
  transcribing: 'Transcribing',
  mic: 'mic',
  system: 'system',
  sourceHint: (name, on) => `${name} — ${on ? 'goes into the recording' : 'left out'}`,
  shortcutAnywhere: 'anywhere',
  shortcutTitle: 'Press it in any window, speak, press again. The text lands where your cursor is.',
  monthCost: (v) => `${v} this month`,
  monthTitle: (sessions, duration) => `${sessions} sessions, ${duration} of audio this month`,
  settings: 'Settings',
  settingsAria: 'Settings',
  closeSettings: 'Close settings',

  unavailable: 'Recording needs the desktop app. This page is running in a browser.',
  noFfmpeg: 'ffmpeg was not found on your PATH. Recording works, but nothing can be converted or transcribed until you install it.',
  noKey: 'No API key: transcribing with local Whisper, which takes about as long as the audio.',
  addKey: 'add a key',

  search: 'search what was said    /',
  searchEmpty: 'Search runs over the full text of every session.',
  empty: 'No recordings yet.',
  emptyHintBefore: 'Hit',
  emptyHintAfter: 'in any window and the text lands where your cursor is.',
  loadError: (msg) => `Could not read the recordings: ${msg}`,
  backendDown: 'the backend did not respond',

  copy: 'Copy the transcript',
  copied: 'Copied',
  transcriptClean: 'Clean text',
  transcriptStamps: 'With timestamps',
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
  edited: 'edited by you',
  saving: 'saving…',
  restoreClean: 'Back to the clean transcript',
  restoreConfirm: 'Drop your edits and go back to the clean transcript?',
  sweep: 'Sweep: decisions, tasks and open questions',
  sweeping: 'sweeping…',
  sweepDecisions: 'decided',
  sweepTasks: 'to do',
  sweepOpen: 'still open',
  sweepEmpty: 'nothing actionable in this one',
  sweepAgain: 'Sweep again',
  sweepClear: 'Drop the sweep',
  sweepFail: (err) => `The sweep failed: ${err}`,
  sweepEngine: (engine) => `swept by ${engine}`,
  downloadMp3: 'Download the .mp3',
  downloadMp4: 'Download the .mp4',
  remove: 'Delete this recording',
  removeConfirm: (withVideo) =>
    `Delete this recording?\n\nThe audio${withVideo ? ', the video' : ''} and the transcript go with it.`,
  opening: 'opening…',
  jumpTo: 'jump to this point',
  silence: 'silence — nothing was said',
  localEngine: 'local',
  dictation: 'dictation',
  engineLine: (engine, cost) => (engine === 'local' ? 'local whisper, no cost' : `groq whisper-large-v3-turbo, ${cost}`),
  today: 'today',
  yesterday: 'yesterday',

  teachTitle: 'teach the model',
  topTitle: 'most said',
  topHint: 'Straight count over the last 30 days, articles and prepositions out.',
  rareTitle: 'rare and yours',
  rareHint: 'Said many times inside few recordings. That is project jargon, not vocabulary.',
  ticsTitle: 'verbal tics',
  ticsHint: 'Per minute of speech. The only list here that measures you and not the model.',
  statTitle: (word, n, sessions) => `${word}, ${n}× across ${sessions} sessions`,
  ticTitle: (word, n, perMin) => `${word}, ${n}× in the period, ${perMin} per minute`,
  panelEmpty: 'nothing here yet',
  teachHint: 'Click to add it to your library. The model gets it as context, and near-misses are corrected afterwards.',
  wordTitle: (word, n, sessions, proper, inLibrary) =>
    inLibrary
      ? `${word}, ${n}× in ${sessions} sessions. Already in your library.`
      : `${word}, ${n}× in ${sessions} sessions${proper ? ', capitalized mid-sentence (likely a name)' : ''}. Click to teach its spelling.`,

  keyLabel: 'Groq API key',
  keyPlaceholder: (hint) => (hint ? `stored  ${hint}` : 'gsk_…'),
  save: 'Save',
  test: 'Test',
  keyOk: 'key works',
  keyRejected: (err) => `rejected: ${err}`,
  keyStoredEncrypted:
    'Encrypted with your OS keystore. It never leaves this machine and is never shown back to you.',
  keyMemoryOnly:
    'No OS keystore available here, so the key is kept in memory for this session only and never written to disk.',
  price: '$0.04 per hour of audio: a one-hour meeting costs four cents.',

  pasteLabel: 'Paste where the cursor is',
  pasteHint: 'Off, the text only goes to the clipboard.',
  polishLabel: 'Polish the text',
  polishHint: 'Strips hesitations and stutters with an LLM. On a short dictation it usually gets in the way.',
  localLabel: 'Force local Whisper',
  localHint: 'No cost and offline, but it takes roughly as long as the audio. Needs Python and faster-whisper.',

  shortcutLabel: 'global shortcut',
  shortcutScreenLabel: 'screen shortcut',
  shortcutScreenHint: 'press it anywhere and the screen starts recording, silence included. press again to stop',
  shortcutChange: 'change',
  shortcutNone: 'none',
  shortcutPress: 'press the combination',
  shortcutHint: 'press and speak. press again and the text is pasted',
  shortcutNeedsModifier: 'add Ctrl, Alt or Shift',
  shortcutBadKey: 'that key cannot be a shortcut',

  libraryLabel: 'word library',
  libraryPlaceholder: 'nickname, app or proper noun (Enter to add)',
  libraryAdd: 'Add term',
  libraryRemove: (term) => `Remove ${term}`,
  libraryHint:
    'These go to the model as context, and near-misses are corrected afterwards. It is what turns “kubernets” into “Kubernetes” without touching “cloud”.',

  viewGrid: 'Gallery',
  viewList: 'List',
  screenBadge: 'screen',
  processing: 'transcribing',
  failed: 'no transcript',
  failedHint: (err) => `The recording is safe. The transcript failed: ${err}`,
  retry: 'try again',
  retrying: 'trying…',
  noSpeech: 'no speech',
  play: 'Play',
  close: 'Close',
  prev: 'Previous',
  next: 'Next',
  size: (mb) => `${mb} MB`,
  // ─── Quick edits ───
  edit: 'Trim and crop',
  editLeave: 'Back to reading',
  aspect: 'ratio',
  aspectFree: 'free',
  aspectOriginal: 'original',
  playRange: 'Play the range',
  rangeLine: (from, to, dur) => `${from} → ${to}  (${dur})`,
  saveClip: 'Save the clip',
  savingClip: 'cutting…',
  clipFail: (err) => `The cut failed: ${err}`,
  clipFrom: 'cut',
  waveLoading: 'reading the waveform…',
  waveFail: 'No waveform for this one — you can still set the range by hand.',
  dragToTrim: 'Drag the edges to pick the range',
  // Punho não se lê: quem navega por leitor de tela precisa que cada um diga
  // de qual lado puxa, e a moldura diga que as setas a movem.
  cropArea: 'Crop area — arrow keys move it',
  cropNW: 'Resize from the top left', cropN: 'Resize from the top',
  cropNE: 'Resize from the top right', cropE: 'Resize from the right',
  cropSE: 'Resize from the bottom right', cropS: 'Resize from the bottom',
  cropSW: 'Resize from the bottom left', cropW: 'Resize from the left',
  // Cerca do chunk do editor: um botão opcional que não chegou não pode
  // levar junto a leitura, a transcrição e o diálogo.
  editFail: 'The editor did not load. Back to reading, and try again.',

  preparing: 'Preparing…',
  preparingScreen: 'Waiting for the screen capture…',
  savedOk: (duration) => `Saved, ${duration}`,
  savedFail: (err) => `Nothing was saved: ${err}`,
  noMicWarning: 'recorded without the microphone',
  openRecording: 'open',
  dismiss: 'Dismiss',
};

export const pt: Strings = {
  record: 'Gravar',
  withScreen: 'Com a tela',
  withScreenHint: 'Grava a tela principal junto. Sai .mp4 além do .mp3',
  stop: 'Parar',
  escDiscards: 'Esc descarta',
  transcribing: 'Transcrevendo',
  mic: 'mic',
  system: 'sistema',
  sourceHint: (name, on) => `${name} — ${on ? 'entra na gravação' : 'fora da gravação'}`,
  shortcutAnywhere: 'em qualquer janela',
  shortcutTitle: 'Aperta em qualquer janela, fala, aperta de novo. O texto é colado onde o cursor estiver.',
  monthCost: (v) => `${v} no mês`,
  monthTitle: (sessions, duration) => `${sessions} sessões, ${duration} de áudio este mês`,
  settings: 'Ajustes',
  settingsAria: 'Ajustes',
  closeSettings: 'Fechar ajustes',

  unavailable: 'Gravar só dentro do app. Esta página está no navegador.',
  noFfmpeg: 'O ffmpeg não foi encontrado no PATH. Gravar funciona, mas nada é convertido nem transcrito até você instalar.',
  noKey: 'Sem chave da Groq: transcrevendo no Whisper local, que leva o tempo do áudio.',
  addKey: 'pôr a chave',

  search: 'buscar no que foi dito    /',
  searchEmpty: 'A busca varre o texto inteiro de todas as sessões.',
  empty: 'Nenhuma gravação ainda.',
  emptyHintBefore: 'Aperte',
  emptyHintAfter: 'em qualquer janela e o texto é colado onde o cursor estiver.',
  loadError: (msg) => `Não deu pra ler as sessões: ${msg}`,
  backendDown: 'o backend não respondeu',

  copy: 'Copiar a transcrição',
  copied: 'Copiado',
  transcriptClean: 'Texto limpo',
  transcriptStamps: 'Com os tempos',
  bold: 'Negrito',
  italic: 'Itálico',
  strike: 'Riscado',
  bulletList: 'Lista',
  orderedList: 'Lista numerada',
  edited: 'editado por você',
  saving: 'guardando…',
  restoreClean: 'Voltar ao texto limpo',
  restoreConfirm: 'Descartar o que você editou e voltar ao texto limpo?',
  sweep: 'Varrer: decisões, tarefas e pendências',
  sweeping: 'varrendo…',
  sweepDecisions: 'ficou decidido',
  sweepTasks: 'pra fazer',
  sweepOpen: 'em aberto',
  sweepEmpty: 'não tem nada pra agir nesta aqui',
  sweepAgain: 'Varrer de novo',
  sweepClear: 'Apagar a varredura',
  sweepFail: (err) => `A varredura falhou: ${err}`,
  sweepEngine: (engine) => `varrido por ${engine}`,
  downloadMp3: 'Baixar o .mp3',
  downloadMp4: 'Baixar o .mp4',
  remove: 'Apagar a sessão',
  removeConfirm: (withVideo) =>
    `Apagar esta gravação?\n\nO áudio${withVideo ? ', o vídeo' : ''} e a transcrição vão junto.`,
  opening: 'abrindo…',
  jumpTo: 'pular pra este ponto',
  silence: 'silêncio, nada foi dito',
  localEngine: 'local',
  dictation: 'ditado',
  engineLine: (engine, cost) =>
    engine === 'local' ? 'whisper local, sem custo' : `groq whisper-large-v3-turbo, ${cost}`,
  today: 'hoje',
  yesterday: 'ontem',

  teachTitle: 'pra ensinar ao whisper',
  topTitle: 'mais ditas',
  topHint: 'Contagem crua dos últimos 30 dias, sem artigo nem preposição.',
  rareTitle: 'raras e suas',
  rareHint: 'Palavra repetida dentro de poucas gravações. Isso é jargão de projeto, não vocabulário.',
  ticsTitle: 'vícios de linguagem',
  ticsHint: 'Por minuto de fala. É a única lista aqui que mede você, e não o modelo.',
  statTitle: (word, n, sessions) => `${word}, ${n}× em ${sessions} sessões`,
  ticTitle: (word, n, perMin) => `${word}, ${n}× no período, ${perMin} por minuto`,
  panelEmpty: 'ainda não tem nada aqui',
  teachHint: 'Clique pra pôr na biblioteca: o modelo passa a escrever certo, e a correção conserta o que ele escrever parecido.',
  wordTitle: (word, n, sessions, proper, inLibrary) =>
    inLibrary
      ? `${word}, ${n}× em ${sessions} sessões. Já está na biblioteca.`
      : `${word}, ${n}× em ${sessions} sessões${proper ? ', escrita com maiúscula no meio da frase (nome próprio)' : ''}. Clique pra ensinar a grafia.`,

  keyLabel: 'chave da groq',
  keyPlaceholder: (hint) => (hint ? `gravada  ${hint}` : 'gsk_…'),
  save: 'Guardar',
  test: 'Testar',
  keyOk: 'chave boa',
  keyRejected: (err) => `recusada: ${err}`,
  keyStoredEncrypted: 'Guardada no cofre do sistema. Não sai desta máquina e nunca volta pra tela.',
  keyMemoryOnly: 'Sem cofre do sistema aqui: a chave vale só nesta sessão e não é gravada em disco.',
  price: 'US$0,04 por hora de áudio: uma reunião de uma hora custa quatro centavos de dólar.',

  pasteLabel: 'Colar onde o cursor está',
  pasteHint: 'Desligado, o texto só vai pra área de transferência.',
  polishLabel: 'Polir o texto',
  polishHint: 'Tira "éé", "hum" e gaguejo com um LLM. Num ditado curto costuma atrapalhar.',
  localLabel: 'Forçar Whisper local',
  localHint: 'Custo zero e offline, mas leva mais ou menos o tempo do áudio.',

  shortcutLabel: 'atalho global',
  shortcutScreenLabel: 'atalho da tela',
  shortcutScreenHint: 'aperta em qualquer janela e a tela começa a gravar, com ou sem você falando. aperta de novo pra parar',
  shortcutChange: 'trocar',
  shortcutNone: 'nenhum',
  shortcutPress: 'aperte a combinação',
  shortcutHint: 'aperta e fala. aperta de novo e o texto é colado',
  shortcutNeedsModifier: 'precisa de Ctrl, Alt ou Shift junto',
  shortcutBadKey: 'essa tecla não serve de atalho',

  libraryLabel: 'biblioteca de palavras',
  libraryPlaceholder: 'apelido, app ou nome próprio (Enter pra somar)',
  libraryAdd: 'Adicionar termo',
  libraryRemove: (term) => `Remover ${term}`,
  libraryHint:
    'Vai como contexto pro modelo e depois conserta o que ele escreveu parecido. É o que faz “Vizant” virar “Visant” sem tocar em “cloud”.',

  viewGrid: 'Galeria',
  viewList: 'Lista',
  screenBadge: 'tela',
  processing: 'transcrevendo',
  failed: 'sem transcrição',
  failedHint: (err) => `A gravação está salva. Quem falhou foi a transcrição: ${err}`,
  retry: 'tentar de novo',
  retrying: 'tentando…',
  noSpeech: 'sem fala',
  play: 'Abrir',
  close: 'Fechar',
  prev: 'Anterior',
  next: 'Próxima',
  size: (mb) => `${mb} MB`,
  // ─── Quick edits ───
  edit: 'Aparar e recortar',
  editLeave: 'Voltar a ler',
  aspect: 'proporção',
  aspectFree: 'livre',
  aspectOriginal: 'original',
  playRange: 'Tocar o trecho',
  rangeLine: (from, to, dur) => `${from} → ${to}  (${dur})`,
  saveClip: 'Salvar o corte',
  savingClip: 'cortando…',
  clipFail: (err) => `O corte falhou: ${err}`,
  clipFrom: 'corte',
  waveLoading: 'lendo a onda…',
  waveFail: 'Sem onda pra esta — dá pra marcar o trecho na mão do mesmo jeito.',
  dragToTrim: 'Arraste as bordas pra escolher o trecho',
  cropArea: 'Recorte — as setas movem',
  cropNW: 'Puxar pelo canto de cima à esquerda', cropN: 'Puxar por cima',
  cropNE: 'Puxar pelo canto de cima à direita', cropE: 'Puxar pela direita',
  cropSE: 'Puxar pelo canto de baixo à direita', cropS: 'Puxar por baixo',
  cropSW: 'Puxar pelo canto de baixo à esquerda', cropW: 'Puxar pela esquerda',
  editFail: 'O editor não carregou. Volte a ler e tente de novo.',

  preparing: 'Preparando…',
  preparingScreen: 'Esperando a captura da tela…',
  savedOk: (duration) => `Gravado, ${duration}`,
  savedFail: (err) => `Não gravou nada: ${err}`,
  noMicWarning: 'gravado sem o microfone',
  openRecording: 'abrir',
  dismiss: 'Fechar aviso',
};
