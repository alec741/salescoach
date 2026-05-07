# Company Adaptation Guide

Use this process when adapting Decoded Coach from one company to another.

## What Must Stay Generic

- Decoded diagnosis stages.
- Solutioning rules.
- Fit and confidence guardrails.
- Prompt structure.
- Validation tooling.

## What Must Move Into A Company Profile

- ICP and poor-fit criteria.
- Buyer personas.
- Trigger events.
- Products and services.
- Delivery model, timelines, and constraints.
- Case studies, metrics, and proof claims.
- Competitors and alternatives.
- Objections and approved responses.
- Brand or sales voice.

## Migration Checklist

1. Search for the old company name across the repo.
2. Move any old-company ICP, offers, proof, or objections into that company's profile only.
3. Create a new profile from `config/companies/template.json`.
4. Update `config/default.json` to point to the new active company id.
5. Run `npm run profiles:validate`.
6. Render the prompt with `npm run prompt:render -- <company-id>` and verify no old-company assumptions remain.

## Quality Bar For New Profiles

A profile is not ready if it only contains broad market claims. It should include concrete fit criteria, disqualification rules, offer boundaries, proof sources, and discovery questions. The coach can only be as specific as the profile data allows.
