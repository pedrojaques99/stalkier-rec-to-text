"""Local fallback: transcribe one file with faster-whisper and print JSON.

OPTIONAL. The app works without Python at all — it just loses the offline,
zero-cost path and says so in the interface.

    pip install faster-whisper
    python -m stalkier_whisper audio.flac --language en

Output: a single JSON object on the last stdout line. It has to be the last
line because faster-whisper writes progress and warnings to stderr and, on some
setups, to stdout as well.
"""

import argparse
import json
import os
import sys


def main() -> int:
    ap = argparse.ArgumentParser(prog="stalkier_whisper")
    ap.add_argument("file", help="audio file (any format ffmpeg reads)")
    ap.add_argument("--language", default=None, help="ISO-639-1 code; omit to autodetect")
    ap.add_argument("--prompt", default=None, help="context/vocabulary to bias spelling")
    ap.add_argument("--model", default=os.environ.get("STALKIER_MODEL", "small"))
    ap.add_argument("--device", default=os.environ.get("STALKIER_DEVICE", "cpu"))
    ap.add_argument("--compute-type", default=os.environ.get("STALKIER_COMPUTE", "int8"))
    a = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "faster-whisper is not installed. Run: pip install faster-whisper",
            file=sys.stderr,
        )
        return 2

    model = WhisperModel(a.model, device=a.device, compute_type=a.compute_type)
    segments, info = model.transcribe(
        a.file,
        language=a.language,
        beam_size=1,
        vad_filter=True,
        word_timestamps=False,
        initial_prompt=a.prompt or None,
    )

    out, text = [], []
    for s in segments:
        t = s.text.strip()
        out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": t})
        text.append(t)

    print(
        json.dumps(
            {
                "text": " ".join(text).strip(),
                "segments": out,
                "duration": getattr(info, "duration", None),
                "language": getattr(info, "language", None),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
