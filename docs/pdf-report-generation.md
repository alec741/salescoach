# PDF Report Generation

The coaching workflow can generate local PDFs from the Markdown summaries and JSONL call scorecards.

The default daily delivery model is intentionally narrow:

- Each rep gets one private daily coaching summary PDF.
- The sales manager gets one team summary PDF with rep-level coaching priorities.
- Individual call reviews are not part of daily PDFs by default. They belong in Slack messages or the frontend on-demand call review UI.

## Setup

Install the Python PDF dependencies once:

```powershell
python -m pip install -r requirements.txt
```

## Generate PDFs

Generate PDFs for the latest report date. The command defaults to `codex-over-10min` when that variant exists, otherwise `codex`.

```powershell
npm run reports:pdf
```

Generate a specific report set:

```powershell
npm run reports:pdf -- --date 2026-05-06 --variant codex-over-10min
```

Generate the full-day Codex report set:

```powershell
npm run reports:pdf -- --date 2026-05-06 --variant codex
```

## Outputs

PDFs are written under:

```text
output/pdf/daily/<date>/<variant>/
```

The generator creates by default:

- `manager-summary.pdf`: manager-ready daily coaching report.
- `rep-summaries/*.pdf`: one PDF per rep summary.
- `manifest.json`: generated file list and page counts.

Optional QA/archive artifacts:

```powershell
python scripts/reports/generate_pdfs.py --date 2026-05-06 --variant codex-over-10min --include-call-scorecards --include-combined
```

- `call-scorecards.pdf`: all scored calls grouped by rep.
- `daily-coaching-packet.pdf`: combined manager summary, rep summaries, and optional call scorecards.

## Design Pattern

The PDFs are generated from structured scorecards first, not by dumping Markdown tables into pages. The current layout uses:

- A dark executive header with date, variant, and filtering context.
- KPI cards for call count, rep count, team average, and compliance flags.
- A single highest-leverage coaching callout before detail sections.
- Score bars instead of dense numeric-only tables.
- Rep priority cards for manager one-on-ones.
- Rep brief PDFs focused on one improvement behavior, score profile, next-call plan, and compliance watch.
- Call scorecards, when explicitly generated, are labeled with prospect/company names from the local Close lead cache instead of raw Close call IDs.

Generated PDFs are ignored by git because they can contain CRM-derived coaching data.

## Notes

- The PDF generator does not re-grade calls. It only formats existing LLM/Codex scorecards and summaries.
- The PDF generator applies the sales-rep allowlist from `config/sales-filter.json` so customer-success/client-success calls are excluded from manager, rep, and scorecard PDFs.
- Visible call labels use the local Close lead cache when available, preferring company/lead names over raw Close call IDs.
- If `pdftoppm` is installed locally, use it to visually render and inspect pages for final layout QA.
- The current fallback validation uses `pypdf` page counts when Poppler is not installed.
