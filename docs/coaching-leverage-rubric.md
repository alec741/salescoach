# Coaching Leverage Rubric

The coaching system separates two different jobs:

- `Primary coaching focus`: the highest-leverage selling behavior to improve next.
- `Compliance watch`: risk language that must be corrected, but should not automatically become the coaching theme.

## Why This Exists

The first version could over-select compliance as the daily coaching focus because repeated compliance flags were easy to count. That creates the wrong coaching behavior. In Decoded coaching, the best lever is usually upstream: better qualification, discovery, or quantification prevents downstream feature dumping and reduces compliance risk.

Example:

- Qualification: `5.1/10`
- Quantification: `5.1/10`
- Compliance: `6.8/10`

The correct focus is qualification and quantification, not compliance. Compliance stays visible as a watchout.

## Focus Selection Rules

1. Compliance becomes the primary focus only when it is severe.
2. Severe means compliance score is `5.5/10` or lower, or compliance is `6.0/10` or lower with repeated flags across the call set.
3. Otherwise, select from the selling sequence using weighted score gap from an `8.0/10` target.
4. Upstream behaviors receive more weight because they create more downstream improvement.
5. If feature dumping or compliance risk is caused by weak diagnosis, coach the upstream diagnosis behavior.

## Weighted Selling Sequence

| Dimension | Weight | Coaching Meaning |
| --- | ---: | --- |
| Qualification | 1.25 | Confirm ICP, Contractor A/B branch, timing, buyer fit, and poor-fit risk. |
| Quantification | 1.25 | Size the lost revenue, dealer-fee burden, lost jobs, job size, and ROI. |
| Discovery | 1.15 | Understand current state, desired state, pain, and status-quo consequence. |
| Solution-to-pain | 1.10 | Map only the relevant Enhancify pieces to diagnosed pain. |
| Close / next step | 1.00 | Ask for the decision or control the next step. |
| Feature-dump control | 0.85 | Keep the prospect as the subject; use confirmation loops. |
| Opening | 0.80 | Create trust and call control early. |

## Compliance Handling

Compliance is always shown in the report as a watchout. It only overrides selling behavior when risk is material.

Watchout examples:

- Marketplace, not lender.
- Soft-pull pre-approval is not final lender approval.
- Final approval may require a hard inquiry.
- Funds go to the applicant/customer.
- No guaranteed approval, amount, rate, term, or funding timeline.
- 0% options are introductory credit-card marketplace options, not 0% loans.

## Implementation Points

- Call grading prompt: `prompts/grading/call-scorecard.md`
- Local daily summaries: `scripts/coach/run-daily-summary.mjs`
- PDF summaries from JSONL scorecards: `scripts/reports/generate_pdfs.py`
- Database-backed summaries: `scripts/db/generate-summaries.ts`
