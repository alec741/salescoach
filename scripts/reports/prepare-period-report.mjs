import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PERIODS = new Set(["weekly", "monthly", "quarterly"]);

function parseArgs(argv) {
  const args = {
    period: "weekly",
    start: null,
    end: null,
    variant: "codex-over-10min",
    outDir: null,
    includePrevious: true
  };

  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--period":
        args.period = next;
        index += 1;
        break;
      case "--start":
        args.start = next;
        index += 1;
        break;
      case "--end":
        args.end = next;
        index += 1;
        break;
      case "--variant":
        args.variant = next;
        index += 1;
        break;
      case "--out-dir":
        args.outDir = path.resolve(ROOT, next);
        index += 1;
        break;
      case "--no-previous":
        args.includePrevious = false;
        break;
      default:
        positionals.push(arg);
    }
  }

  if (positionals.length) args.period = positionals[0];
  if (positionals.length > 1) args.start = positionals[1];
  if (positionals.length > 2) args.end = positionals[2];
  if (positionals.length > 3) args.variant = positionals[3];
  if (positionals.length > 4) args.outDir = path.resolve(ROOT, positionals[4]);

  if (!PERIODS.has(args.period)) throw new Error(`--period must be one of: ${[...PERIODS].join(", ")}`);
  if (!args.start || !args.end) throw new Error("Use --start YYYY-MM-DD and --end YYYY-MM-DD.");
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function dateRange(start, end) {
  const dates = [];
  const current = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function addDays(date, days) {
  const current = new Date(`${date}T12:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

function sourceKindFor(period) {
  if (period === "weekly") return { folder: "daily", unit: "day" };
  if (period === "monthly") return { folder: "weekly", unit: "week" };
  return { folder: "monthly", unit: "month" };
}

function sourceDirsFor(args) {
  const source = sourceKindFor(args.period);
  if (args.period === "weekly") {
    return dateRange(args.start, args.end).map((date) => ({ label: date, dir: path.join(ROOT, "reports", "daily", date, args.variant) }));
  }

  const root = path.join(ROOT, "reports", source.folder);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ label: entry.name, dir: path.join(root, entry.name, args.variant) }))
    .filter((entry) => entry.label >= args.start && entry.label <= args.end);
}

function collectReportDir(entry) {
  if (!fs.existsSync(entry.dir)) return { ...entry, exists: false };
  const managerSummary = readText(path.join(entry.dir, "manager-summary.md"));
  const aggregates = readJson(path.join(entry.dir, "daily-aggregates.json")) || readJson(path.join(entry.dir, "aggregates.json"));
  const repSummaries = fs.readdirSync(entry.dir)
    .filter((file) => file.endsWith(".md") && file !== "manager-summary.md")
    .sort()
    .map((file) => ({ file, text: readText(path.join(entry.dir, file)) }))
    .filter((item) => item.text);

  return {
    ...entry,
    exists: true,
    managerSummary,
    aggregates,
    repSummaries
  };
}

function previousWindow(args) {
  const days = dateRange(args.start, args.end).length;
  return {
    start: addDays(args.start, -days),
    end: addDays(args.start, -1)
  };
}

function buildPacket(args, currentSources, previousSources) {
  const promptTemplate = readText(path.join(ROOT, "prompts", "reporting", "period-summary.md")) || "";
  const lines = [
    `# ${args.period.toUpperCase()} Coaching Source Packet`,
    "",
    `Period: ${args.start} to ${args.end}`,
    `Variant: ${args.variant}`,
    "",
    "## Instructions",
    "",
    promptTemplate.trim(),
    "",
    "## Current Period Sources",
    ""
  ];

  for (const source of currentSources) {
    lines.push(`### Source ${source.label}`);
    lines.push("");
    if (!source.exists) {
      lines.push("Missing source directory.");
      lines.push("");
      continue;
    }
    if (source.aggregates) {
      lines.push("#### Aggregates");
      lines.push("```json");
      lines.push(JSON.stringify(source.aggregates, null, 2));
      lines.push("```");
      lines.push("");
    }
    if (source.managerSummary) {
      lines.push("#### Manager Summary");
      lines.push(source.managerSummary.trim());
      lines.push("");
    }
    for (const rep of source.repSummaries) {
      lines.push(`#### Rep Summary: ${rep.file}`);
      lines.push(rep.text.trim());
      lines.push("");
    }
  }

  if (previousSources.length) {
    lines.push("## Previous Period Sources For Trend Comparison");
    lines.push("");
    for (const source of previousSources) {
      lines.push(`### Previous Source ${source.label}`);
      lines.push("");
      if (!source.exists) {
        lines.push("Missing source directory.");
        lines.push("");
        continue;
      }
      if (source.aggregates) {
        lines.push("```json");
        lines.push(JSON.stringify(source.aggregates, null, 2));
        lines.push("```");
      }
      if (source.managerSummary) lines.push(source.managerSummary.trim());
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildCodexPrompt(args) {
  const target = `reports/${args.period}/${args.start}_to_${args.end}/${args.variant}`;
  return `Use the source packet in ${target}/source-packet.md to create AI-generated ${args.period} coaching reports.\n\nWrite these files:\n- ${target}/manager-summary.md\n- one rep summary markdown file per rep in ${target}/rep-summaries/<rep-slug>.md\n- ${target}/aggregates.json with period metrics and trend fields\n\nRules:\n- Do not re-score individual calls from transcripts. Aggregate the lower-cadence coaching summaries.\n- Identify the one highest-leverage focus for each rep for the next period.\n- Compare against previous period data when present.\n- Highlight recurring compliance issues and areas moving backward.\n- Keep rep reports private to the rep; manager report can include all rep summaries.\n- Do not include raw call IDs in user-facing text.\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.outDir || path.join(ROOT, "reports", args.period, `${args.start}_to_${args.end}`, args.variant);
  ensureDir(outDir);
  ensureDir(path.join(outDir, "rep-summaries"));

  const currentSources = sourceDirsFor(args).map(collectReportDir);
  const previous = args.includePrevious ? previousWindow(args) : null;
  const previousArgs = previous ? { ...args, start: previous.start, end: previous.end } : null;
  const previousSources = previousArgs ? sourceDirsFor(previousArgs).map(collectReportDir).filter((source) => source.exists) : [];

  const packet = buildPacket(args, currentSources, previousSources);
  fs.writeFileSync(path.join(outDir, "source-packet.md"), packet, "utf8");
  fs.writeFileSync(path.join(outDir, "codex-prompt.md"), buildCodexPrompt(args), "utf8");
  writeJson(path.join(outDir, "source-index.json"), {
    period: args.period,
    start: args.start,
    end: args.end,
    variant: args.variant,
    source_kind: sourceKindFor(args.period),
    current_sources: currentSources.map((source) => ({ label: source.label, dir: path.relative(ROOT, source.dir), exists: source.exists, rep_summaries: source.repSummaries?.length || 0 })),
    previous_window: previous,
    previous_sources: previousSources.map((source) => ({ label: source.label, dir: path.relative(ROOT, source.dir), exists: source.exists }))
  });

  console.log(JSON.stringify({
    ok: true,
    period: args.period,
    out_dir: path.relative(ROOT, outDir),
    source_packet: path.relative(ROOT, path.join(outDir, "source-packet.md")),
    codex_prompt: path.relative(ROOT, path.join(outDir, "codex-prompt.md")),
    sources_found: currentSources.filter((source) => source.exists).length,
    sources_missing: currentSources.filter((source) => !source.exists).length,
    previous_sources_found: previousSources.length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
