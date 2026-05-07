# Close CRM Call Export

This repo can export Close call activity data into local JSONL for later dataset building. Secrets are read from the environment or from a local `.env` file that is ignored by git.

## Secret Setup

Create a local `.env` file in the repo root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set the value:

```dotenv
CLOSE_API_KEY=your_rotated_key_here
```

Do not commit `.env`. It is ignored by `.gitignore`.

You can also set the key in the same shell instead:

```powershell
$env:CLOSE_API_KEY="your_rotated_key_here"
```

An environment variable already set in the shell takes precedence over `.env`.

## Export Recent Calls

```powershell
npm run close:calls:export -- -- --since 2026-05-01 --max 100 --out data/close/calls-2026-05.jsonl
```

Direct Node equivalent:

```powershell
node scripts/close-export-calls.mjs --since 2026-05-01 --max 100 --out data/close/calls-2026-05.jsonl
```

## Safe Defaults

- Output files under `data/close` are ignored by git.
- Recording and voicemail URLs are excluded by default.
- Transcript fields are requested from Close where available.
- Notes are included by default because they can help connect call outcomes to the sales process.
- The script writes one normalized call object per line.

## Options

```powershell
npm run close:calls:export -- -- --help
```

Useful options:

- `--since <ISO date>` filters by call `activity_at` lower bound.
- `--until <ISO date>` filters by call `activity_at` upper bound.
- `--max <number>` caps total exported calls.
- `--out <path>` chooses the JSONL output path.
- `--dry-run` validates URL construction without calling Close.
- `--include-recording-url` includes recording and voicemail URLs. Leave this off unless needed.
- `--exclude-notes` omits call notes.

## Windows Argument Forwarding Note

In this environment, npm requires an extra `--` before script arguments. If your terminal behaves differently, use the direct `node` command above.

## Close API Notes

Close uses Basic auth with the API key as the username and an empty password. Call transcripts are available through the call activity API via `_fields` but are not loaded by default, so the export requests `recording_transcript` and `voicemail_transcript` explicitly.

## Dataset Boundary

This exporter only pulls raw CRM call activity into an ignored local file. It does not add call recordings, transcripts, or customer data to tracked repo files. Any future training dataset should summarize and redact CRM data before it is committed.
