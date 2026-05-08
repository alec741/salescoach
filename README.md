# Decoded Coach

Decoded Coach separates the reusable Decoded methodology from company-specific context such as ICP, offers, proof points, competitors, qualification rules, and sales motion.

The active company profile is now `enhancify`, configured for a warm inbound, phone-first, one-call-close sales motion.

## Structure

- `config/methodology.decoded.json`: reusable Decoded methodology and solutioning principles.
- `config/default.json`: active runtime profile and prompt template selection.
- `config/companies/*.json`: swappable company profiles.
- `schemas/company-profile.schema.json`: documented shape for company profiles.
- `prompts/coach-system.md`: default system prompt template.
- `prompts/live-call-coach.md`: time-boxed live phone-call coaching prompt.
- `scripts/profile-tool.mjs`: validates profiles and renders prompts.
- `docs/enhancify-adaptation.md`: notes for the Enhancify sales motion.

## Commands

```bash
npm run profiles:list
npm run profiles:validate
npm run prompt:render -- enhancify
npm run prompt:render -- enhancify live_call
npm run reports:pdf -- --date 2026-05-06 --variant codex-over-10min
```

## Add A New Company

1. Copy `config/companies/template.json` to `config/companies/<company-id>.json`.
2. Replace all placeholder ICP, offer, proof, objections, and qualification fields.
3. Set `activeCompanyId` in `config/default.json` to the new company id.
4. Run `npm run profiles:validate`.
5. Run `npm run prompt:render -- <company-id>` to inspect the assembled coach prompt.

## Design Principle

Sales Collective-specific context should live only in `config/companies/sales-collective.json`. Enhancify-specific context should live only in `config/companies/enhancify.json`. The methodology, prompts, and tooling should reference a generic company profile interface instead of any one company's ICP, products, or services.

## Close CRM Call Exports

Close call activity exports are supported through `npm run close:calls:export`. The export now includes a normalized `close_context` block with lead opportunity pipeline, status, value, and won or lost signals unless you pass `--exclude-lead-enrichment`. See `docs/close-crm-ingestion.md`. Exported CRM data is written under `data/close` and ignored by git.

## Local Environment

Persistent local secrets are loaded from `.env`, which is ignored by git. See `docs/local-env.md`.

## Interactive Codex Call Coaching

Use `npm run coach:interactive` to list Close calls and generate a Codex-ready review packet. See `docs/interactive-codex-coaching.md`.

## PDF Coaching Reports

Use `npm run reports:pdf` to generate manager, rep, scorecard, and combined coaching PDFs from local report outputs. See `docs/pdf-report-generation.md`.

## Scheduled Coaching Automation

Use `npm run coach:grading:30m` for the 30-minute weekday grading pass, `npm run coach:eod` for the end-of-day daily summary run, and `npm run coach:summary:weekly` or `npm run coach:summary:monthly` for DB-backed summary refreshes plus optional Slack delivery for manager or rep audiences. See `docs/automated-coaching-pipeline.md`.

For Vercel production deployment, protected cron endpoints now exist at `/api/cron/grading`, `/api/cron/summaries/daily`, `/api/cron/summaries/weekly`, `/api/cron/summaries/monthly`, and `/api/cron/summaries/quarterly`. Set `CRON_SECRET` in the Vercel project so Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically, or provide the same value yourself with `Authorization` or `x-cron-secret` when manually testing the routes.

## Coaching Report Cadence

Daily reports generate one private rep PDF per rep and one manager team PDF. Weekly, monthly, and quarterly reports are prepared from lower-cadence summaries using `npm run reports:period:prepare`. See `docs/report-cadence.md`.

## Web Coaching Control Center

The repo now includes a Next.js control center for rep and manager coaching dashboards backed by Neon Postgres and Neon Auth.

```bash
npm run dev -- -p 3000
npm run build
```

Database setup, import commands, routes, and the v1 data boundary are documented in `docs/web-control-center.md`.
