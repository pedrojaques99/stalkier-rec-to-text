# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability.

Use GitHub's private reporting: **Security → Report a vulnerability** on this
repository. That opens a private advisory only the maintainers can see.

Include what you need to make it real: affected version, platform, and the
smallest reproduction you can manage. A proof of concept is welcome; exploiting
anyone else's machine is not.

Expect a first reply within **7 days**. If a fix is warranted, the advisory and
the patch are published together, and you get credit unless you ask otherwise.

## Scope

In scope, and the properties this project intends to hold:

| Property | What breaking it looks like |
|---|---|
| The API key never touches disk in plain text | reading the key from a file, a log, a crash dump or the renderer |
| The renderer cannot reach the filesystem or spawn processes | escaping the preload surface, node access in a window |
| No local network surface | any listening socket opened by the app |
| Media paths cannot escape the app's data dir | a session id that resolves outside `userData` |
| The dictated text is data, never a command | shell/AppleScript injection through a transcript |
| Nothing is sent anywhere except the transcription API | any request to a host other than `api.groq.com` |

Out of scope: whatever the transcription provider does with audio you chose to
send (read their terms), physical access to an unlocked machine, and malware
already running as your user — at that point the OS keystore is the boundary,
not this app.

## Supported versions

Pre-1.0: only the latest release gets fixes.
