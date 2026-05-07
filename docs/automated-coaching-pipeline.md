# Automated Coaching Feedback Loop (Deferred)

Hourly unattended grading is deferred. Current v1 is interactive Codex call coaching; see docs/interactive-codex-coaching.md.

# Automated Coaching Feedback Loop

This local v1 runs an automated coaching pipeline for Enhancify calls from Close.

## Decisions Baked In

- Schedule: Monday-Friday, 6 AM to 6 PM Eastern.
- Hourly pull cadence: once per hour, intended at `:05` after the hour.
- Connected substantive call threshold: completed calls with transcript and duration at least 2 minutes.
- Outputs: local files only for v1.
- Rep summaries: generated automatically locally but not delivered until Slack or Close-note integration exists.
- Manager summary: generated locally at end of day.
- Grader: heuristic local grader by default.
- OpenAI: API connectivity is scaffolded but not activated.

## Local Commands

Run one hourly pull and grading pass, ignoring business-hour gating:

```powershell
npm run coach:hourly:force
```

Run a specific date window manually:

```powershell
node scripts/coach/run-hourly.mjs --force --since 2026-05-06T10:00:00.000Z --until 2026-05-06T11:00:00.000Z
```

Generate daily summaries for today:

```powershell
npm run coach:daily
```

Generate daily summaries for a specific Eastern date:

```powershell
node scripts/coach/run-daily-summary.mjs --date 2026-05-06
```

## Outputs

Ignored local outputs:

- `data/coach/raw-calls/YYYY-MM-DD.jsonl`
- `data/coach/scorecards/YYYY-MM-DD.jsonl`
- `data/coach/pipeline-state.json`
- `reports/daily/YYYY-MM-DD/<rep-name>.md`
- `reports/daily/YYYY-MM-DD/manager-summary.md`
- `reports/daily/YYYY-MM-DD/daily-aggregates.json`

## Installing Local Windows Schedule

Install scheduled tasks:

```powershell
npm run coach:schedule:install
```

Remove scheduled tasks:

```powershell
npm run coach:schedule:remove
```

Task names:

- `DecodedCoach-Hourly`
- `DecodedCoach-DailySummary`

## OpenAI Provider Placeholder

The pipeline defaults to local heuristic grading:

```dotenv
COACH_GRADER_PROVIDER=heuristic
```

OpenAI grading is intentionally scaffolded but not active for v1. When ready, add:

```dotenv
OPENAI_API_KEY=...
COACH_GRADER_PROVIDER=openai
```

Then implement the provider in `scripts/coach/grader.mjs` using the JSON contract in `prompts/grading/call-scorecard.md`.

## Vercel/UI Migration Notes

The local pipeline separates ingestion, grading, storage, and reporting so the future app can reuse the same boundaries:

- Close ingestion becomes a scheduled Vercel function or background worker.
- Scorecards move from local JSONL to Postgres/Supabase.
- Daily reports become dashboard views plus Slack/Close delivery jobs.
- The manager UI reads rep aggregates and call-level scorecards.
