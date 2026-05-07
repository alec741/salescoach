# Sales-Only Filtering

The coaching workflow should review sales/prospect calls, not Customer Success, applicant support, or client-service calls.

## Default Rule

The default is intentionally permissive:

- Include calls unless the linked Close lead is clearly marked as a client or non-contactable.
- Do not require `Customer type = Contractor`.
- Do not require a Sales opportunity to already exist, because an opportunity may be created after the call.
- Require the call owner to match the configured sales-rep allowlist.

## Sales Rep Allowlist

The default allowlist is stored in `config/sales-filter.json` under `includeRepNameMatches`.

Current sales reps:

- Bryton
- Josh
- Jen
- Janay
- Tanner
- Jonathan
- Shea
- Colton
- Greg
- Chris
- Alec

Known customer-success/client-success reps are excluded with `excludeRepNameMatches`.

## Client Exclusion

The current config excludes:

- Lead status: `Client`
- Lead status: `DO NOT CONTACT`
- Custom field `Customer type = Client`
- Custom field `Lead type = Client`
- Custom field `Customer Data = Client`
- Custom field `Customer data = Client`

If Close uses a different custom field to mark clients, add it to both:

- `excludeCustomFieldValues`
- `trackedCustomFields`

## Sales Evidence

When present, these fields are retained as evidence in the generated review packet, but they are not required by default:

- Sales pipeline opportunity.
- Customer type.
- Lead source tier.
- Sales opportunity flag.
- Lead owner.

## Audit The Filter

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --list --explain-filter
```

Filter by rep:

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --rep Josh --list --explain-filter
```

## Override

Use this only for debugging, not coaching:

```powershell
npm run coach:interactive -- -- --date 2026-05-06 --include-non-sales --list
```

## Strict Mode

If you want to audit only records that already have strong sales metadata, set these in `config/sales-filter.json`:

```json
"strictRequireSalesPipeline": true,
"strictRequireCustomerType": true
```

Do not use strict mode as the default unless Close data entry is consistent before or during calls.
