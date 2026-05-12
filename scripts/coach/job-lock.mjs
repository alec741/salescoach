import { neon } from "@neondatabase/serverless";

function sqlClient() {
  if (!process.env.DATABASE_URL) return null;
  return neon(process.env.DATABASE_URL);
}

export async function startPipelineJob({ jobType, idempotencyKey, payload = {}, source = "local", force = false }) {
  const sql = sqlClient();
  if (!sql) {
    return { acquired: true, jobId: null, skipped: false, reason: "database_not_configured" };
  }

  if (force) {
    await sql`
      update pipeline_jobs
      set status = 'failed',
          finished_at = now(),
          idempotency_key = idempotency_key || ':superseded:' || id::text,
          error_message = 'Superseded by forced rerun'
      where idempotency_key = ${idempotencyKey}
    `;
  }

  const inserted = await sql`
    insert into pipeline_jobs (
      job_type,
      status,
      source,
      scheduled_for,
      started_at,
      idempotency_key,
      payload_json
    )
    values (
      ${jobType},
      'running',
      ${source},
      now(),
      now(),
      ${idempotencyKey},
      ${JSON.stringify(payload)}::jsonb
    )
    on conflict (idempotency_key) do nothing
    returning id
  `;

  if (inserted[0]?.id) {
    return { acquired: true, jobId: inserted[0].id, skipped: false, reason: null };
  }

  const existing = await sql`
    select id, status, started_at
    from pipeline_jobs
    where idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const row = existing[0];
  return {
    acquired: false,
    jobId: row?.id || null,
    skipped: true,
    reason: row ? `existing_${row.status}` : "existing_job"
  };
}

export async function finishPipelineJob(jobId, { status = "succeeded", result = {}, errorMessage = null } = {}) {
  const sql = sqlClient();
  if (!sql || !jobId) return;

  await sql`
    update pipeline_jobs
    set status = ${status},
        finished_at = now(),
        result_json = ${JSON.stringify(result)}::jsonb,
        error_message = ${errorMessage}
    where id = ${jobId}
  `;
}
