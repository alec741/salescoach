# Automated Coaching Feedback Loop

This repo now has disjoint local runners for unattended grading, period-summary generation, and Slack summary delivery for manager and rep audiences.

## Decisions Baked In

- Schedule window: Monday-Friday, 6 AM to 6 PM Eastern for grading.
- Grading cadence: every 30 minutes with a 40-minute lookback to tolerate small task delays.
- Connected substantive call threshold: completed calls with transcript and duration at least 10 minutes.
- Daily, weekly, and monthly summaries are generated from the DB-backed summary pipeline.
- Slack delivery: manager summaries can post to `SLACK_MANAGER_CHANNEL_ID`, and rep summaries can post to per-rep Slack user IDs or private channels from `SLACK_REP_TARGETS_FILE` or `SLACK_REP_TARGETS_JSON`. The delivery trigger prefers DB artifacts and only falls back to a local daily manager markdown file if one already exists.

## Local Commands

Run the scheduled 30-minute grading pass manually:

```powershell
npm run coach:grading:30m -- --force
```

Run a specific date window manually:

```powershell
node scripts/coach/run-half-hour-grading.mjs --force --since 2026-05-06T10:00:00.000Z --until 2026-05-06T11:00:00.000Z
```

Run the end-of-day daily summary flow for today:

```powershell
npm run coach:eod
```

Run the end-of-day flow for a specific Eastern date and skip Slack:

```powershell
node scripts/coach/run-eod-daily-summary.mjs --date 2026-05-06 --skip-slack
```

Generate the DB-backed weekly summary:

```powershell
npm run coach:summary:weekly -- --date 2026-05-08
```

Generate the DB-backed monthly summary:

```powershell
npm run coach:summary:monthly -- --date 2026-05-29
```

Send a manager summary to Slack without posting:

```powershell
npm run slack:summary:deliver -- --period daily --date 2026-05-06 --dry-run
```

## Hosted Vercel Cron Endpoints

The Next.js app now exposes protected cron routes for production deployment:

- `GET /api/cron/grading`
- `GET /api/cron/summaries/daily`
- `GET /api/cron/summaries/weekly`
- `GET /api/cron/summaries/monthly`
- `GET /api/cron/summaries/quarterly`

All hosted cron routes require `CRON_SECRET`. In Vercel, set `CRON_SECRET` as a project environment variable and Vercel will send `Authorization: Bearer <CRON_SECRET>` automatically on cron invocations. Manual testing can use either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.

Manual examples:

```powershell
curl -H "Authorization: Bearer $env:CRON_SECRET" https://your-app.vercel.app/api/cron/grading
curl -H "Authorization: Bearer $env:CRON_SECRET" "https://your-app.vercel.app/api/cron/summaries/daily?date=2026-05-08&force=1&skipSlack=1"
curl -H "x-cron-secret: $env:CRON_SECRET" "https://your-app.vercel.app/api/cron/summaries/monthly?date=2026-05-29"
```

Supported query parameters:

- Grading: `force=1`, `since=ISO`, `until=ISO`, `lookbackMinutes=40`, `provider=openrouter`, `max=1500`, `minDurationSeconds=600`, `skipImport=1`
- Summaries: `date=YYYY-MM-DD`, `force=1`, `skipSlack=1`, `llm=0|1`

Hosted summary routes keep the local gating behavior:

- Daily summary runs only on weekdays unless `force=1`
- Weekly summary runs only on Friday anchors unless `force=1`
- Monthly summary runs only on the last business day of the month unless `force=1`
- Quarterly summary runs only on the last business day of March, June, September, or December unless `force=1`

`vercel.json` does not register these schedules by default so the app can deploy on Vercel projects without paid cron capacity. GitHub Actions owns the production schedule in `.github/workflows/coaching-jobs.yml` and calls the deployed cron routes with `Authorization: Bearer <CRON_SECRET>`.

Configure these GitHub repository secrets:

- `APP_BASE_URL`: deployed app origin, for example `https://your-app.vercel.app`
- `CRON_SECRET`: same value configured in Vercel for the protected cron routes

The GitHub Actions workflow uses these UTC schedules:

- Grading: `*/30 * * * 1-5`
- Daily summary: `30 23 * * 1-5`
- Weekly summary: `45 23 * * 5`
- Monthly summary: `50 23 28-31 * *`
- Quarterly summary: `55 23 28-31 3,6,9,12 *`

Notes:

- GitHub Actions schedules are always UTC.
- Scheduled workflow timing is not exact; GitHub may delay execution under load.
- The monthly and quarterly schedules intentionally run on multiple candidate dates and rely on the route-level business-day checks to decide whether to actually generate the summary.

Send rep summaries to their mapped private Slack targets without posting:

```powershell
npm run slack:summary:deliver -- --audience rep --period daily --date 2026-05-06 --dry-run
```

## Outputs

Ignored local outputs:

- `data/coach/raw-calls/YYYY-MM-DD.jsonl`
- `data/coach/scorecards/YYYY-MM-DD.jsonl`
- `data/coach/pipeline-state.json`
- `reports/daily/YYYY-MM-DD/<rep-name>.md`
- `reports/daily/YYYY-MM-DD/manager-summary.md`
- `reports/daily/YYYY-MM-DD/daily-aggregates.json`

DB-backed summary artifacts:

- `coaching_summaries`
- `report_artifacts`
- `delivery_events` for sent, failed, or skipped Slack attempts when DB artifacts are available
- `report_artifact_events` with `event_type = "slack_sent"` after successful Slack delivery tied to an artifact
- `pipeline_jobs` for job locking, duplicate prevention, and success/failure payloads
- `delivery_events` for Slack/report delivery audit records

## Job Locking And Idempotency

Scheduled runners now write to `pipeline_jobs` before doing work:

- 30-minute grading key: `grade_calls:<since>:<until>:<provider>:<minDurationSeconds>`
- Daily summary key: `summary:daily:<date>`
- Weekly summary key: `summary:weekly:<date>`
- Monthly summary key: `summary:monthly:<date>`
- Quarterly summary key: `summary:quarterly:<date>`

If a matching key already exists, the runner exits cleanly instead of double-processing. Use `--force` when you intentionally want to supersede a queued/running job and rerun the same window or period.

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

- `DecodedCoach-GradeEvery30Minutes`
- `DecodedCoach-DailySummary`
- `DecodedCoach-WeeklySummary`
- `DecodedCoach-MonthlySummary`
- `DecodedCoach-QuarterlySummary`

The install script converts the Eastern target times into the machine's local Windows timezone before registration, then the runners still apply Eastern-date gating where needed.

## OpenAI Provider Placeholder

The grading pipeline uses `COACH_GRADER_PROVIDER`, and the DB summary runner enables LLM summaries with `--llm` or `COACH_SUMMARY_PROVIDER=openrouter`.

Daily, weekly, and monthly summary runners require `DATABASE_URL`, imported scorecards, and mapped rep users.

If you want deterministic local-only grading:

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
- Scorecards can continue to land in local JSONL while the DB summary path powers UI and Slack delivery.
- Daily reports become dashboard views plus Slack/Close delivery jobs.
- The manager UI reads rep aggregates and call-level scorecards.
