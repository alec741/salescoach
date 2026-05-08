import { NextRequest, NextResponse } from "next/server";

function truthy(value: string | null) {
  return value !== null && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function parseCronBoolean(value: string | null, defaultValue = false) {
  return value === null ? defaultValue : truthy(value);
}

export function parseCronNumber(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function unauthorizedCronResponse(message: string, status = 401) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function validateCronSecret(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return unauthorizedCronResponse("CRON_SECRET is not configured.", 500);
  }

  const authHeader = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");
  if (authHeader === `Bearer ${secret}` || headerSecret === secret) {
    return null;
  }

  return unauthorizedCronResponse("Unauthorized");
}
