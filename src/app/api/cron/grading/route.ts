import type { NextRequest } from "next/server";
import { handleGradingCron } from "@/lib/cron/grading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return handleGradingCron(request);
}
