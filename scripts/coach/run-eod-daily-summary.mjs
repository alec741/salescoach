import {
  currentCoachDate,
  isWeekdayDate,
  loadLocalEnv,
  runNodeScript,
  runPythonScript,
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
      case "--llm":
        args.llm = true;
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

function buildManagerPdf(date) {
  const scorecardsPath = `data/coach/scorecards/openrouter/${date}.jsonl`;
  runPythonScript("scripts/reports/generate_pdfs.py", ["--date", date, "--variant", "openrouter", "--scorecards", scorecardsPath]);
  runTsxScript("scripts/db/import-report-artifacts.ts", ["--manifest", `output/pdf/daily/${date}/openrouter/manifest.json`]);
  return `output/pdf/daily/${date}/openrouter/manager-summary.pdf`;
}

function deliverManagerPdf(date, pdfPath) {
  runNodeScript("scripts/slack-upload-file.mjs", [
    "--file",
    pdfPath,
    "--filename",
    `manager-coaching-summary-${date}.pdf`,
    "--title",
    `Manager Coaching Summary - ${date}`,
    "--initial-comment",
    `Daily manager coaching PDF for ${date}.`
  ]);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const date = args.date || currentCoachDate();

  if (!args.force && !isWeekdayDate(date)) {
    console.log(`Skipped: ${date} is not a weekday in ${process.env.COACH_TIMEZONE || "America/New_York"}.`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for end-of-day daily summary generation.");
  }

  const job = await startPipelineJob({
    jobType: "summary_daily",
    idempotencyKey: `summary:daily:${date}`,
    force: args.force,
    payload: { date, llm: args.llm, slack: !args.skipSlack }
  });
  if (!job.acquired) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: job.reason, job_id: job.jobId }, null, 2));
    return;
  }

  try {
    const summaryArgs = ["--date", date, "--period", "daily"];
    if (args.llm) summaryArgs.push("--llm");
    runTsxScript("scripts/db/generate-summaries.ts", summaryArgs);

    let slackDelivery = "skipped";
    let pdfDelivery = "skipped";
    if (!args.skipSlack) {
      if (slackConfigured()) {
        runTsxScript("scripts/slack-deliver-summary.ts", ["--date", date, "--period", "daily"]);
        slackDelivery = "sent";
        try {
          const pdfPath = buildManagerPdf(date);
          deliverManagerPdf(date, pdfPath);
          pdfDelivery = "sent";
        } catch (error) {
          pdfDelivery = "failed";
          console.warn(`Skipped manager PDF Slack upload: ${error.message}`);
        }
      } else {
        slackDelivery = "not_configured";
        pdfDelivery = "not_configured";
        console.log("Skipped Slack delivery: SLACK_MANAGER_CHANNEL_ID and a Slack token are required.");
      }
    }

    await finishPipelineJob(job.jobId, { result: { date, period: "daily", llm: args.llm, slack_delivery: slackDelivery, pdf_delivery: pdfDelivery } });
  } catch (error) {
    await finishPipelineJob(job.jobId, { status: "failed", errorMessage: error.message });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
