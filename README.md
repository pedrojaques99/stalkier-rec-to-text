# stalkier — rec to text

Press a shortcut anywhere, speak, press it again: the text lands where your
cursor already was. Recordings and transcripts stay on your machine, and the
only thing that ever leaves it is the audio you choose to send to the
transcription API with **your own key**.

> Status: **v0.1, early**. It works end to end on Windows and is built to be
> read before it is trusted — see [Security](#security).

## Why this exists

Dictation apps in this space are subscriptions ($12–15/month) wrapped around an
API that costs about **$0.04 per hour of audio**. This is that API, plus the
three things that actually make dictation usable:

- **A global shortcut** that works with the window closed, and pastes into the
  app you were already typing in.
- **A word library.** Names, nicknames, product names and jargon get sent as
  context, and near-misses are corrected afterwards with a deterministic pass —
  it is what turns "kubernets" into "Kubernetes" *without* turning "cloud" into
  "Claude".
- **A local fallback.** No key, no network, or the service is down: it
  transcribes offline instead of failing, and tells you which engine ran.

## Install

Requirements:

- **Node 22+** and **ffmpeg on your PATH** (`winget install ffmpeg`,
  `brew install ffmpeg`, `apt install ffmpeg`). The app checks and says so if
  it is missing — no binary is downloaded behind your back.
- A **Groq API key** (free tier is enough to try): <https://console.groq.com/keys>

```bash
git clone https://github.com/pedrojaques99/stalkier-rec-to-text
cd stalkier-rec-to-text
npm install
npm run dev
```

Package a desktop build with `npm run dist`.

### Optional: offline transcription

```bash
pip install faster-whisper
```

The app finds `python` on your PATH and uses it when there is no key, when the
network fails, or when you force it in Settings. Expect it to take roughly as
long as the audio on CPU. Without Python, the cloud path is used and the
interface says so.

## How it works

```
 global shortcut ─▶ hidden recorder window (MediaRecorder)
                        │  3s chunks over IPC
                        ▼
                   main process ──▶ ffmpeg ──▶ 16kHz mono FLAC
                        │                          │
                        │                          ▼
                        │                 Groq whisper-large-v3-turbo
                        │                 (or local faster-whisper)
                        ▼                          │
              clipboard + paste ◀── correction ◀───┘
```

Three layers do the transcription, in this order:

1. **Context** — your library goes in the model's `prompt` field.
2. **Correction** — a short Levenshtein pass against the same library. No LLM:
   an LLM "fixing" a proper noun invents proper nouns.
3. **Polish** (off by default) — strips hesitations and stutters.

## Security

This is a desktop app that listens to your microphone and holds an API key, so
the design is written down and testable rather than promised:

- **No listening port.** Everything between the interface and the system goes
  over Electron IPC. An earlier version of this code talked to a local HTTP
  server, which means any page open in your browser could call it and read your
  transcripts. There is no local network surface here.
- **The key is never written in plain text.** It goes through Electron
  `safeStorage` (DPAPI on Windows, Keychain on macOS, the desktop wallet on
  Linux). If the OS offers no keystore, the key is kept **in memory for that
  session only** and never written to disk. It is never sent back to the
  interface — the UI only ever sees the last four characters.
- **`contextIsolation` on, `nodeIntegration` off, `sandbox` on** in every
  window; a restrictive CSP on every response; navigation and `window.open`
  blocked; `<webview>` refused.
- **Media is served by a custom `media://` protocol** whose id is validated
  against `^[a-z0-9]{6,24}$` before it becomes a path — `../../` does not
  survive the regex.
- **Permissions are denied by default**, except microphone and screen capture
  requested by this app's own windows.
- **ffmpeg is never called through a shell**, and no user input becomes a flag.
- **The dictated text is never interpolated into a command.** It goes to the
  clipboard through Electron's API; only a fixed key combination is injected.
- **No telemetry, no analytics, no project server.** The only outbound request
  is to the transcription API whose key you pasted. Grep for `fetch(` — there
  are two call sites, both to `api.groq.com`.

Found a hole? [SECURITY.md](SECURITY.md).

## Known limits

- **Windows is the tested platform.** System audio (loopback) capture is
  Windows-only by design of the underlying API. macOS and Linux run, but only
  the microphone path is exercised.
- The session index is a JSON file read into memory. At ~20 dictations a day
  that is a few MB a year, which is fine; if it ever hurts, the answer is
  SQLite, not a cleverer index.
- The cloud API takes files up to 25 MB (100 MB on paid tiers). 16 kHz mono
  FLAC keeps that far away, but a multi-hour meeting will still need chunking,
  which is not implemented yet.
- No diarization (who said what) and no live transcription while recording.

## License

MIT — see [LICENSE](LICENSE).
