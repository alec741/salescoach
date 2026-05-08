# Local Environment

This repo uses a local `.env` file for on-demand tools that need secrets. The file persists across terminal and Codex sessions but is ignored by git.

## Setup

1. Create `.env` from the template if it does not exist:

```powershell
Copy-Item .env.example .env
```

2. Edit `.env` and paste the app, database, and Close settings:

```dotenv
DATABASE_URL=postgresql://...
NEON_AUTH_BASE_URL=https://...
NEON_AUTH_COOKIE_SECRET=generate_a_random_secret_at_least_32_characters
CLOSE_API_KEY=your_rotated_close_key_here
```

3. Add the model provider for automated grading and summaries when you are ready to run the full coaching backfill:

```dotenv
COACH_GRADER_PROVIDER=openrouter
COACH_SUMMARY_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key_here
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_SUMMARY_MODEL=anthropic/claude-sonnet-4.5
CRON_SECRET=generate_a_random_secret_for_hosted_cron_routes
```

4. Verify the export script can read local configuration:

```powershell
npm run close:check
```

`close:check` is a dry run. It does not call Close and does not expose the key.

## Slack

Report send events can post to Slack when these values are configured:

```dotenv
SLACK_BOT_TOKEN=xoxb-your-bot-token
# SLACK_ACCESS_TOKEN is also supported for local OAuth-token testing.
SLACK_MANAGER_CHANNEL_ID=C0123456789
SLACK_REP_TARGETS_FILE=config/slack-rep-targets.local.json
```

Rep delivery targets can also be provided inline with `SLACK_REP_TARGETS_JSON`, but a local file is easier to maintain. The file should contain a flat JSON object keyed by app user ID, rep email, or Close user ID:

```json
{
  "rep1@example.com": "U0123456789",
  "close_user_42": "C0123456789",
  "3fa85f64-5717-4562-b3fc-2c963f66afa6": "U0987654321"
}
```

Each value can be either a Slack user ID for a private DM or a channel ID for a private rep channel.

Use a bot token when possible. The bot must be installed in the workspace and invited to the target channel. Verify without posting:

```powershell
npm run slack:check
```

Send a test message only after the channel ID is set:

```powershell
npm run slack:test
```

Preview a manager summary delivery payload:

```powershell
npm run slack:summary:deliver -- --period daily --date 2026-05-06 --dry-run
```

Preview rep-summary targeting for one rep without posting:

```powershell
npm run slack:summary:deliver -- --audience rep --period daily --date 2026-05-06 --rep rep1@example.com --dry-run
```

`SLACK_SIGNING_SECRET` is only needed for inbound Slack request verification, which is not currently used by the report-send flow.

The current app only needs outbound posting. `chat:write` is the required Slack scope for report notifications. Channel-read scopes are optional and only needed if you run `node scripts/slack-check.mjs --check-channel`.

## Usage

Any future shell or Codex session launched in this repo can run Close export commands without setting `$env:CLOSE_API_KEY` again, because `scripts/close-export-calls.mjs` loads `.env` automatically.

```powershell
node scripts/close-export-calls.mjs --since 2026-05-01 --max 100 --out data/close/calls-2026-05.jsonl
```

Shell environment variables still take precedence over `.env`, so you can temporarily override the key without editing the file.

If you deploy to Vercel, copy the same runtime variables into the Vercel project settings. `CRON_SECRET` specifically protects `/api/cron/*` routes. Production scheduling is handled by `.github/workflows/coaching-jobs.yml`; set matching GitHub repository secrets for `APP_BASE_URL` and `CRON_SECRET` before enabling scheduled runs.

Production Vercel variables:

- `DATABASE_URL`
- `NEON_AUTH_BASE_URL`
- `NEON_AUTH_COOKIE_SECRET`
- `CLOSE_API_KEY`
- `CRON_SECRET`
- `COACH_GRADER_PROVIDER`
- `COACH_SUMMARY_PROVIDER`
- `COACH_TIMEZONE`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_SUMMARY_MODEL`
- `OPENROUTER_MAX_TOKENS`
- `OPENROUTER_SUMMARY_MAX_TOKENS`
- `SLACK_BOT_TOKEN`
- `SLACK_MANAGER_CHANNEL_ID`
- `SLACK_REP_TARGETS_JSON`, if sending rep-specific summaries

GitHub Actions repository secrets:

- `APP_BASE_URL`
- `CRON_SECRET`

Run the 30-day OpenRouter backfill with:

```powershell
node scripts/coach/backfill.mjs --days 30 --provider openrouter --llm-summaries
```

## Safety

- `.env` is ignored by git.
- `.env.example` is safe to commit because it contains no secret value.
- Exported CRM data under `data/close` is ignored by git.
- Do not paste live keys into tracked files or chat unless you intend to rotate them immediately.
