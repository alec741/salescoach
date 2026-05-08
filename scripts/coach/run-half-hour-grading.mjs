import { loadLocalEnv, runNodeScript } from "./scheduler-shared.mjs";

function main() {
  loadLocalEnv();
  const forwarded = process.argv.slice(2);
  const hasCustomWindow = forwarded.includes("--lookback-minutes") || forwarded.includes("--since");

  if (!hasCustomWindow) {
    forwarded.unshift("40");
    forwarded.unshift("--lookback-minutes");
  }

  runNodeScript("scripts/coach/run-hourly.mjs", forwarded);
}

main();
