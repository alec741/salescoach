# Interactive Codex Call Coaching

This is the current v1 workflow. It uses Close to pull calls and prepares a Codex-ready review packet grounded in the local Decoded methodology, Enhancify profile, and grading contract.

## Why This Exists

Interactive Codex is not a background service that Windows Task Scheduler can call directly. For now, the best local workflow is:

1. Pull/select a call from Close.
2. Generate a grounded review packet.
3. Ask Codex to review that packet using the repo knowledge base.
4. Save the resulting coaching feedback locally if needed.

This avoids heuristic grading while still using Codex as the actual coach.

## List Candidate Calls

List substantive connected calls for an Eastern date. The default threshold is completed calls over 2 minutes with a transcript.

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --list
```

Filter by rep name:

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --rep Josh --list
```

## Prepare The Longest Call For Review

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --longest
```

Prepare the longest call for a specific rep:

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --rep Josh --longest
```

Prepare a specific call:

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --call-id acti_example
```

## Output

The command writes ignored local files under:

- `data/coach/interactive/*.md`
- `data/coach/interactive/*.json`

Open the generated `.md` packet or ask Codex to review it. The packet includes:

- Call metadata.
- Close transcript summary.
- Decoded methodology.
- Enhancify profile.
- Grading contract.
- Transcript.

## Deferred Automation

Hourly unattended grading is deferred until we use an API-based model provider or another callable grading service. The scripts still exist as scaffolding, but they should not be treated as the current workflow.
