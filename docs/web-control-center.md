# Web Coaching Control Center

The Next.js control center adds Neon-backed dashboards on top of the existing Close ingestion and scorecard pipeline.

## Local Development

```powershell
npm install
npm run dev -- -p 3000
```

Without `DATABASE_URL` and Neon Auth env vars, the app renders from the existing local sample coaching outputs. This keeps UI review possible before a Neon project is connected.

## Neon Setup

Set these environment variables:

```dotenv
DATABASE_URL=postgresql://...
NEON_AUTH_BASE_URL=https://...
NEON_AUTH_COOKIE_SECRET=at-least-32-characters
```

Then run:

```powershell
npm run db:migrate
npm run db:seed:sales-reps -- --manager-email manager@enhancify.example
npm run db:import:scorecards -- --file data/coach/codex-review/2026-05-06-over-10min/codex-scorecards.jsonl --calls-file data/close/calls-2026-05.jsonl --date 2026-05-06
npm run db:summarize -- --date 2026-05-06 --period all
npm run db:import:reports -- --manifest output/pdf/daily/2026-05-06/codex-leverage-fix/manifest.json
```

`--calls-file` is optional but recommended when you want the imported scorecards to retain Close opportunity status, pipeline, value, and won or lost signals inside `evidenceSummaryJson`.

OAuth identity comes from Neon Auth. App authorization is stored in `app_users` and `manager_rep_assignments`.

## Coaching Focus Model

The web app separates two concepts that were previously overloaded:

- `weakestScoreDimension`: the lowest numerical score on a scorecard or rep average.
- `primaryFocusDimension`: the highest-leverage coaching behavior selected by the Decoded leverage model.

The leverage model prioritizes upstream selling behaviors such as qualification, discovery, quantification, and solution-to-pain unless compliance risk is severe. This keeps manager and rep coaching focused on the behavior most likely to improve future calls instead of automatically coaching the lowest category.

The shared frontend selector lives in `src/lib/coaching-focus.ts`. The backend daily summary generator mirrors the same decision rule.

## Routes

- `/login`: Neon Auth OAuth entry.
- `/rep`: rep coaching dashboard.
- `/rep/calls`: searchable scored calls.
- `/rep/summaries`: daily, weekly, and monthly summaries.
- `/manager`: team rollup dashboard.
- `/manager/reps/[repId]`: individual rep manager view.
- `/manager/reports`: report artifact history.
- `/settings/users`: role and Close-user mapping reference.

## Data Boundary

The UI shows call metadata, scores, compliance flags, summaries, and coaching actions. It does not show full transcripts in v1.

## Persisted Actions

These frontend actions now persist when `DATABASE_URL` is configured:

- `Mark reviewed` writes to `call_reviews`.
- `Mark 1:1 prepared` and `Assign focus` write to `manager_coaching_sessions`; `Assign focus` also creates an open `coaching_action_items` row.
- `Save mapping` updates `app_users` and can create a `manager_rep_assignments` row.
- `Deactivate` sets `app_users.active=false`.
- `Regenerate` and `Send packet` record operational events in `report_artifact_events`.
- If `SLACK_BOT_TOKEN` or `SLACK_ACCESS_TOKEN` and `SLACK_MANAGER_CHANNEL_ID` are configured, `Send packet` also posts the request to Slack.

PDF open/download uses `/api/reports/pdf`. In development it can serve a validated local `output/pdf` path; in production it requires a DB-backed report artifact ID.

## Validation Commands

Run these before treating the local app as test-ready:

```powershell
npm run lint
npm run typecheck
npm run build
npm run profiles:validate
npm run prompt:render -- enhancify
npm run db:generate
npm audit --audit-level=moderate
npm run preflight
```

For route smoke testing after a build:

```powershell
npm run start -- -p 3107
```

Then verify `/manager`, `/rep`, `/rep/calls`, `/rep/summaries`, `/manager/reports`, and `/settings/users`.

For browser-level smoke testing against a running server:

```powershell
npm run test:smoke
```
