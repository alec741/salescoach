import { NextRequest, NextResponse } from "next/server";
import { deliverSummaryToSlack } from "../../../scripts/slack-deliver-summary";
import { generateSummaries } from "../../../scripts/db/generate-summaries";
import { isSlackConfigured } from "../slack";
import { parseCronBoolean, validateCronSecret } from "./auth";

type SupportedPeriod = "daily" | "weekly" | "monthly" | "quarterly";

type SummaryCronOptions = {
  period: SupportedPeriod;
  jobType: string;
  shouldRun: (date: string) => boolean | Promise<boolean>;
  skipReason: string;
};

function slackDeliveryAvailable() {
  return isSlackConfigured() && Boolean(process.env.SLACK_MANAGER_CHANNEL_ID);
}

async function loadSchedulerShared() {
  const specifier = "../../../scripts/coach/scheduler-shared.mjs";
  return (await import(specifier)) as {
    currentCoachDate: (now?: Date) => string;
    isFridayDate: (value: string) => boolean;
    isLastBusinessDayOfMonth: (value: string) => boolean;
    isLastBusinessDayOfQuarter: (value: string) => boolean;
    isWeekdayDate: (value: string) => boolean;
  };
}

async function loadJobLock() {
  const specifier = "../../../scripts/coach/job-lock.mjs";
  return (await import(specifier)) as {
    finishPipelineJob: (
      jobId: string | null,
      input?: {
        errorMessage?: string | null;
        result?: Record<string, unknown>;
        status?: "failed" | "skipped" | "succeeded";
      }
    ) => Promise<void>;
    startPipelineJob: (input: {
      force?: boolean;
      idempotencyKey: string;
      jobType: string;
      payload?: Record<string, unknown>;
      source?: string;
    }) => Promise<{
      acquired: boolean;
      jobId: string | null;
      reason: string | null;
      skipped: boolean;
    }>;
  };
}

export async function handleSummaryCron(request: NextRequest, options: SummaryCronOptions) {
  const authError = validateCronSecret(request);
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const scheduler = await loadSchedulerShared();
  const { finishPipelineJob, startPipelineJob } = await loadJobLock();
  const date = params.get("date") || scheduler.currentCoachDate();
  const force = parseCronBoolean(params.get("force"));
  const llm = parseCronBoolean(params.get("llm"), true);
  const skipSlack = parseCronBoolean(params.get("skipSlack"));

  if (!force && !(await options.shouldRun(date))) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: options.skipReason,
      date,
      period: options.period
    });
  }

  const job = await startPipelineJob({
    jobType: options.jobType,
    idempotencyKey: `${options.jobType}:${date}:llm=${llm}:skipSlack=${skipSlack}`,
    force,
    payload: {
      date,
      llm,
      period: options.period,
      skipSlack
    },
    source: "vercel_cron"
  });

  if (!job.acquired) {
    return NextResponse.json(
      {
        ok: true,
        skipped: true,
        reason: job.reason,
        jobId: job.jobId,
        date,
        period: options.period
      },
      { status: 202 }
    );
  }

  try {
    const generation = await generateSummaries({ date, llm, period: options.period });
    let delivery: Record<string, unknown> | null = null;

    if (!skipSlack) {
      if (slackDeliveryAvailable()) {
        delivery = await deliverSummaryToSlack({
          audience: "manager",
          date,
          period: options.period
        });
      } else {
        delivery = {
          ok: true,
          skipped: true,
          reason: "slack_not_configured"
        };
      }
    }

    const result = {
      ok: true,
      date,
      delivery,
      generation,
      period: options.period
    };
    await finishPipelineJob(job.jobId, { result });
    return NextResponse.json({ ...result, jobId: job.jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Summary cron failed.";
    await finishPipelineJob(job.jobId, { status: "failed", errorMessage: message });
    return NextResponse.json({ ok: false, error: message, jobId: job.jobId }, { status: 500 });
  }
}

export const summaryCronHandlers = {
  daily(request: NextRequest) {
    return handleSummaryCron(request, {
      period: "daily",
      jobType: "generate_daily_summary",
      shouldRun: (date) => loadSchedulerShared().then((module) => module.isWeekdayDate(date)),
      skipReason: "not_weekday_anchor"
    });
  },
  weekly(request: NextRequest) {
    return handleSummaryCron(request, {
      period: "weekly",
      jobType: "generate_weekly_summary",
      shouldRun: (date) => loadSchedulerShared().then((module) => module.isFridayDate(date)),
      skipReason: "not_friday_anchor"
    });
  },
  monthly(request: NextRequest) {
    return handleSummaryCron(request, {
      period: "monthly",
      jobType: "generate_monthly_summary",
      shouldRun: (date) => loadSchedulerShared().then((module) => module.isLastBusinessDayOfMonth(date)),
      skipReason: "not_last_business_day_of_month"
    });
  },
  quarterly(request: NextRequest) {
    return handleSummaryCron(request, {
      period: "quarterly",
      jobType: "generate_quarterly_summary",
      shouldRun: (date) => loadSchedulerShared().then((module) => module.isLastBusinessDayOfQuarter(date)),
      skipReason: "not_last_business_day_of_quarter"
    });
  }
};
