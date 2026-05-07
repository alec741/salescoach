# Coaching Report Cadence

The reporting cadence separates call-level coaching from periodic coaching summaries.

## Daily

Daily delivery creates two report types:

- Rep report: one private PDF per rep at the end of the day.
- Manager report: one team PDF with rep-by-rep coaching priorities.

Daily reports should not include every individual call scorecard. Individual calls belong in:

- Slack message feedback when a specific call is reviewed.
- Frontend UI on demand when a rep or manager pulls a specific call.

## Weekly

Weekly reports aggregate daily summaries.

Rep weekly report:

- Weekly coaching score.
- Progress versus previous week when available.
- Recurring compliance issues.
- Areas moving backward.
- One focus for the next week.

Manager weekly report:

- Overall team performance.
- Team movement versus previous week.
- Rep-by-rep summaries.
- Recurring team compliance risks.
- Manager coaching priorities for the next week.

Prepare a weekly AI source packet:

```powershell
npm run reports:period:prepare -- --period weekly --start 2026-05-04 --end 2026-05-08 --variant codex-over-10min
```

Then run Codex/LLM against:

```text
reports/weekly/2026-05-04_to_2026-05-08/codex-over-10min/codex-prompt.md
```

After Codex writes `manager-summary.md` and `rep-summaries/*.md`, generate PDFs with:

```powershell
npm run reports:pdf -- --report-dir reports/weekly/2026-05-04_to_2026-05-08/codex-over-10min --out-dir output/pdf/weekly/2026-05-04_to_2026-05-08/codex-over-10min
```

## Monthly

Monthly reports aggregate weekly reports.

Use the same pattern:

```powershell
npm run reports:period:prepare -- --period monthly --start 2026-05-01 --end 2026-05-31 --variant codex-over-10min
```

The monthly prompt should use weekly manager and rep summaries as the source material.

## Quarterly

Quarterly reports aggregate monthly reports.

```powershell
npm run reports:period:prepare -- --period quarterly --start 2026-04-01 --end 2026-06-30 --variant codex-over-10min
```

The quarterly prompt should use monthly manager and rep summaries as the source material.

## AI Boundary

The code prepares source packets and output paths. The coaching interpretation for weekly, monthly, and quarterly reports should be produced by Codex/LLM, not deterministic heuristics.

This preserves the core coaching principle: aggregate the coaching judgment, trend movement, compliance watchouts, and next-period focus from AI-written lower-cadence summaries.
