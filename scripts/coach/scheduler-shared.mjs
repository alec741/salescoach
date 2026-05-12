import path from "node:path";
import { execFileSync } from "node:child_process";
import { COACH_TIMEZONE, ROOT, formatDateInTimeZone, loadLocalEnv } from "./shared.mjs";

export { COACH_TIMEZONE, ROOT, formatDateInTimeZone, loadLocalEnv };

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`Expected ISO date YYYY-MM-DD, received: ${value}`);
  }
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function localTsxCliPath() {
  return path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
}

export function currentCoachDate(now = new Date()) {
  return formatDateInTimeZone(now, COACH_TIMEZONE);
}

export function isWeekdayDate(value) {
  const day = parseIsoDate(value).getUTCDay();
  return day >= 1 && day <= 5;
}

export function isFridayDate(value) {
  return parseIsoDate(value).getUTCDay() === 5;
}

export function isLastBusinessDayOfMonth(value) {
  const date = parseIsoDate(value);
  const lastOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));

  while ([0, 6].includes(lastOfMonth.getUTCDay())) {
    lastOfMonth.setUTCDate(lastOfMonth.getUTCDate() - 1);
  }

  return isoDate(lastOfMonth) === value;
}

export function isLastBusinessDayOfQuarter(value) {
  if (!isLastBusinessDayOfMonth(value)) return false;
  const month = Number(value.slice(5, 7));
  return [3, 6, 9, 12].includes(month);
}

export function periodRange(anchor, periodType) {
  const date = parseIsoDate(anchor);

  if (periodType === "daily") {
    return { periodStart: anchor, periodEnd: anchor };
  }

  if (periodType === "weekly") {
    const day = date.getUTCDay() || 7;
    const start = addDays(date, 1 - day);
    const end = addDays(start, 6);
    return { periodStart: isoDate(start), periodEnd: isoDate(end) };
  }

  if (periodType === "monthly") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12));
    return { periodStart: isoDate(start), periodEnd: isoDate(end) };
  }

  if (periodType === "quarterly") {
    const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
    const start = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1, 12));
    const end = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth + 3, 0, 12));
    return { periodStart: isoDate(start), periodEnd: isoDate(end) };
  }

  throw new Error(`Unsupported period type for scheduler helper: ${periodType}`);
}

export function runNodeScript(relativePath, args = []) {
  execFileSync(process.execPath, [path.join(ROOT, relativePath), ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
}

export function runPythonScript(relativePath, args = []) {
  execFileSync(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, relativePath), ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
}

export function runTsxScript(relativePath, args = []) {
  execFileSync(process.execPath, [localTsxCliPath(), path.join(ROOT, relativePath), ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
}
