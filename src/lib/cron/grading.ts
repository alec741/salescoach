import { NextRequest, NextResponse } from "next/server";
import { parseCronBoolean, parseCronNumber, validateCronSecret } from "./auth";

type RunHourlyResult = Record<string, unknown>;

async function loadRunHourly() {
  const specifier = "../../../scripts/coach/run-hourly.mjs";
  return (await import(specifier)) as {
    runHourly: (overrides?: Record<string, unknown>) => Promise<RunHourlyResult>;
  };
}

export async function handleGradingCron(request: NextRequest) {
  const authError = validateCronSecret(request);
  if (authError) return authError;

  const params = request.nextUrl.searchParams;
  const since = params.get("since");
  const until = params.get("until");
  if ((since && !until) || (!since && until)) {
    return NextResponse.json(
      { ok: false, error: "Provide both since and until together, or omit both." },
      { status: 400 }
    );
  }

  const lookbackMinutes = parseCronNumber(params.get("lookbackMinutes"));
  const max = parseCronNumber(params.get("max"));
  const minDurationSeconds = parseCronNumber(params.get("minDurationSeconds"));

  try {
    const { runHourly } = await loadRunHourly();
    const result = await runHourly({
      force: parseCronBoolean(params.get("force")),
      importMode: "inline",
      importToDb: !parseCronBoolean(params.get("skipImport")),
      lookbackMinutes: lookbackMinutes ?? undefined,
      max: max ?? undefined,
      minDurationSeconds: minDurationSeconds ?? undefined,
      provider: params.get("provider") || undefined,
      since,
      until
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron grading failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
