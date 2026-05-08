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
- Lead enrichment is included by default and cached by lead id so each exported call can carry normalized opportunity context.
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
- `--exclude-lead-enrichment` skips lead and opportunity enrichment if you only need raw call activity.
- `--include-recording-url` includes recording and voicemail URLs. Leave this off unless needed.
- `--exclude-notes` omits call notes.

## Export Shape

Each call row now includes `close_context` unless you opt out. It is designed to be safe for generic JSON storage in downstream scorecard imports:

```json
{
  "close_context": {
    "lead": {
      "id": "lead_xxx",
      "name": "Example Lead",
      "status_id": "stat_xxx",
      "status_label": "Open"
    },
    "custom": {
      "Customer type": "Contractor",
      "Lead Source Tier": "A"
    },
    "opportunities": [
      {
        "id": "oppo_xxx",
        "pipeline_name": "Sales",
        "status_label": "Won",
        "status_type": "won",
        "value": 50000,
        "value_period": "one_time",
        "value_currency": "USD",
        "close_signal": "won",
        "close_date": "2026-05-06"
      }
    ],
    "opportunity_summary": {
      "total_opportunities": 1,
      "has_active_opportunity": false,
      "has_won_opportunity": true,
      "has_lost_opportunity": false,
      "primary_opportunity": {
        "id": "oppo_xxx",
        "pipeline_name": "Sales",
        "status_label": "Won",
        "status_type": "won",
        "value": 50000,
        "close_signal": "won",
        "close_date": "2026-05-06"
      }
    }
  }
}
```

This shape is shared with the sales-filter lead cache and can be copied into `evidenceSummaryJson` without adding columns.

## Scorecard Import With Close Context

If you want imported DB scorecards to retain opportunity and outcome context in `call_scorecards.evidence_summary_json`, pass the calls export file to the importer:

```powershell
npm run db:import:scorecards -- --file data/coach/codex-review/2026-05-06-over-10min/codex-scorecards.jsonl --calls-file data/close/calls-2026-05.jsonl --date 2026-05-06
```

The importer matches on `call_id` and writes the normalized `close_context` object into the generic JSON evidence payload. No schema or migration changes are required.

## Windows Argument Forwarding Note

In this environment, npm requires an extra `--` before script arguments. If your terminal behaves differently, use the direct `node` command above.

## Close API Notes

Close uses Basic auth with the API key as the username and an empty password. Call transcripts are available through the call activity API via `_fields` but are not loaded by default, so the export requests `recording_transcript` and `voicemail_transcript` explicitly. Lead fetches request only the fields needed for call enrichment: lead status, selected custom fields, and embedded opportunities.

## Dataset Boundary

This exporter only pulls raw CRM call activity into an ignored local file. It does not add call recordings, transcripts, or customer data to tracked repo files. Any future training dataset should summarize and redact CRM data before it is committed.
