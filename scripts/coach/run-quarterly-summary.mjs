import {
  currentCoachDate,
  isLastBusinessDayOfQuarter,
  loadLocalEnv,
  runTsxScript
} from "./scheduler-shared.mjs";
import { finishPipelineJob, startPipelineJob } from "./job-lock.mjs";

function parseArgs(argv) {
  const args = {
    date: null,
    force: false,
    llm: true,
    skipSlack: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--date":
        args.date = next;
        index += 1;
        break;
      case "--force":
        args.force = true;
        break;
      case "--no-llm":
        args.llm = false;
        break;
      case "--skip-slack":
        args.skipSlack = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function slackConfigured() {
  return Boolean(process.env.SLACK_MANAGER_CHANNEL_ID) && Boolean(process.env.SLACK_BOT_TOKEN || process.env.SLACK_ACCESS_TOKEN);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const date = args.date || currentCoachDate();
  const explicitDate = Boolean(args.date);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for quarterly summary generation.");
  }

  if (!args.force && !explicitDate && !isLastBusinessDayOfQuarter(date)) {
    console.log(`Skipped: ${date} is not the last business day of the quarter.`);
    return;
  }

  const job = await startPipelineJob({
    jobType: "summary_quarterly",
    idempotencyKey: `summary:quarterly:${date}`,
    force: args.force,
    payload: { date, llm: args.llm, slack: !args.skipSlack }
  });
  if (!job.acquired) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: job.reason, job_id: job.jobId }, null, 2));
    return;
  }

  try {
    const summaryArgs = ["--date", date, "--period", "quarterly"];
    if (args.llm) summaryArgs.push("--llm");
    runTsxScript("scripts/db/generate-summaries.ts", summaryArgs);

    let slackDelivery = "skipped";
    if (!args.skipSlack) {
      if (slackConfigured()) {
        runTsxScript("scripts/slack-deliver-summary.ts", ["--date", date, "--period", "quarterly"]);
        slackDelivery = "sent";
      } else {
        slackDelivery = "not_configured";
        console.log("Skipped Slack delivery: SLACK_MANAGER_CHANNEL_ID and a Slack token are required.");
      }
    }

    await finishPipelineJob(job.jobId, { result: { date, period: "quarterly", llm: args.llm, slack_delivery: slackDelivery } });
  } catch (error) {
    await finishPipelineJob(job.jobId, { status: "failed", errorMessage: error.message });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
