import { spawnSync } from "node:child_process";
import { formatDateInTimeZone, loadLocalEnv } from "./shared.mjs";

const PERIODS = new Set(["daily", "weekly", "monthly", "quarterly"]);

function parseArgs(argv) {
  const args = {
    period: "daily",
    date: formatDateInTimeZone(new Date()),
    llm: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--period":
        args.period = next;
        index += 1;
        break;
      case "--date":
        args.date = next;
        index += 1;
        break;
      case "--no-llm":
        args.llm = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!PERIODS.has(args.period)) throw new Error(`--period must be one of: ${[...PERIODS].join(", ")}`);
  return args;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) throw new Error(`Command failed with exit ${result.status}: ${command} ${args.join(" ")}`);
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to generate persisted coaching summaries.");

  const summaryArgs = ["--import", "tsx", "scripts/db/generate-summaries.ts", "--date", args.date, "--period", args.period];
  if (args.llm) summaryArgs.push("--llm");
  run(process.execPath, summaryArgs);

  console.log(JSON.stringify({
    ok: true,
    period: args.period,
    date: args.date,
    llm_summaries: args.llm
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
