# Local Environment

This repo uses a local `.env` file for on-demand tools that need secrets. The file persists across terminal and Codex sessions but is ignored by git.

## Setup

1. Create `.env` from the template if it does not exist:

```powershell
Copy-Item .env.example .env
```

2. Edit `.env` and paste the rotated Close API key:

```dotenv
CLOSE_API_KEY=your_rotated_close_key_here
```

3. Verify the export script can read local configuration:

```powershell
npm run close:check
```

`close:check` is a dry run. It does not call Close and does not expose the key.

## Usage

Any future shell or Codex session launched in this repo can run Close export commands without setting `$env:CLOSE_API_KEY` again, because `scripts/close-export-calls.mjs` loads `.env` automatically.

```powershell
node scripts/close-export-calls.mjs --since 2026-05-01 --max 100 --out data/close/calls-2026-05.jsonl
```

Shell environment variables still take precedence over `.env`, so you can temporarily override the key without editing the file.

## Safety

- `.env` is ignored by git.
- `.env.example` is safe to commit because it contains no secret value.
- Exported CRM data under `data/close` is ignored by git.
- Do not paste live keys into tracked files or chat unless you intend to rotate them immediately.
