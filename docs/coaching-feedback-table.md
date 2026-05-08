# `coaching_feedback` table

The feedback loop UI and server actions now expect a new table named `public.coaching_feedback`.

This repo change intentionally does not modify `src/db/schema.ts` or add a migration. Until this table exists, scorecard and summary feedback controls render but saving returns a clear message.

Suggested schema:

```sql
create table public.coaching_feedback (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('scorecard', 'summary')),
  entity_id uuid not null,
  rep_user_id uuid references public.app_users(id) on delete cascade,
  actor_key text not null,
  actor_user_id uuid references public.app_users(id) on delete set null,
  actor_name text not null,
  actor_role text not null check (actor_role in ('rep', 'manager', 'admin')),
  usefulness_rating integer not null check (usefulness_rating between 1 and 5),
  feedback_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, actor_key)
);

create index coaching_feedback_entity_idx
  on public.coaching_feedback (entity_type, entity_id, created_at desc);

create index coaching_feedback_rep_idx
  on public.coaching_feedback (rep_user_id, created_at desc);
```

Expected behavior:

- One feedback record per actor per entity, updated in place via `actor_key`.
- `entity_type = 'scorecard'` stores manager/rep feedback on `call_scorecards.id`.
- `entity_type = 'summary'` stores manager/rep feedback on `coaching_summaries.id`.
- `usefulness_rating` is the 1-5 score shown in the UI.
- `feedback_text` stores the freeform note shown in the UI history.
