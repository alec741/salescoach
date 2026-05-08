# Production Readiness Gate

Status: testing-ready locally with mock data; not production-ready.

## Current Cohesion Fixes

- Scoring, summaries, and frontend views now distinguish lowest score from highest-leverage coaching focus.
- `primaryFocusDimension` drives dashboard focus, call review filters, 1:1 prep, and summary targets.
- `weakestScoreDimension` remains available as evidence, not the default coaching directive.
- Generated PDF manifests can be imported into `report_artifacts` with `npm run db:import:reports`.
- `npm run lint` now uses ESLint directly instead of the removed `next lint` command.
- DB-backed UI mutations now exist for call reviews, user mapping, manager 1:1 prep, focus assignment, and report events.
- PDF open/download is served through `/api/reports/pdf` with path validation.
- Dimension trend visuals use `coaching_summaries.dimension_averages_json` instead of synthetic curves when DB summaries exist.

## Testing-Ready Requirements

- `DATABASE_URL` points to a Neon dev database.
- `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` are set for auth testing.
- Run `npm run db:migrate`.
- Seed sales users with `npm run db:seed:sales-reps -- --manager-email manager@enhancify.example`.
- Import scorecards with `npm run db:import:scorecards`.
- Generate summaries with `npm run db:summarize -- --date YYYY-MM-DD --period all`.
- Import report PDFs with `npm run db:import:reports`.
- Verify role mappings in `app_users` and `manager_rep_assignments`.
- Run `npm run lint`, `npm run typecheck`, and `npm run build`.
- Smoke test `/manager`, `/rep`, `/rep/calls`, `/rep/summaries`, `/manager/reports`, and `/settings/users`.

## Production Blockers

- Production auth is not configured or verified.
- Production database, backups, restore process, and environment separation are not verified.
- OpenAI automation is scaffolded but not activated with `OPENAI_API_KEY` and model configuration.
- Slack delivery now supports manager-summary sends through `npm run slack:summary:deliver`, but production still needs a bot token with `chat:write`, a manager channel ID, and verification against real DB-backed summary artifacts.
- No production deployment target, domain, HTTPS policy, rollback plan, or monitoring has been verified.
- Dependency audit is currently clean with package overrides for vulnerable transitive `postcss` and `esbuild` versions.

## Fastest Path To Green

1. Create separate Neon dev and production databases, then run migrations against dev first.
2. Wire Neon Auth and verify route protection for manager, rep, and admin views.
3. Validate the DB-backed UI actions against a real Neon dev database.
4. Configure `SLACK_BOT_TOKEN` and `SLACK_MANAGER_CHANNEL_ID`, run `npm run slack:check`, then verify both `npm run slack:test` and `npm run slack:summary:deliver -- --period daily --date YYYY-MM-DD --dry-run`.
5. Activate OpenAI grading/summarization behind explicit environment toggles.
6. Add production deployment configuration, rollback steps, and health checks.
7. Keep `npm audit --audit-level=moderate` in the release gate before public access.
